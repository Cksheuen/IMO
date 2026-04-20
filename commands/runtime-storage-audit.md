/runtime-storage-audit

只读审计本地 runtime-heavy 目录的体积与职责边界。

执行要求：
1. 运行 `python3 "$HOME/.claude/scripts/runtime-storage-audit.py"`
2. 返回：
   - `plugins`
   - `projects`
   - `tasks`
   - `file-history`
   - `specs`
3. 默认只读，不删除、不移动任何目录内容
