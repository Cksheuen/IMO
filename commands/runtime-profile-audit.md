/runtime-profile-audit

只读对比共享 runtime 与当前仓库开发态 runtime。

执行要求：
1. 运行 `python3 "$HOME/.claude/scripts/runtime-profile-audit.py"`
2. 返回：
   - `shared_profile`
   - `repo_dev_profile`
   - `overlap_summary`
3. 默认只读，不修改任何 settings 或 hooks 挂载
