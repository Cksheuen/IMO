#!/bin/bash
# StatusLine Wrapper - pipes data to both rate-limit-monitor and claude-hud
# Replaces the original statusLine command in settings.json

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

tee >("$SCRIPT_DIR/rate-limit-monitor.sh" 2>/dev/null) | \
  "/Users/cksheuen/.bun/bin/bun" "$(ls -td ~/.claude/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | head -1)src/index.ts"
