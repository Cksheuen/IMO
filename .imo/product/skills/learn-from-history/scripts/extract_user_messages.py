#!/usr/bin/env python3
"""Read human text from local transcripts without changing history."""
import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys


BLOCKS = re.compile(
    r'<(command-name|command-message|command-args|local-command-stdout|'
    r'local-command-caveat|system-reminder|environment_context|user_instructions|'
    r'skill|skills_instructions|INSTRUCTIONS|imo-context)\b[^>]*>.*?</\1>',
    re.I | re.S,
)
INJECTED = re.compile(
    r'^\s*(?:#\s*AGENTS\.md instructions[^\n]*|'
    r'Base directory for this skill:[^\n]*)(?:\n|$)', re.I
)


def clean(content):
    if isinstance(content, list):
        content = '\n'.join(
            item.get('text', '') for item in content
            if isinstance(item, dict) and item.get('type') in ('text', 'input_text')
            and isinstance(item.get('text', ''), str)
        )
    if not isinstance(content, str):
        return ''
    # A skill expansion is supplied by the host, not authored by the person.
    if content.lstrip().startswith('Base directory for this skill:'):
        return ''
    if content.lstrip().startswith((
        '<task-notification>',
        'This session is being continued from a previous conversation',
    )):
        return ''
    pasted = []

    def preserve_paste(match):
        pasted.append('[pasted]\n' + match.group(1) + '\n[/pasted]')
        return f'\x00paste-{len(pasted) - 1}\x00'

    text = re.sub(r'<pasted_content\b[^>]*>(.*?)</pasted_content>',
                  preserve_paste, content, flags=re.I | re.S)
    text = BLOCKS.sub('', text)
    # Host-generated interruption and image-coordinate annotations are not requests.
    text = re.sub(
        r'^\s*\[(?:Request interrupted by user(?: for tool use)?|'
        r'Image: original [^\]\n]*)\]\s*$', '', text, flags=re.M,
    )
    if INJECTED.match(text):
        return ''
    # Conservatively reject unfinished injected blocks.
    if re.search(r'<(?:environment_context|user_instructions|skill|system-reminder|INSTRUCTIONS)\b', text, re.I):
        return ''
    for index, block in enumerate(pasted):
        text = text.replace(f'\x00paste-{index}\x00', block)
    return text.strip()


def user_text(record, source):
    if source == 'claude':
        if record.get('type') != 'user' or record.get('isMeta') or record.get('isSidechain'):
            return ''
        return clean(record.get('message', {}).get('content'))
    payload = record.get('payload', {})
    if record.get('type') == 'response_item' and payload.get('role') == 'user':
        return clean(payload.get('content'))
    if record.get('type') == 'event_msg' and payload.get('type') == 'user_message':
        return clean(payload.get('message'))
    return ''


def records(path, warnings):
    try:
        with path.open(encoding='utf-8') as stream:
            for line in stream:
                try:
                    row = json.loads(line)
                    if isinstance(row, dict):
                        yield row
                    else:
                        warnings[0] += 1
                except (ValueError, UnicodeError):
                    warnings[0] += 1
    except (OSError, UnicodeError):
        warnings[0] += 1


def automated(meta, include_exec=False):
    if not include_exec and (meta.get("originator") == "codex_exec" or meta.get("source") == "exec"):
        return True
    # These fields describe the creator; do not search instruction text.
    value = json.dumps({k: meta.get(k) for k in
                       ('source', 'thread_source', 'originator')}).lower()
    return any(marker in value for marker in ('subagent', 'sub_agent', 'exec_worker', 'smoke', 'automation'))


def messages(path, source, since, project_filter, warnings, include_exec=False):
    project, session = '', path.stem
    if source == 'codex':
        for row in records(path, warnings):
            if row.get('type') == 'session_meta':
                meta = row.get('payload', {})
                if automated(meta, include_exec):
                    return
                project = meta.get('cwd', '')
                session = meta.get('id') or meta.get('session_id') or session
                break
    previous = None
    first_human = True
    for row in records(path, warnings):
        if source == 'claude':
            project = row.get('cwd') or project
            session = row.get('sessionId') or session
        text = user_text(row, source)
        if not text:
            continue
        if first_human:
            if text.startswith('[delegated]'):
                return
            first_human = False
        stamp = row.get('timestamp') or row.get('payload', {}).get('timestamp', '')
        try:
            day = date.fromisoformat(stamp[:10])
        except (ValueError, TypeError):
            warnings[0] += 1
            continue
        # Codex may store the same turn as both an event and a response item.
        current = (text, row.get('type'))
        duplicate = (source == 'codex' and previous is not None
                     and previous[0] == text and previous[1] != current[1])
        previous = None if duplicate else current
        if duplicate or (since and day < since):
            continue
        if project_filter and project_filter not in project:
            continue
        yield {'source': source, 'date': stamp, 'project': project,
               'session': session, 'text': text}


def self_test():
    samples = {
        'claude': [
            ('{"type":"user","message":{"content":[{"type":"text","text":"No, keep my edits.<system-reminder>hidden</system-reminder>"},{"type":"tool_result","content":"tool output"}]}}', 'No, keep my edits.'),
            ('{"type":"user","message":{"content":"<command-name>/help</command-name><local-command-stdout>output</local-command-stdout>"}}', ''),
        ],
        'codex': [
            ('{"type":"response_item","payload":{"role":"user","content":[{"type":"input_text","text":"<environment_context>injected</environment_context>Use pnpm."}]}}', 'Use pnpm.'),
            ('{"type":"event_msg","payload":{"type":"user_message","message":"<user_instructions>injected</user_instructions><skill>injected</skill>"}}', ''),
        ],
    }
    claude_cases = [
        ({'message': {'content': '<pasted_content>First</pasted_content> and <pasted_content><skill>My words</skill></pasted_content>'}}, '[pasted]\nFirst\n[/pasted] and [pasted]\n<skill>My words</skill>\n[/pasted]'),

        ({'message': {'content': '<task-notification><status>completed</status></task-notification>Read the output file.'}}, ''),
        ({'isMeta': True, 'message': {'content': '## Context Usage'}}, ''),
        ({'message': {'content': 'This session is being continued from a previous conversation that ran out of context. Summary follows.'}}, ''),
        ({'message': {'content': '<pasted_content source="clipboard">Quoted instructions</pasted_content>'}}, '[pasted]\nQuoted instructions\n[/pasted]'),
        ({'message': {'content': 'Please review <pasted_content source="clipboard">Quoted instructions</pasted_content> for errors.'}}, 'Please review [pasted]\nQuoted instructions\n[/pasted] for errors.'),
        ({'message': {'content': '[Request interrupted by user for tool use]'}}, ''),
        ({'message': {'content': '[Image: original 1280x2092, displayed at 1224x2000. Multiply coordinates by 1.05 to map to original image.]'}}, ''),
        ({'message': {'content': '[Image: original 1280x2092, displayed at 1224x2000.]\nFix this layout.'}}, 'Fix this layout.'),
        ({'message': {'content': [{'type': 'tool_result', 'content': 'Background output'}]}}, ''),
        ({'message': {'content': '<local-command-caveat>Host command notice</local-command-caveat>'}}, ''),
    ]
    samples['claude'].extend(
        (json.dumps(dict(record, type='user')), expected)
        for record, expected in claude_cases
    )
    for source, cases in samples.items():
        for raw, expected in cases:
            if user_text(json.loads(raw), source) != expected:
                print('self-test failed: ' + source, file=sys.stderr)
                return 1
    # Exercise whole-session filtering before the date window, without history I/O.
    from unittest.mock import patch
    session_cases = 0
    for source in ('claude', 'codex'):
        def human(text, stamp='2026-10-11'):
            if source == 'claude':
                return {'type': 'user', 'timestamp': stamp, 'message': {'content': text}}
            return {'type': 'event_msg', 'timestamp': stamp,
                    'payload': {'type': 'user_message', 'message': text}}

        def extracted(rows, include_exec=False):
            with patch.dict(messages.__globals__, records=lambda *args: iter(rows)):
                return list(messages(Path('sample.jsonl'), source, date(2026, 10, 10),
                                     None, [0], include_exec))

        for include_exec in (False, True):
            rows = [human('<system-reminder>injected</system-reminder>'),
                    human('[delegated] Do the work.', '2026-10-01'), human('Follow up.')]
            if extracted(rows, include_exec):
                print('self-test failed: delegated ' + source, file=sys.stderr)
                return 1
            session_cases += 1
        if len(extracted([human('My request.'), human('[delegated] quoted later')])) != 2:
            print('self-test failed: first human only ' + source, file=sys.stderr)
            return 1
        session_cases += 1
        if source == 'codex':
            for meta in ({'originator': 'codex_exec'}, {'source': 'exec'}):
                rows = [{'type': 'session_meta', 'payload': meta}, human('Worker request.')]
                if extracted(rows) or len(extracted(rows, True)) != 1:
                    print('self-test failed: exec opt-in', file=sys.stderr)
                    return 1
                session_cases += 1
    print(f'self-test passed: {sum(map(len, samples.values()))} sample lines, {session_cases} session cases', file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', choices=('claude', 'codex', 'both'), default='both')
    parser.add_argument('--since', type=date.fromisoformat, metavar='YYYY-MM-DD')
    parser.add_argument('--project', help='Substring of the session working directory')
    parser.add_argument('--max-chars', type=int, default=400)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--include-exec', action='store_true',
                        help='Include Codex exec runs; delegated sessions remain excluded')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if args.max_chars < 1:
        parser.error('--max-chars must be positive')
    roots = {'claude': Path.home() / '.claude/projects',
             'codex': Path.home() / '.codex/sessions'}
    if args.out:
        target = args.out.expanduser().resolve()
        if any(target.is_relative_to(root.resolve()) for root in roots.values()):
            parser.error('--out must not be inside a history directory')
        if args.out.exists():
            parser.error('--out already exists; choose a new file')
    counts = {'claude': 0, 'codex': 0}
    warnings = [0]
    output = None
    try:
        output = args.out.expanduser().open('x', encoding='utf-8') if args.out else sys.stdout
        for source, root in roots.items():
            if args.source not in ('both', source):
                continue
            pattern = '*/*.jsonl' if source == 'claude' else '**/*.jsonl'
            for path in sorted(root.glob(pattern)):
                if 'subagents' in path.parts:
                    continue
                for row in messages(path, source, args.since, args.project, warnings, args.include_exec):
                    row['text'] = row['text'][:args.max_chars]
                    output.write(json.dumps(row, ensure_ascii=False) + '\n')
                    counts[source] += 1
    except (OSError, ValueError, TypeError) as exc:
        print('Extraction failed: ' + str(exc), file=sys.stderr)
        return 1
    finally:
        if output is not None and output is not sys.stdout:
            output.close()
    print(f"Extracted {sum(counts.values())} messages (claude={counts['claude']}, "
          f"codex={counts['codex']}); skipped unreadable/invalid records={warnings[0]}", file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
