/codex-feedback-review

显式触发 `codex-feedback-review` 技能，处理 `~/.claude/shared-knowledge/codex-feedback.jsonl` 中自 `sync-manifest.json:last_processed_timestamp` 以来的增量反馈。

适用场景：
- 用户要求“回顾 codex 反馈”
- 需要把最近的 codex task / review 经验沉淀进 `notes/lessons/`
- 想手动消费尚未处理的 codex feedback 增量

执行要求：
- 先按 manifest 游标做增量扫描
- 没有新 feedback 时直接返回“当前没有新的 Codex feedback 待处理”
- 只有写入成功后，才更新 `last_processed_timestamp`
