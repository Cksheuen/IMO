#!/bin/bash
# Weekly freeze-analyzer trigger.
#
# Runs freeze-analyzer.py at most once per ISO week per host.
# Primary trigger: ISO weekday 7 (Sunday).
# Fallback: first SessionEnd in a new ISO week if previous week was skipped.
#
# This script is intentionally non-blocking and never fails the SessionEnd
# chain — all errors are swallowed.

set -u

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
ANALYZER="$CLAUDE_HOME/hooks/metrics/freeze-analyzer.py"
LOG="$CLAUDE_HOME/consolidation.log"
# Use Python's socket.gethostname() so the marker filename matches exactly
# with what freeze-analyzer.py writes (no stray newline or trailing underscore).
HOSTNAME_SAFE=$(python3 -c 'import socket; print(socket.gethostname())' 2>/dev/null)
if [ -z "$HOSTNAME_SAFE" ]; then
  HOSTNAME_SAFE=$(hostname 2>/dev/null | tr -d '\n' | tr -c 'A-Za-z0-9._-' '_' | head -c 64)
fi
MARKER="$CLAUDE_HOME/metrics/.freeze-marker-${HOSTNAME_SAFE}.json"

mkdir -p "$CLAUDE_HOME/metrics"

# Compute ISO week and weekday.
CURRENT_WEEK=$(date -u +%G-W%V 2>/dev/null || date +%Y-W%U)
WEEKDAY=$(date +%u)  # 1=Mon ... 7=Sun

should_run() {
  # Read last_run_iso_week from marker; empty if absent.
  local last_week=""
  if [ -f "$MARKER" ]; then
    last_week=$(python3 - "$MARKER" <<'PY' 2>/dev/null
import json, sys
from pathlib import Path
try:
    d = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(d.get("last_run_iso_week", ""))
except Exception:
    print("")
PY
)
  fi

  # Already ran this week -> skip.
  if [ "$last_week" = "$CURRENT_WEEK" ]; then
    return 1
  fi

  # Primary trigger: Sunday.
  if [ "$WEEKDAY" = "7" ]; then
    return 0
  fi

  # Fallback: last_week is non-empty and is older than current week,
  # meaning we missed the Sunday of the previous cycle. Catch up on the
  # first SessionEnd in the new week.
  if [ -n "$last_week" ] && [ "$last_week" != "$CURRENT_WEEK" ]; then
    return 0
  fi

  # No prior run on record and not Sunday: wait for the first Sunday.
  return 1
}

if ! should_run; then
  exit 0
fi

if [ ! -f "$ANALYZER" ]; then
  exit 0
fi

# Run analyzer in background; update marker only on successful exit.
(
  if python3 "$ANALYZER" --days 14 >> "$LOG" 2>&1; then
    python3 - "$MARKER" "$CURRENT_WEEK" <<'PY' 2>/dev/null || true
import json, sys, os
from datetime import datetime
from pathlib import Path

marker_path = Path(sys.argv[1])
week = sys.argv[2]
payload = {
    "last_run_iso_week": week,
    "last_run_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    "hostname": os.uname().nodename,
}
marker_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
PY
  fi
) &

exit 0
