#!/bin/bash
# pre-write-gate.sh - Write 操作预检
#
# 触发时机: PreToolUse (matcher: Write)
# 功能: 检查写入操作的合法性
#
# 检查项:
# 1. 目标文件路径是否合法
# 2. 是否命中明确禁止的系统路径
# 3. 对 task 目录缺失给出提示，避免绕过当前 task workflow

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
        metrics_emit "pre-write-gate" "PreToolUse" "gate_decision" "$status" "$duration_ms" "$meta_json"
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

# 检查路径是否在允许范围内
if [[ "$file_path" == ".." ]] || [[ "$file_path" == ../* ]] || [[ "$file_path" == */../* ]] || [[ "$file_path" == *"/.." ]] || [[ "$file_path" == /etc/* ]]; then
    deny "非法文件路径"
fi

# 当前共享运行时已接入 task bootstrap。
# 如果目标 task 目录不存在，只给出提示，不阻止正常创建流程。
if [[ "$file_path" == *"/.claude/tasks/"* ]] && [[ "$file_path" != *"README.md" ]]; then
    task_dir=$(dirname "$file_path")
    if [ ! -d "$task_dir" ]; then
        allow "任务目录尚不存在；当前会话应先经过 scale-gate/bootstrap，再按需创建: $task_dir"
    fi
fi

# 允许操作
allow
