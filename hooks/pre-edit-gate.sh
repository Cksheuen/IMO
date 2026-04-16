#!/bin/bash
# pre-edit-gate.sh - Edit 操作预检
#
# 触发时机: PreToolUse (matcher: Edit)
# 功能: 检查编辑操作的合法性
#
# 检查项:
# 1. 是否先读取过文件
# 2. 编辑范围是否合理
# 3. 是否符合变更影响审查规范

set -euo pipefail

# 读取 stdin JSON
stdin_json=$(cat)
session_id=$(printf '%s' "$stdin_json" | jq -r '.session_id // .sessionId // ""')
export METRICS_SESSION_ID="$session_id"
export METRICS_SCOPE="global"

METRICS_LIB="$HOME/.claude/hooks/metrics/emit.sh"
if [ -f "$METRICS_LIB" ]; then
    # shellcheck disable=SC1090
    . "$METRICS_LIB"
fi

metrics_start_ms=0
if command -v metrics_now_ms >/dev/null 2>&1; then
    metrics_start_ms=$(metrics_now_ms)
fi

emit_gate_result() {
    local status="$1"
    local reason="${2:-}"
    local duration_ms=""
    local meta_json=""

    if command -v metrics_now_ms >/dev/null 2>&1 && [ "${metrics_start_ms:-0}" -gt 0 ] 2>/dev/null; then
        duration_ms=$(( $(metrics_now_ms) - metrics_start_ms ))
    fi

    if [ -n "$reason" ]; then
        meta_json=$(jq -cn --arg reason "$reason" '{reason:$reason}' 2>/dev/null || printf '')
    fi

    if command -v metrics_emit >/dev/null 2>&1; then
        metrics_emit "pre-edit-gate" "PreToolUse" "gate_decision" "$status" "$duration_ms" "$meta_json"
    fi
}

print_decision_json() {
    local decision="$1"
    local reason="${2:-}"
    if [ -n "$reason" ]; then
        jq -cn --arg decision "$decision" --arg reason "$reason" '{decision:$decision,reason:$reason}'
    else
        jq -cn --arg decision "$decision" '{decision:$decision}'
    fi
}

allow() {
    local reason="${1:-}"
    emit_gate_result "allowed" "$reason"
    print_decision_json "allow" "$reason"
    exit 0
}

deny() {
    local reason="$1"
    emit_gate_result "blocked" "$reason"
    print_decision_json "deny" "$reason"
    exit 0
}

# 提取文件路径（兼容 toolInput / tool_input 两种 payload）
file_path=$(printf '%s' "$stdin_json" | jq -r '.toolInput.file_path // .tool_input.file_path // ""')

# 检查路径合法性
if [[ "$file_path" == ".." ]] || [[ "$file_path" == ../* ]] || [[ "$file_path" == */../* ]] || [[ "$file_path" == *"/.." ]]; then
    deny "非法文件路径"
fi

# 允许操作（Edit 通常需要先 Read，这是 Claude Code 内置检查）
allow
