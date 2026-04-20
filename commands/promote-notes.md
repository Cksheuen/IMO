/promote-notes

显式触发 `promote-notes` 技能，或继续处理当前 `promotion-queue.json` 中待晋升的候选。

当前默认设计：**手动触发为主，自动扫描/排队为辅。**

适用场景：
- 用户要求“提炼 notes”
- 自动 Promotion Loop 关闭后，需要手动继续处理
- 需要人工检查 queue 中的候选并做 promote / merge / keep 决策

推荐手动主路径：
1. `python3 "$HOME/.claude/scripts/promote-notes-run.py" scan`
2. `python3 "$HOME/.claude/scripts/promote-notes-run.py" list`
3. `python3 "$HOME/.claude/scripts/promote-notes-run.py" claim --count 1`
4. `python3 "$HOME/.claude/scripts/promote-notes-run.py" stub-result`
5. 手动编辑 `"$HOME/.claude/promotion-result.json"`，把占位 `defer` 改成最终 action
6. `python3 "$HOME/.claude/scripts/promote-notes-run.py" apply`
7. 若 queue 中仍有待处理项，再 claim 下一批

兼容底层命令：
- helper 只是人工调用包装层，底层仍复用 `promotion-dispatch.py` 与 `promotion-apply-result.py`
- 若需要自定义输出路径，可显式传 `--out`、`--claim-file`、`--output`、`--result-file`

结果文件约定：
- `promoted_to_rule`：生成或更新 rule
- `promoted_to_skill`：生成 skill
- `indexed_in_memory`：写 canonical declarative record，必须带 `record`
- `keep`：继续留在 notes，但本次评估已完成，可出队
- `defer`：证据不足，继续留在 queue

注意：
- `stub-result` 只生成可编辑模板，不自动做晋升决策
- 若直接对未编辑的 stub 执行 `apply`，候选会按 `defer` 处理并继续留在 queue
- `promoted_to_skill` 现在会生成更偏 procedural memory 的 `SKILL.md`，不再简单搬运 note 正文

模式切换统一走 `/promotion-mode on|off|status`。
