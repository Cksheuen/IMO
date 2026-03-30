#!/bin/bash
# Lesson Gate - Stop hook
# When Claude finishes responding, checks if there are unhandled correction signals.
# If yes, blocks stopping (exit 2) and reminds Claude to write a lesson.
#
# Safety: checks stop_hook_active to prevent infinite loops.
#
# Flow:
#   1. Stop hook fires → read stdin
#   2. Check stop_hook_active → if true, exit 0 (prevent loop)
#   3. Read lesson-signals.json → check unhandled_count
#   4. If unhandled signals exist → exit 2 with lesson-writing instructions
#   5. If no signals → exit 0

set -u

STATE_FILE="$HOME/.claude/lesson-signals.json"

INPUT=$(cat)

# SAFETY: Prevent infinite loops - if already in forced continuation, let it stop
STOP_ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# No state file = no signals detected
[ ! -f "$STATE_FILE" ] && exit 0

# Check session match
CURRENT_SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
STATE_SESSION=$(jq -r '.session_id // empty' "$STATE_FILE" 2>/dev/null)

# Only enforce for current session
if [ -n "$CURRENT_SESSION" ] && [ -n "$STATE_SESSION" ] && [ "$CURRENT_SESSION" != "$STATE_SESSION" ]; then
  exit 0
fi

# Read unhandled count
UNHANDLED=$(jq -r '.unhandled_count // 0' "$STATE_FILE" 2>/dev/null)
[ "$UNHANDLED" -eq 0 ] 2>/dev/null && exit 0

# Build signal summary for the reminder
SIGNAL_SUMMARY=$(python3 - "$STATE_FILE" <<'PYEOF'
import json, sys

try:
    with open(sys.argv[1], 'r') as f:
        state = json.load(f)
except Exception:
    sys.exit(0)

lines = []
for s in state.get('signals', []):
    if s.get('handled'):
        continue
    t = s.get('type')
    if t == 'explicit_correction':
        lines.append(f"  - Explicit correction at turn {s.get('turn')}: \"{s.get('snippet', '')[:80]}\"")
    elif t == 'repeated_modification':
        lines.append(f"  - Repeated modification of '{s.get('target', '?')}' ({s.get('count', 0)} times)")
    elif t == 'expectation_downgrade':
        lines.append(f"  - Expectation downgrade at turn {s.get('turn')}: \"{s.get('snippet', '')[:80]}\"")
    elif t == 'pattern_frustration':
        lines.append(f"  - Pattern: {s.get('correction_count', 0)} corrections detected in this session")

print('\n'.join(lines[:5]))  # cap at 5 signals
PYEOF
)

# Block and remind
cat >&2 <<EOF
Lesson capture required before finishing.

Detected $UNHANDLED unhandled correction signal(s) in this session:
$SIGNAL_SUMMARY

Before completing, you must:
1. Analyze what went wrong (root cause, not surface symptom)
2. Write or update a lesson in notes/lessons/ following the theme-based format
3. Mark signals as handled:
   python3 -c "
import json
with open('$STATE_FILE', 'r') as f: state = json.load(f)
for s in state['signals']: s['handled'] = True
state['unhandled_count'] = 0
with open('$STATE_FILE', 'w') as f: json.dump(state, f, ensure_ascii=False, indent=2)
"

Lesson note structure (notes/lessons/<theme>.md):
  - Status: active
  - Trigger: when does this lesson apply
  - Decision: what to do differently
  - Source Cases: this session's specific instance
EOF
exit 2
