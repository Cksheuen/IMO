---
name: codex-feedback-review
description: 显式回顾 Codex 反馈并将增量模式沉淀到 `notes/lessons/`。仅在用户明确要求“回顾 codex 反馈”“处理 codex feedback”“总结最近的 codex 执行经验”或使用 `/codex-feedback-review` 时触发。读取 `~/.claude/shared-knowledge/codex-feedback.jsonl` 与 `~/.claude/shared-knowledge/sync-manifest.json`，只处理自上次处理时间戳之后的增量条目；写入成功后再更新 manifest。
---

# Codex Feedback Review

**默认不自动运行，只在显式触发时执行。**

## 目标

把 Codex 执行日志中自上次处理以来的新反馈，归纳成可复用的 lesson，并在成功后推进处理游标。

## 数据来源

- `~/.claude/shared-knowledge/codex-feedback.jsonl`
- `~/.claude/shared-knowledge/sync-manifest.json`
- `~/.claude/notes/lessons/`

## 增量边界

必须按 manifest 中的 `last_processed_timestamp` 做增量处理：

- 只处理 `timestamp > last_processed_timestamp` 的 feedback entries
- 若 manifest 没有该字段，则视为首次处理，可全量扫描
- 若没有新 entries，直接返回“当前没有新的 Codex feedback 待处理”，不要更新 manifest

## 执行步骤

1. 读取 `sync-manifest.json`，获取 `last_processed_timestamp`
2. 用 `process-codex-feedback.py` 扫描 `codex-feedback.jsonl` 的增量 entries
3. 优先 dry-run 看检测结果，确认是否存在可归并模式
4. 需要落盘时，再执行 apply 模式写入/更新 `notes/lessons/`
5. **只有 apply 成功后**，才更新 manifest 的 `last_processed_timestamp`

## 推荐命令

先预览（只看结果，不推进游标）：

```bash
python3 "$HOME/.claude/hooks/codex-sync/process-codex-feedback.py"
```

确认要写入时：

```bash
python3 "$HOME/.claude/hooks/codex-sync/process-codex-feedback.py"   --apply   --min-occurrences 2   --update-manifest "$HOME/.claude/shared-knowledge/sync-manifest.json"
```

## 约束

- 不要在 SessionEnd 或其他后台 hook 中自动执行本技能
- 不要跳过 manifest 增量边界直接重复全量写入
- 不要把 Codex feedback 当作完整会话上下文；它只是摘要化日志
- 不要在没有新 entries 时强行创建 lesson
- 预览模式不应推进 manifest 游标；只有 apply 成功后才允许更新
