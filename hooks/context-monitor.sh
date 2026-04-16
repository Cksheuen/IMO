#!/bin/bash
# context-monitor.sh - 上下文使用监控
#
# 触发时机: Stop (在 verification-gate 之后)
# 功能: 监控上下文使用情况，主动发出警告
#
# 基于 Claude Code 架构:
# - 200K context window
# - 83.5% 自动压缩触发点
# - 33K-45K buffer

set -euo pipefail

METRICS_STATUS="ok"
METRICS_LIB="$HOME/.claude/hooks/metrics/emit.sh"

# 读取 stdin JSON
stdin_json=$(cat)

session_id=$(printf '%s' "$stdin_json" | jq -r '.session_id // .sessionId // ""')
export METRICS_SESSION_ID="$session_id"
export METRICS_SCOPE="global"

if [ -f "$METRICS_LIB" ]; then
    # shellcheck disable=SC1090
    . "$METRICS_LIB"
fi

metrics_start_ms=0
if command -v metrics_now_ms >/dev/null 2>&1; then
    metrics_start_ms=$(metrics_now_ms)
fi

metrics_finalize() {
    local exit_code=$?
    local duration_ms=""

    if [ "$exit_code" -ne 0 ]; then
        METRICS_STATUS="error"
    fi

    if command -v metrics_now_ms >/dev/null 2>&1 && [ "${metrics_start_ms:-0}" -gt 0 ] 2>/dev/null; then
        duration_ms=$(( $(metrics_now_ms) - metrics_start_ms ))
    fi

    if command -v metrics_emit >/dev/null 2>&1; then
        metrics_emit "context-monitor" "Stop" "hook_run" "$METRICS_STATUS" "$duration_ms"
    fi
}

trap metrics_finalize EXIT

# 提取上下文信息
# 注意: Claude Code 的 Stop hook 可能不直接提供 token 统计
# 这里主要依赖 Claude 的自我报告

session_id=$(printf '%s' "$stdin_json" | jq -r '.session_id // .sessionId // ""')
transcript_path=$(printf '%s' "$stdin_json" | jq -r '.transcript_path // .transcriptPath // ""')

# 检查是否有上下文警告信号
# 这需要 Claude 在会话中主动报告

# 输出上下文监控信息（用于日志）
LOG_FILE="$HOME/.claude/context-monitor.log"
echo "[$(date -Iseconds)] Session: $session_id - Stop event monitored" >> "$LOG_FILE"

# 不阻止退出，只做监控
echo '{}'
