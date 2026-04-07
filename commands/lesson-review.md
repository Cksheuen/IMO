/lesson-review

显式触发 `lesson-review` 技能，回顾 `~/.claude/lesson-signals.json` 中尚未回顾（`handled != true`）的内容。

适用场景：
- 用户要求“回顾教训”
- 需要手动处理最近的 correction / lesson signals
- 想把尚未沉淀的纠正信号归并进 `notes/lessons/`

执行要求：
- 只处理未 handled 的 signals
- 若没有未回顾内容，直接返回“当前没有未回顾内容”
- 写入 `notes/lessons/` 成功后，再标记这些 signals 为 handled
