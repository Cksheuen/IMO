#!/bin/bash
# Lesson Gate - Stop hook
# When Claude finishes responding, checks if there are unhandled correction signals.
# If yes, blocks stopping (exit 2) and instructs main agent to spawn a subagent.
#
# Safety: checks stop_hook_active to prevent infinite loops.
#
# Flow:
#   1. Stop hook fires → read stdin
#   2. Check stop_hook_active → if true, exit 0 (prevent loop)
#   3. Read lesson-signals.json → check unhandled_count
#   4. If unhandled signals exist → exit 2 with subagent dispatch instruction
#   5. If no signals → exit 0

set -u

# Configurable paths via environment variables
STATE_FILE="${LESSON_SIGNALS_FILE:-$HOME/.claude/lesson-signals.json}"
LESSON_DETECTOR="${LESSON_DETECTOR_PATH:-$HOME/.claude/hooks/lesson-capture/signal-detector.sh}"

INPUT=$(cat)

# Refresh lesson signals synchronously to avoid racing the background statusline detector.
if [ -x "$LESSON_DETECTOR" ]; then
  printf '%s' "$INPUT" | LESSON_DETECTOR_FORCE=1 "$LESSON_DETECTOR" 2>/dev/null || true
fi

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

# Build signal summary and mark as handled in a single Python call
SIGNAL_SUMMARY=$(python3 - "$STATE_FILE" <<'PYEOF'
import json, sys
from pathlib import Path

state_file = Path(sys.argv[1])
try:
    state = json.loads(state_file.read_text())
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

print('\n'.join(lines[:5]))
PYEOF
)

# Block and instruct to spawn subagent synchronously
cat >&2 <<EOF
[LESSON CAPTURE REQUIRED]

Detected $UNHANDLED unhandled correction signal(s) in this session:
$SIGNAL_SUMMARY

You must capture this lesson now. Execute:

\`\`\`
Agent(
  subagent_type: "promote-notes",
  prompt: "Capture lesson from correction signals.

State file: $STATE_FILE

Signals detected:
$SIGNAL_SUMMARY

Task:
1. Analyze what went wrong (root cause, not surface symptom)
2. Search if a lesson with similar theme already exists in notes/lessons/
3. If exists, update it with this new Source Case
4. If not, create a new lesson in notes/lessons/ following the theme-based format:
   - Status: active
   - Trigger: when does this lesson apply
   - Decision: what to do differently
   - Source Cases: this session's specific instance
5. After writing, mark all signals as handled and clean up:
   python3 -c \"
import json
with open('$STATE_FILE', 'r') as f: state = json.load(f)
for s in state['signals']: s['handled'] = True
state['unhandled_count'] = 0
with open('$STATE_FILE', 'w') as f: json.dump(state, f, ensure_ascii=False, indent=2)
\"
"
)
\`\`\`

Do NOT write the lesson yourself in the main agent. Run the subagent synchronously so it completes the capture before you stop can continue.
EOF
exit 2
