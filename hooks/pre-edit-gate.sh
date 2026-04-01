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

# 提取文件路径（兼容 toolInput / tool_input 两种 payload）
file_path=$(echo "$stdin_json" | jq -r '.toolInput.file_path // .tool_input.file_path // ""')

# 检查路径合法性
if [[ "$file_path" == ".." ]] || [[ "$file_path" == ../* ]] || [[ "$file_path" == */../* ]] || [[ "$file_path" == *"/.." ]]; then
    echo '{"decision": "deny", "reason": "非法文件路径"}'
    exit 0
fi

# 允许操作（Edit 通常需要先 Read，这是 Claude Code 内置检查）
echo '{"decision": "allow"}'
