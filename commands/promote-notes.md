/promote-notes

显式触发 `promote-notes` 技能，或继续处理当前 `promotion-queue.json` 中待晋升的候选。

适用场景：
- 用户要求“提炼 notes”
- 自动 Promotion Loop 关闭后，需要手动继续处理
- 需要人工检查 queue 中的候选并做 promote / merge / keep 决策

模式切换统一走 `/promotion-mode on|off|status`。
