#!/bin/bash
# pre-write-gate.sh - Write 操作预检
#
# 触发时机: PreToolUse (matcher: Write)
# 功能: 检查写入操作的合法性
#
# 检查项:
# 1. 目标文件路径是否合法
# 2. 是否命中明确禁止的系统路径
# 3. 对 task 目录缺失只做提示，不假设 bootstrap 已接入

set -euo pipefail

# 读取 stdin JSON
read -r stdin_json

# 提取文件路径
file_path=$(echo "$stdin_json" | jq -r '.toolInput.file_path // ""')

# 检查路径是否在允许范围内
if [[ "$file_path" == ".." ]] || [[ "$file_path" == ../* ]] || [[ "$file_path" == */../* ]] || [[ "$file_path" == *"/.." ]] || [[ "$file_path" == /etc/* ]]; then
    echo '{"decision": "deny", "reason": "非法文件路径"}'
    exit 0
fi

# 当前共享运行时尚未接入 task bootstrap。
# 如果目标 task 目录不存在，只给出提示，不阻止正常创建流程。
if [[ "$file_path" == *"/.claude/tasks/"* ]] && [[ "$file_path" != *"README.md" ]]; then
    task_dir=$(dirname "$file_path")
    if [ ! -d "$task_dir" ]; then
        echo "{\"decision\": \"allow\", \"reason\": \"任务目录尚不存在；当前共享运行时未自动 bootstrap，可按需手动创建: $task_dir\"}"
        exit 0
    fi
fi

# 允许操作
echo '{"decision": "allow"}'
