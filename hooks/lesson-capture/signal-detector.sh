#!/bin/bash
# Lesson Signal Detector - StatusLine integration
# Reads statusline JSON (which includes session context), parses transcript
# to detect implicit/explicit correction signals, writes state file.
#
# Signals detected:
#   1. Explicit correction: user says "no/wrong/don't/stop"
#   2. Repeated modification: same file modified 3+ times after user requests
#   3. Expectation downgrade: user says "forget it/just do simple/never mind"
#
# Called by statusline-wrapper.sh on every tick.
# Must be fast (< 200ms) to avoid blocking statusline output.

set -u

STATE_DIR="$HOME/.claude"
STATE_FILE="$STATE_DIR/lesson-signals.json"
LOG_FILE="$STATE_DIR/lesson-capture.log"

INPUT=$(cat)

# Extract session info from statusline input
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# No session context yet
[ -z "$SESSION_ID" ] && exit 0
[ -z "$TRANSCRIPT_PATH" ] && exit 0
[ ! -f "$TRANSCRIPT_PATH" ] && exit 0

# Skip if already processed this transcript version (mtime-based dedup)
MTIME=$(stat -f%m "$TRANSCRIPT_PATH" 2>/dev/null || stat -c%Y "$TRANSCRIPT_PATH" 2>/dev/null || echo 0)
LAST_MTIME_FILE="$STATE_DIR/.lesson-detector-mtime"
if [ -f "$LAST_MTIME_FILE" ]; then
  LAST_MTIME=$(cat "$LAST_MTIME_FILE" 2>/dev/null || echo 0)
  [ "$MTIME" = "$LAST_MTIME" ] && exit 0
fi
printf '%s' "$MTIME" > "$LAST_MTIME_FILE"

# --- Signal Detection ---
# Use python3 for reliable transcript parsing (jq alone is fragile for JSONL analysis)

python3 - "$TRANSCRIPT_PATH" "$STATE_FILE" "$SESSION_ID" <<'PYEOF'
import json, sys, os, re
from collections import Counter

transcript_path = sys.argv[1]
state_file = sys.argv[2]
session_id = sys.argv[3]

# Parse transcript (JSONL format)
messages = []
try:
    with open(transcript_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                continue
except Exception:
    sys.exit(0)

if not messages:
    sys.exit(0)

# Extract user messages (text content only)
user_messages = []
for msg in messages:
    if msg.get('type') != 'user':
        continue
    inner = msg.get('message', {})
    if not isinstance(inner, dict):
        continue
    content = inner.get('content', '')
    if isinstance(content, str):
        user_messages.append(content)
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                user_messages.append(block.get('text', ''))

def is_system_injection(text):
    """Filter out system-injected content that appears as user messages."""
    if text.startswith('Base directory for this skill:'):
        return True
    if '<task-notification>' in text:
        return True
    if '<command-message>' in text or '<command-name>' in text:
        return True
    if text.startswith('<system-reminder>'):
        return True
    # Skill SKILL.md content injections: "# /loop", "# Brainstorm", etc.
    skill_header_re = r'^# (?:/\w|Brainstorm|Skill Creator|Design|Loop|Locate|Eat|Voice|Orchestrat)'
    if re.match(skill_header_re, text):
        return True
    return False

user_messages = [m for m in user_messages if not is_system_injection(m)]

if not user_messages:
    sys.exit(0)

signals = []

# --- Signal 1: Explicit correction keywords ---
correction_patterns_zh = [
    r'^不是[，,]|[。！？]\s*不是[，,]', r'不对', r'错了', r'不要这样', r'别这样', r'搞错',
    r'重来', r'重新来', r'不是这个意思', r'理解错了'
]
correction_patterns_en = [
    r'\bno\b(?!te|w|de)', r'\bwrong\b', r'\bincorrect\b',
    r"don'?t do", r'\bstop doing\b', r'\bnot what i\b',
    r"\bthat'?s not\b", r'\byou misunderstood\b'
]

for i, msg in enumerate(user_messages):
    msg_lower = msg.lower()
    for pat in correction_patterns_zh + correction_patterns_en:
        if re.search(pat, msg_lower):
            signals.append({
                'type': 'explicit_correction',
                'turn': i,
                'snippet': msg[:120],
                'handled': False
            })
            break  # one signal per message

# --- Signal 2: Repeated modification of same target ---
# Look for file paths or feature keywords mentioned multiple times in modification context
modify_patterns = [
    r'改一下', r'修改', r'调整', r'换成', r'改为', r'重新',
    r'再改', r'还是不行', r'又', r'再试',
    r'\bchange\b', r'\bmodify\b', r'\bfix\b', r'\bupdate\b',
    r'\btry again\b', r'\bstill not\b', r'\bagain\b'
]

# Extract file paths from user messages
file_path_pattern = r'[\w\-./]+\.(?:ts|tsx|js|jsx|py|rs|go|md|json|sh|css|html|vue|svelte)'
modification_targets = []

for i, msg in enumerate(user_messages):
    msg_lower = msg.lower()
    is_modification = any(re.search(pat, msg_lower) for pat in modify_patterns)
    if is_modification:
        # Extract file paths as targets
        files = re.findall(file_path_pattern, msg)
        if files:
            for f in files:
                modification_targets.append((f, i))
        else:
            # Use first 30 chars as topic key (rough heuristic)
            topic_key = re.sub(r'\s+', ' ', msg[:60]).strip()
            if topic_key:
                modification_targets.append((topic_key, i))

# Count modifications per target
target_counts = Counter(t[0] for t in modification_targets)
for target, count in target_counts.items():
    if count >= 3:
        turns = [t[1] for t in modification_targets if t[0] == target]
        signals.append({
            'type': 'repeated_modification',
            'target': target,
            'count': count,
            'turns': turns,
            'handled': False
        })

# --- Signal 3: Expectation downgrade ---
downgrade_patterns_zh = [
    r'算了', r'简单点', r'先这样吧', r'别管了', r'不用了',
    r'先不管', r'以后再说', r'太复杂了', r'简化'
]
downgrade_patterns_en = [
    r'\bforget it\b', r'\bjust do\b.*\bsimple\b', r'\bnever mind\b',
    r'\bsimplify\b', r'\btoo complex\b', r'\bjust make it work\b',
    r'\bgood enough\b', r'\bskip\b.*\bfor now\b'
]

for i, msg in enumerate(user_messages):
    msg_lower = msg.lower()
    for pat in downgrade_patterns_zh + downgrade_patterns_en:
        if re.search(pat, msg_lower):
            signals.append({
                'type': 'expectation_downgrade',
                'turn': i,
                'snippet': msg[:120],
                'handled': False
            })
            break

# --- Signal 4: Consecutive dissatisfaction (3+ corrections in window) ---
correction_turns = [s['turn'] for s in signals if s['type'] == 'explicit_correction']
if len(correction_turns) >= 3:
    signals.append({
        'type': 'pattern_frustration',
        'correction_count': len(correction_turns),
        'turns': correction_turns,
        'handled': False
    })

# --- Write state file ---
# Merge with existing state to preserve 'handled' flags
existing_signals = []
if os.path.exists(state_file):
    try:
        with open(state_file, 'r') as f:
            existing = json.load(f)
            existing_signals = existing.get('signals', [])
    except (json.JSONDecodeError, KeyError):
        pass

# Preserve handled status for previously detected signals
handled_keys = set()
for es in existing_signals:
    if es.get('handled'):
        key = f"{es.get('type')}:{es.get('turn', es.get('target', ''))}"
        handled_keys.add(key)

for s in signals:
    key = f"{s['type']}:{s.get('turn', s.get('target', ''))}"
    if key in handled_keys:
        s['handled'] = True

unhandled_count = sum(1 for s in signals if not s.get('handled'))

state = {
    'session_id': session_id,
    'signal_count': len(signals),
    'unhandled_count': unhandled_count,
    'signals': signals,
    'updated_at': int(__import__('time').time())
}

with open(state_file, 'w') as f:
    json.dump(state, f, ensure_ascii=False, indent=2)

PYEOF
