#!/bin/bash
# StatusLine Wrapper - always updates rate-limit state, and forwards to claude-hud when available.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONITOR_SCRIPT="$SCRIPT_DIR/rate-limit-monitor.sh"
LOG_FILE="$HOME/.claude/rate-limit.log"

INPUT=$(cat)

find_hud_script() {
  local base_dir="${CLAUDE_HUD_CACHE_DIR:-$HOME/.claude/plugins/cache/claude-hud/claude-hud}"

  if [ -d "$base_dir" ]; then
    find "$base_dir" -mindepth 2 -maxdepth 2 -path '*/src/index.ts' -print 2>/dev/null | sort | tail -n 1
  fi
}

find_bun() {
  if [ -n "${CLAUDE_HUD_BUN:-}" ] && [ -x "${CLAUDE_HUD_BUN}" ]; then
    printf '%s\n' "$CLAUDE_HUD_BUN"
    return 0
  fi

  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi

  if [ -x "$HOME/.bun/bin/bun" ]; then
    printf '%s\n' "$HOME/.bun/bin/bun"
    return 0
  fi

  return 1
}

log_fallback() {
  local reason="$1"
  printf '[%s] statusline-wrapper fallback: %s\n' "$(date)" "$reason" >> "$LOG_FILE"
}

printf '%s' "$INPUT" | "$MONITOR_SCRIPT" 2>/dev/null || \
  printf '[%s] statusline-wrapper warning: rate-limit-monitor failed\n' "$(date)" >> "$LOG_FILE"

HUD_SCRIPT=$(find_hud_script)
if [ -z "$HUD_SCRIPT" ]; then
  log_fallback "claude-hud script not found"
  exit 0
fi

if ! BUN_BIN=$(find_bun); then
  log_fallback "bun executable not found"
  exit 0
fi

printf '%s' "$INPUT" | "$BUN_BIN" "$HUD_SCRIPT"

