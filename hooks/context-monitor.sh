#!/bin/bash
# context-monitor.sh - 上下文使用监控
#
# 触发时机: Stop (在 verification-gate 和 lesson-gate 之后)
# 功能: 监控上下文使用情况，主动发出警告
#
# 基于 Claude Code 架构:
# - 200K context window
# - 83.5% 自动压缩触发点
# - 33K-45K buffer

set -euo pipefail

# 读取 stdin JSON
read -r stdin_json

# 提取上下文信息
# 注意: Claude Code 的 Stop hook 可能不直接提供 token 统计
# 这里主要依赖 Claude 的自我报告

session_id=$(echo "$stdin_json" | jq -r '.session_id // ""')
transcript_path=$(echo "$stdin_json" | jq -r '.transcript_path // ""')

# 检查是否有上下文警告信号
# 这需要 Claude 在会话中主动报告

# 输出上下文监控信息（用于日志）
LOG_FILE="$HOME/.claude/context-monitor.log"
echo "[$(date -Iseconds)] Session: $session_id - Stop event monitored" >> "$LOG_FILE"

# 不阻止退出，只做监控
echo '{}'
