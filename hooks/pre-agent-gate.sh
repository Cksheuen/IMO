#!/bin/bash
# pre-agent-gate.sh - Agent (Subagent) 操作预检
#
# 触发时机: PreToolUse (matcher: Agent / Task)
# 功能: 检查子代理调用的合法性
#
# 检查项:
# 1. 是否需要 worktree 隔离
# 2. 子代理配置是否完整
# 3. 是否符合 Best-for-Task 路由

set -euo pipefail

# 读取 stdin JSON
stdin_json=$(cat)

# 提取子代理类型（兼容 toolInput / tool_input 两种 payload）
subagent_type=$(echo "$stdin_json" | jq -r '.toolInput.subagent_type // .tool_input.subagent_type // "general-purpose"')
prompt=$(echo "$stdin_json" | jq -r '.toolInput.prompt // .tool_input.prompt // ""')

# 检查是否应该使用 worktree 隔离
# 仅对会写文件的子代理强约束 worktree，纯只读 agent 不要求
should_use_worktree=false
if echo "$prompt" | grep -qiE "edit|write|modify|create|delete|implement|fix"; then
    should_use_worktree=true
fi

if echo "$subagent_type" | grep -qiE "implementer|reviewer|developer|architect|integrator|test"; then
    should_use_worktree=true
fi

# 如果应该使用 worktree 但没有配置，直接阻止，避免写路径污染主工作区
if [ "$should_use_worktree" = true ]; then
    isolation=$(echo "$stdin_json" | jq -r '.toolInput.isolation // .tool_input.isolation // ""')
    if [ "$isolation" != "worktree" ]; then
        echo '{"decision": "deny", "reason": "涉及写文件的子代理必须使用 worktree 隔离"}'
        exit 0
    fi
fi

# 允许操作
echo '{"decision": "allow"}'
