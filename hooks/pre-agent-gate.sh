#!/bin/bash
# pre-agent-gate.sh - Agent (Subagent) 操作预检
#
# 触发时机: PreToolUse (matcher: Agent / Task)
# 功能: 检查子代理调用的合法性
#
# 检查项:
# 1. 是否需要 worktree 隔离
# 2. 是否存在递归 delegation / 深度失控
# 3. 是否越权写入共享治理资产
# 4. 是否要求回传完整中间过程（污染父上下文）

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

# 提取子代理类型（兼容 toolInput / tool_input 两种 payload）
subagent_type=$(printf '%s' "$stdin_json" | jq -r '.toolInput.subagent_type // .tool_input.subagent_type // "general-purpose"')
prompt=$(printf '%s' "$stdin_json" | jq -r '.toolInput.prompt // .tool_input.prompt // ""')
isolation=$(printf '%s' "$stdin_json" | jq -r '.toolInput.isolation // .tool_input.isolation // ""')
delegation_depth=$(printf '%s' "$stdin_json" | jq -r '.toolInput.delegation_depth // .tool_input.delegation_depth // .toolInput.depth // .tool_input.depth // .toolInput.parent_depth // .tool_input.parent_depth // ""')

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
        metrics_emit "pre-agent-gate" "PreToolUse" "gate_decision" "$status" "$duration_ms" "$meta_json"
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

# 检查是否应该使用 worktree 隔离
# 仅对会写文件的子代理强约束 worktree，纯只读 agent 不要求
should_use_worktree=false
readonly_intent=false
if echo "$prompt" | grep -qiE "只读|read-only|readonly|不修改|不要修改|无需修改|do not modify|don't modify|no file changes"; then
    readonly_intent=true
fi

if [ "$readonly_intent" != true ] && echo "$prompt" | grep -qiE "edit|write|modify|create|delete|implement|fix|patch|update|修改|编辑|实现|修复"; then
    should_use_worktree=true
fi

if echo "$subagent_type" | grep -qiE "implementer|reviewer|developer|architect|integrator|test"; then
    should_use_worktree=true
fi

# 如果应该使用 worktree 但没有配置，直接阻止，避免写路径污染主工作区
if [ "$should_use_worktree" = true ]; then
    if [ "$isolation" != "worktree" ]; then
        deny "涉及写文件的子代理必须使用 worktree 隔离"
    fi
fi

# 递归 delegation / 深度失控保护（默认 max depth = 1）
if [[ "$delegation_depth" =~ ^[0-9]+$ ]] && [ "$delegation_depth" -gt 1 ]; then
    deny "delegation depth > 1 默认禁止；需显式授权后再放行"
fi

if echo "$prompt" | grep -qiE "Agent[[:space:]]*\(|spawn[[:space:]]+(implementer|researcher|reviewer|subagent|agent)|delegate[[:space:]]+to[[:space:]]|/orchestrate"; then
    if ! echo "$prompt" | grep -q "\[ALLOW_RECURSIVE_DELEGATION\]"; then
        deny "检测到递归 delegation 意图；默认禁止子 agent 再次委派"
    fi
fi

# 共享治理资产写入默认禁止（capability isolation 不等于 worktree isolation）
if echo "$prompt" | grep -qiE "(可修改|允许修改|allowed to modify|can modify|write to|修改以下文件).*(AGENTS\\.md|CLAUDE\\.md|settings\\.json|hooks/|rules/|skills/|memory/|notes/)"; then
    if ! echo "$prompt" | grep -q "\[ALLOW_SHARED_STATE_WRITE\]"; then
        deny "共享治理资产写入默认禁止；需显式授权标记 [ALLOW_SHARED_STATE_WRITE]"
    fi
fi

# summary-only 回流保护：默认不允许要求完整中间过程
if echo "$prompt" | grep -qiE "完整日志|完整中间过程|完整推理|原始推理|full log|all intermediate|full transcript|step-by-step reasoning|chain-of-thought"; then
    if ! echo "$prompt" | grep -q "\[ALLOW_VERBOSE_RETURN\]"; then
        deny "子 agent 默认应 summary-only 返回；禁止要求完整中间过程"
    fi
fi

# 允许操作
allow
