/promote-notes

显式触发 `promote-notes` 技能或继续处理当前 `promotion-queue.json` 里的待晋升候选。

适用场景：
- 用户要求“提炼 notes”
- 需要手动继续 `Promotion Loop`
- `promotion-gate.py` 阻止结束后，需要消费 queue

执行要求：
- 先运行 `python3 .claude/hooks/promotion-dispatch.py claim`
- 若有候选，则派发 `subagent_type: "promote-notes"`
- subagent 完成后必须运行 `python3 .claude/hooks/promotion-apply-result.py --result-file promotion-result.json`
