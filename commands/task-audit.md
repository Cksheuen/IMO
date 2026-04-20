/task-audit

只读审计当前任务池，识别重复主题、draft、legacy 和非标准目录。

执行要求：
1. 运行 `python3 "$HOME/.claude/scripts/task-audit.py" --root "$HOME/.claude/tasks"`
2. 返回总目录数、分类统计、重复主题列表
3. 默认只读，不自动删除、重命名或移动 task 目录

可选：
- 需要结构化输出时，运行 `python3 "$HOME/.claude/scripts/task-audit.py" --root "$HOME/.claude/tasks" --json`
