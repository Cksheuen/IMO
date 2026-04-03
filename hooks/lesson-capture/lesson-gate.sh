#!/bin/bash
# Lesson Gate - Stop hook
# When Claude finishes responding, checks if there are unhandled correction signals.
# If yes, spawns a background Claude process to capture the lesson.
#
# IMPORTANT: This hook does NOT block the main agent.
# Lesson capture happens in background, user flow is not interrupted.
#
# Safety: checks stop_hook_active to prevent infinite loops.

set -u

# Configurable paths via environment variables
STATE_FILE="${LESSON_SIGNALS_FILE:-$HOME/.claude/lesson-signals.json}"
LESSON_DETECTOR="${LESSON_DETECTOR_PATH:-$HOME/.claude/hooks/lesson-capture/signal-detector.sh}"

INPUT=$(cat)

# Refresh lesson signals synchronously to avoid racing
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

UNHANDLED_FINGERPRINT=$(python3 - "$STATE_FILE" <<'PYEOF'
import hashlib, json, sys
from pathlib import Path

state = json.loads(Path(sys.argv[1]).read_text())
payload = [
    {
        'type': s.get('type'),
        'turn': s.get('turn'),
        'target': s.get('target'),
        'snippet': s.get('snippet'),
        'count': s.get('count'),
        'correction_count': s.get('correction_count'),
    }
    for s in state.get('signals', [])
    if not s.get('handled')
]
print(hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest())
PYEOF
)

# Avoid spawning duplicate background workers for the same unhandled batch.
ACTIVE_PID=$(jq -r '.background_pid // empty' "$STATE_FILE" 2>/dev/null)
ACTIVE_FINGERPRINT=$(jq -r '.background_fingerprint // empty' "$STATE_FILE" 2>/dev/null)
if [ -n "$ACTIVE_PID" ] && kill -0 "$ACTIVE_PID" 2>/dev/null; then
  if [ -n "$ACTIVE_FINGERPRINT" ] && [ "$ACTIVE_FINGERPRINT" = "$UNHANDLED_FINGERPRINT" ]; then
    exit 0
  fi
fi

# Build signal summary
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

# Spawn promote-notes subagent in background using nohup
# This runs a separate Claude process that will handle the lesson capture
# WITHOUT interrupting the main agent's flow

# Build the prompt for the background process
PROMPT="Capture lesson from correction signals.

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

# Log file for the background process
LOG_DIR="$HOME/.claude/logs/lesson-capture"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/background-$(date +%Y%m%d-%H%M%S).log"

# Spawn the background process using nohup
# Use claude with --print to output to log file
nohup claude --print -p "$PROMPT" > "$LOG_FILE" 2>&1 &
PID=$!

# Write spawn info to state file for tracking
python3 - "$STATE_FILE" "$PID" "$LOG_FILE" "$UNHANDLED_FINGERPRINT" <<'PYEOF'
import json, sys
from datetime import datetime

state_file = sys.argv[1]
pid = sys.argv[2]
log_file = sys.argv[3]
fingerprint = sys.argv[4]

try:
    with open(state_file, 'r') as f:
        state = json.load(f)
except Exception:
    state = {}

state['background_spawned'] = True
state['background_pid'] = pid
state['background_log'] = log_file
state['background_fingerprint'] = fingerprint
state['spawned_at'] = datetime.utcnow().isoformat() + 'Z'

with open(state_file, 'w') as f:
    json.dump(state, f, ensure_ascii=False, indent=2)
PYEOF

# Log to audit file (not to stderr which would interrupt the main agent)
echo "$(date -Iseconds): Spawned promote-notes background process (PID=$PID) for lesson capture. Log: $LOG_FILE" >> "$LOG_DIR/spawn-audit.log"

# Exit 0 to allow the main agent to continue
# The lesson capture happens independently in the background
exit 0
