#!/usr/bin/env python3
"""
Process Codex execution feedback and generate lesson suggestions for CC.

Reads ~/.claude/shared-knowledge/codex-feedback.jsonl, analyzes patterns
(hotspots, failures, recurring themes), compares with existing lessons,
and outputs suggestions or applies them directly.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_FEEDBACK_PATH = os.path.expanduser(
    "~/.claude/shared-knowledge/codex-feedback.jsonl"
)
DEFAULT_LESSONS_DIR = os.path.expanduser("~/.claude/notes/lessons/")
DEFAULT_MANIFEST_PATH = os.path.expanduser(
    "~/.claude/shared-knowledge/sync-manifest.json"
)
DEFAULT_MIN_OCCURRENCES = 2


def load_feedback(path, since=None):
    """Load feedback entries from JSONL file."""
    entries = []
    if not os.path.exists(path):
        return entries

    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                print(
                    f"Warning: skipping malformed JSON at line {line_num}",
                    file=sys.stderr,
                )
                continue

            if since and entry.get("timestamp", "") <= since:
                continue

            entries.append(entry)

    return entries


def load_manifest(path):
    """Load sync manifest, return dict."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(path, manifest):
    """Write sync manifest."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


def scan_existing_lessons(lessons_dir):
    """Scan lessons directory and return a dict of filename -> content."""
    lessons = {}
    if not os.path.isdir(lessons_dir):
        return lessons

    for fname in os.listdir(lessons_dir):
        if not fname.endswith(".md"):
            continue
        fpath = os.path.join(lessons_dir, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                lessons[fname] = f.read()
        except (OSError, UnicodeDecodeError):
            continue

    return lessons


def extract_keywords(text):
    """Extract lowercase keywords from text, filtering short/common words."""
    stopwords = {
        "the", "a", "an", "is", "was", "are", "were", "be", "been",
        "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "shall", "can",
        "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "as", "into", "through", "during", "before", "after", "and",
        "but", "or", "nor", "not", "so", "yet", "both", "either",
        "neither", "each", "every", "all", "any", "few", "more",
        "most", "other", "some", "such", "no", "only", "own", "same",
        "than", "too", "very", "just", "because", "if", "when", "then",
        "that", "this", "it", "its", "i", "we", "they", "he", "she",
        "my", "our", "your", "his", "her", "their", "what", "which",
        "who", "whom", "how", "where", "why", "about", "up", "out",
        "also", "found", "fix", "fixed", "applied", "used", "using",
    }
    words = re.findall(r"[a-z][a-z0-9_-]{2,}", text.lower())
    return [w for w in words if w not in stopwords]


# --- Pattern detection ---------------------------------------------------


def detect_hotspots(entries, min_occurrences):
    """Find files frequently touched across multiple tasks."""
    file_counter = Counter()
    file_tasks = defaultdict(set)

    for entry in entries:
        tid = entry.get("thread_id", entry.get("timestamp", ""))
        for fpath in entry.get("touched_files", []):
            file_counter[fpath] += 1
            file_tasks[fpath].add(tid)

    patterns = []
    for fpath, count in file_counter.most_common():
        unique_tasks = len(file_tasks[fpath])
        if unique_tasks >= min_occurrences:
            patterns.append(
                {
                    "name": f"hotspot-{os.path.basename(fpath)}",
                    "type": "hotspot",
                    "evidence_count": count,
                    "unique_tasks": unique_tasks,
                    "files": [fpath],
                    "description": (
                        f"File `{fpath}` touched in {unique_tasks} different tasks "
                        f"({count} total touches)"
                    ),
                }
            )
    return patterns


def detect_failures(entries, min_occurrences):
    """Find recurring failure patterns."""
    failure_keywords = Counter()
    failure_entries = []

    for entry in entries:
        if entry.get("status", 0) != 0:
            failure_entries.append(entry)
            # Extract keywords from prompt and message
            text = " ".join(
                [
                    entry.get("task_prompt", ""),
                    entry.get("final_message_excerpt", ""),
                ]
                + entry.get("reasoning_summary", [])
            )
            for kw in extract_keywords(text):
                failure_keywords[kw] += 1

    if len(failure_entries) < min_occurrences:
        return []

    # Group failures by most common keywords
    top_keywords = [kw for kw, _ in failure_keywords.most_common(5) if _ >= min_occurrences]

    patterns = []
    if failure_entries:
        files_in_failures = Counter()
        for e in failure_entries:
            for f in e.get("touched_files", []):
                files_in_failures[f] += 1

        patterns.append(
            {
                "name": "codex-failures",
                "type": "failure",
                "evidence_count": len(failure_entries),
                "unique_tasks": len(failure_entries),
                "files": [f for f, _ in files_in_failures.most_common(5)],
                "description": (
                    f"{len(failure_entries)} Codex tasks failed. "
                    f"Common keywords: {', '.join(top_keywords) if top_keywords else 'none'}"
                ),
                "keywords": top_keywords,
                "excerpts": [
                    e.get("final_message_excerpt", "")[:120]
                    for e in failure_entries[:5]
                ],
            }
        )

    return patterns


def detect_recurring_themes(entries, min_occurrences):
    """Find recurring concepts across reasoning summaries."""
    keyword_counter = Counter()
    keyword_entries = defaultdict(list)

    for entry in entries:
        summaries = entry.get("reasoning_summary", [])
        text = " ".join(summaries)
        seen_in_entry = set()
        for kw in extract_keywords(text):
            if kw not in seen_in_entry:
                keyword_counter[kw] += 1
                keyword_entries[kw].append(entry)
                seen_in_entry.add(kw)

    patterns = []
    seen_themes = set()
    for kw, count in keyword_counter.most_common(20):
        if count < min_occurrences:
            break
        if kw in seen_themes:
            continue
        seen_themes.add(kw)

        related_entries = keyword_entries[kw]
        files_involved = Counter()
        for e in related_entries:
            for f in e.get("touched_files", []):
                files_involved[f] += 1

        patterns.append(
            {
                "name": f"theme-{kw}",
                "type": "recurring_theme",
                "evidence_count": count,
                "unique_tasks": count,
                "files": [f for f, _ in files_involved.most_common(5)],
                "description": (
                    f"Keyword `{kw}` appears in reasoning of {count} tasks"
                ),
                "keyword": kw,
            }
        )

    return patterns[:10]  # cap at 10 themes


# --- Lesson matching ------------------------------------------------------


def match_pattern_to_lessons(pattern, existing_lessons):
    """Check if an existing lesson covers this pattern."""
    pattern_keywords = set()

    # Collect keywords from pattern
    pattern_keywords.update(extract_keywords(pattern.get("description", "")))
    pattern_keywords.update(extract_keywords(pattern.get("name", "")))
    for f in pattern.get("files", []):
        pattern_keywords.update(extract_keywords(f))
    if "keyword" in pattern:
        pattern_keywords.add(pattern["keyword"])
    if "keywords" in pattern:
        pattern_keywords.update(pattern["keywords"])

    best_match = None
    best_score = 0

    for fname, content in existing_lessons.items():
        lesson_keywords = set(extract_keywords(content[:2000]))
        overlap = len(pattern_keywords & lesson_keywords)
        if overlap > best_score and overlap >= 2:
            best_score = overlap
            best_match = fname

    return best_match, best_score


# --- Output ---------------------------------------------------------------


def format_suggestions(entries, patterns, existing_lessons, since_label):
    """Format pattern suggestions as Markdown."""
    total = len(entries)
    lines = [
        "## Codex Feedback Analysis",
        f"Processed: {total} entries ({since_label})",
        "",
    ]

    if not patterns:
        lines.append("No patterns detected above threshold.")
        return "\n".join(lines)

    lines.append("### Detected Patterns")
    lines.append("")

    for p in patterns:
        match_file, match_score = match_pattern_to_lessons(p, existing_lessons)

        suggestion = "skip"
        if match_file and match_score >= 3:
            suggestion = f"update existing (`{match_file}`)"
        elif p["evidence_count"] >= 3:
            suggestion = "create new"
        elif p["evidence_count"] >= 2:
            suggestion = "create new (borderline)"

        lines.append(f"#### Pattern: {p['name']}")
        lines.append(f"- Type: {p['type']}")
        lines.append(f"- Evidence: {p['evidence_count']} occurrences")
        if p.get("files"):
            file_list = ", ".join(f"`{f}`" for f in p["files"][:5])
            lines.append(f"- Files: {file_list}")
        lines.append(f"- Existing lesson: {match_file or 'none'}")
        lines.append(f"- Suggestion: {suggestion}")
        lines.append("")

    return "\n".join(lines)


def apply_patterns(patterns, existing_lessons, lessons_dir, entries):
    """Write or update lesson files for detected patterns."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    applied = []

    # Only match against lessons that existed before this run
    pre_existing_lessons = dict(existing_lessons)

    for p in patterns:
        match_file, match_score = match_pattern_to_lessons(
            p, pre_existing_lessons
        )

        if p["evidence_count"] < 2:
            continue

        theme = re.sub(r"[^a-z0-9-]", "-", p["name"].lower())
        theme = re.sub(r"-+", "-", theme).strip("-")
        lesson_fname = f"codex-{theme}.md"
        lesson_path = os.path.join(lessons_dir, lesson_fname)

        source_case = (
            f"- **{today}**: {p['description']}"
        )

        if match_file and match_score >= 3:
            # Update existing lesson (require stronger match)
            existing_path = os.path.join(lessons_dir, match_file)
            content = pre_existing_lessons[match_file]

            # Update last_verified in frontmatter
            content = re.sub(
                r"last_verified:\s*\S+",
                f"last_verified: {today}",
                content,
            )

            # Append to Source Cases section
            if "## Source Cases" in content:
                content = content.rstrip() + "\n" + source_case + "\n"
            else:
                content = content.rstrip() + "\n\n## Source Cases\n" + source_case + "\n"

            with open(existing_path, "w", encoding="utf-8") as f:
                f.write(content)

            # Update both dicts so we don't double-append
            existing_lessons[match_file] = content
            pre_existing_lessons[match_file] = content
            applied.append(f"Updated: {match_file}")

        else:
            # Create new lesson
            trigger = f"Codex 执行中出现 {p['type']} 模式 ({p['name']})"
            decision = p["description"]

            content = (
                f"---\n"
                f"status: active\n"
                f"last_verified: {today}\n"
                f"---\n"
                f"# Codex 反馈教训: {theme}\n"
                f"\n"
                f"## Trigger\n"
                f"{trigger}\n"
                f"\n"
                f"## Decision\n"
                f"{decision}\n"
                f"\n"
                f"## Source Cases\n"
                f"{source_case}\n"
            )

            os.makedirs(lessons_dir, exist_ok=True)
            with open(lesson_path, "w", encoding="utf-8") as f:
                f.write(content)

            # Add to existing_lessons but NOT pre_existing_lessons
            existing_lessons[lesson_fname] = content
            applied.append(f"Created: {lesson_fname}")

    return applied


# --- Main -----------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Process Codex feedback and generate lesson suggestions."
    )
    parser.add_argument(
        "--feedback",
        default=DEFAULT_FEEDBACK_PATH,
        help="Path to codex-feedback.jsonl",
    )
    parser.add_argument(
        "--lessons-dir",
        default=DEFAULT_LESSONS_DIR,
        help="Path to lessons directory",
    )
    parser.add_argument(
        "--min-occurrences",
        type=int,
        default=DEFAULT_MIN_OCCURRENCES,
        help="Minimum pattern occurrences to suggest (default: 2)",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="Only process entries after this ISO timestamp",
    )
    parser.add_argument(
        "--update-manifest",
        default=None,
        help="Path to sync-manifest.json to update after processing",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Print suggestions to stdout (default behavior)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write/update lesson files",
    )

    args = parser.parse_args()

    # --apply overrides --dry-run
    if args.apply:
        args.dry_run = False

    # Determine --since from manifest if not provided
    manifest = {}
    manifest_path = args.update_manifest or DEFAULT_MANIFEST_PATH
    if not args.since:
        manifest = load_manifest(manifest_path)
        last_processed = manifest.get("last_processed_timestamp")
        if last_processed:
            args.since = last_processed

    # Load data
    entries = load_feedback(args.feedback, since=args.since)

    if not entries:
        print("No new feedback entries to process.")
        return

    since_label = f"all" if not args.since else f"since {args.since}"

    existing_lessons = scan_existing_lessons(args.lessons_dir)

    # Detect patterns
    patterns = []
    patterns.extend(detect_hotspots(entries, args.min_occurrences))
    patterns.extend(detect_failures(entries, args.min_occurrences))
    patterns.extend(detect_recurring_themes(entries, args.min_occurrences))

    if args.dry_run:
        output = format_suggestions(entries, patterns, existing_lessons, since_label)
        print(output)
    else:
        # Apply mode
        output = format_suggestions(entries, patterns, existing_lessons, since_label)
        print(output)
        print()

        applied = apply_patterns(patterns, existing_lessons, args.lessons_dir, entries)
        if applied:
            print("### Applied Changes")
            for a in applied:
                print(f"- {a}")
        else:
            print("No changes applied (patterns below threshold or all matched).")

    # Update manifest only after apply succeeds.
    if args.apply:
        if not manifest:
            manifest = load_manifest(manifest_path)

        manifest["feedback_count"] = manifest.get("feedback_count", 0) + len(entries)

        # Record last processed timestamp
        timestamps = [e.get("timestamp", "") for e in entries if e.get("timestamp")]
        if timestamps:
            manifest["last_processed_timestamp"] = max(timestamps)

        save_manifest(manifest_path, manifest)
        print(f"\nManifest updated: {manifest_path}")


if __name__ == "__main__":
    main()
