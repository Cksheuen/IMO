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

SIGNAL_BATCH_BASE64=$(python3 - "$STATE_FILE" <<'PYEOF'
import base64, json, sys
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
raw = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode('utf-8')
print(base64.b64encode(raw).decode('ascii'))
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
import base64, collections, json
with open('$STATE_FILE', 'r') as f: state = json.load(f)
batch = json.loads(base64.b64decode('$SIGNAL_BATCH_BASE64').decode('utf-8'))
targets = collections.Counter(
    json.dumps(item, sort_keys=True, ensure_ascii=False)
    for item in batch
)
remaining = 0
for s in state['signals']:
    key = json.dumps({
        'type': s.get('type'),
        'turn': s.get('turn'),
        'target': s.get('target'),
        'snippet': s.get('snippet'),
        'count': s.get('count'),
        'correction_count': s.get('correction_count'),
    }, sort_keys=True, ensure_ascii=False)
    if targets.get(key, 0) > 0:
        s['handled'] = True
        targets[key] -= 1
    if not s.get('handled'):
        remaining += 1
state['unhandled_count'] = remaining
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

# Quick health check window: catch fast startup failures before recording state.
CHECK_WINDOW_SECONDS="${LESSON_BACKGROUND_CHECK_WINDOW_SECONDS:-5}"
CHECK_POLL_SECONDS="${LESSON_BACKGROUND_CHECK_POLL_SECONDS:-1}"
ELAPSED_SECONDS=0

BACKGROUND_STATUS="running"
BACKGROUND_SPAWNED="true"
BACKGROUND_EXIT_CODE=""
BACKGROUND_ERROR=""

while [ "$ELAPSED_SECONDS" -lt "$CHECK_WINDOW_SECONDS" ]; do
  if kill -0 "$PID" 2>/dev/null; then
    sleep "$CHECK_POLL_SECONDS"
    ELAPSED_SECONDS=$((ELAPSED_SECONDS + CHECK_POLL_SECONDS))
    continue
  fi

  BACKGROUND_STATUS="failed_fast"
  BACKGROUND_SPAWNED="false"
  wait "$PID" 2>/dev/null
  BACKGROUND_EXIT_CODE="$?"
  BACKGROUND_ERROR=$(python3 - "$LOG_FILE" <<'PYEOF'
import sys
from pathlib import Path

log_file = Path(sys.argv[1])
fallback = "background process exited quickly (empty or unreadable log)"
try:
    lines = log_file.read_text(encoding='utf-8', errors='replace').splitlines()
except Exception:
    print(fallback)
    sys.exit(0)

for line in lines:
    line = line.strip()
    if line:
        print(line[:240])
        break
else:
    print(fallback)
PYEOF
)
  break
done

# Write background state to state file for tracking
python3 - "$STATE_FILE" "$BACKGROUND_STATUS" "$BACKGROUND_SPAWNED" "$PID" "$LOG_FILE" "$UNHANDLED_FINGERPRINT" "$BACKGROUND_EXIT_CODE" "$BACKGROUND_ERROR" <<'PYEOF'
import json
import sys
from datetime import datetime

state_file = sys.argv[1]
status = sys.argv[2]
spawned = sys.argv[3].lower() == 'true'
pid = sys.argv[4]
log_file = sys.argv[5]
fingerprint = sys.argv[6]
exit_code_raw = sys.argv[7]
error_summary = sys.argv[8]

try:
    with open(state_file, 'r') as f:
        state = json.load(f)
except Exception:
    state = {}

now = datetime.utcnow().isoformat() + 'Z'

state['background_spawned'] = spawned
state['background_status'] = status
state['background_log'] = log_file
state['background_fingerprint'] = fingerprint
state['background_last_attempt_at'] = now

if spawned:
    state['background_pid'] = pid
    state['spawned_at'] = now
    state.pop('background_failed_at', None)
    state.pop('background_exit_code', None)
    state.pop('background_error', None)
else:
    state.pop('background_pid', None)
    state['background_failed_at'] = now
    if exit_code_raw:
        try:
            state['background_exit_code'] = int(exit_code_raw)
        except ValueError:
            state['background_exit_code'] = exit_code_raw
    else:
        state.pop('background_exit_code', None)
    state['background_error'] = error_summary or 'background process exited quickly'

with open(state_file, 'w') as f:
    json.dump(state, f, ensure_ascii=False, indent=2)
PYEOF

# Log to audit file (not to stderr which would interrupt the main agent)
if [ "$BACKGROUND_STATUS" = "running" ]; then
  echo "$(date -Iseconds): Spawned promote-notes background process (PID=$PID) for lesson capture. Log: $LOG_FILE" >> "$LOG_DIR/spawn-audit.log"
else
  echo "$(date -Iseconds): Lesson capture background process failed fast (exit=$BACKGROUND_EXIT_CODE, pid=$PID). Error: $BACKGROUND_ERROR. Log: $LOG_FILE" >> "$LOG_DIR/spawn-audit.log"
fi

# Detached monitor: when the background process exits, reconcile state to avoid
# leaving stale "spawned/running" records on failure.
if [ "$BACKGROUND_STATUS" = "running" ]; then
  MONITOR_MAX_WAIT_SECONDS="${LESSON_BACKGROUND_MONITOR_MAX_WAIT_SECONDS:-900}"
  MONITOR_POLL_SECONDS="${LESSON_BACKGROUND_MONITOR_POLL_SECONDS:-2}"
  nohup python3 - "$STATE_FILE" "$PID" "$LOG_FILE" "$UNHANDLED_FINGERPRINT" "$SIGNAL_BATCH_BASE64" "$LOG_DIR/spawn-audit.log" "$MONITOR_MAX_WAIT_SECONDS" "$MONITOR_POLL_SECONDS" >/dev/null 2>&1 <<'PYEOF' &
import collections
import json
import os
import sys
import time
import base64
from datetime import datetime
from pathlib import Path

state_file = Path(sys.argv[1])
pid_raw = sys.argv[2]
log_file = Path(sys.argv[3])
fingerprint = sys.argv[4]
batch_payload = json.loads(base64.b64decode(sys.argv[5]).decode('utf-8'))
batch_keys = collections.Counter(
    json.dumps(item, sort_keys=True, ensure_ascii=False)
    for item in batch_payload
)
audit_file = Path(sys.argv[6])
max_wait = int(sys.argv[7])
poll_seconds = max(1, int(sys.argv[8]))

try:
    pid = int(pid_raw)
except ValueError:
    sys.exit(0)

deadline = time.time() + max_wait
while time.time() < deadline:
    try:
        os.kill(pid, 0)
    except OSError:
        break
    time.sleep(poll_seconds)
else:
    sys.exit(0)

try:
    state = json.loads(state_file.read_text(encoding='utf-8'))
except Exception:
    sys.exit(0)

if str(state.get('background_pid', '')) != str(pid):
    sys.exit(0)
if str(state.get('background_fingerprint', '')) != fingerprint:
    sys.exit(0)

lines = []
try:
    lines = log_file.read_text(encoding='utf-8', errors='replace').splitlines()
except Exception:
    pass

first_line = ''
for line in lines:
    stripped = line.strip()
    if stripped:
        first_line = stripped[:240]
        break

text = '\n'.join(lines).lower() if lines else ''
failure_tokens = (
    'failed to authenticate',
    'api error',
    'model not allowed',
    'not logged in',
    'permission denied',
    'command not found',
    'no such file or directory',
)
failed = any(token in text for token in failure_tokens)
remaining_batch = 0
for item in state.get('signals', []):
    key = json.dumps({
        'type': item.get('type'),
        'turn': item.get('turn'),
        'target': item.get('target'),
        'snippet': item.get('snippet'),
        'count': item.get('count'),
        'correction_count': item.get('correction_count'),
    }, sort_keys=True, ensure_ascii=False)
    if batch_keys.get(key, 0) > 0 and not item.get('handled'):
        remaining_batch += 1
        batch_keys[key] -= 1

now = datetime.utcnow().isoformat() + 'Z'
state['background_spawned'] = False
state.pop('background_pid', None)
state['background_completed_at'] = now
state['background_last_attempt_at'] = now

if remaining_batch == 0:
    state['background_status'] = 'completed'
    state.pop('background_failed_at', None)
    state.pop('background_error', None)
    audit_message = f"{datetime.now().isoformat(timespec='seconds')}: Lesson capture background process completed (pid={pid}). Log: {log_file}\n"
elif failed or first_line:
    state['background_status'] = 'failed'
    state['background_failed_at'] = now
    state['background_error'] = first_line or 'background process exited without clearing signals'
    audit_message = f"{datetime.now().isoformat(timespec='seconds')}: Lesson capture background process exited with failure (pid={pid}). Error: {state['background_error']}. Log: {log_file}\n"
else:
    state['background_status'] = 'failed'
    state['background_failed_at'] = now
    state['background_error'] = 'background process exited without clearing signals'
    audit_message = f"{datetime.now().isoformat(timespec='seconds')}: Lesson capture background process exited with failure (pid={pid}) without explicit error line. Log: {log_file}\n"

try:
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
except Exception:
    pass

try:
    audit_file.parent.mkdir(parents=True, exist_ok=True)
    with audit_file.open('a', encoding='utf-8') as fh:
        fh.write(audit_message)
except Exception:
    pass
PYEOF
fi

# Exit 0 to allow the main agent to continue
# The lesson capture happens independently in the background
exit 0
