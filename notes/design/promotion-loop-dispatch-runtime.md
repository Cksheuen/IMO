# Promotion Loop Dispatch Runtime

- Status: active
- Date: 2026-03-27
- Trigger: 需要把 `Promotion Loop -> promote-notes subagent` 从设计说明补到可执行调度协议

## 目标

把以下职责边界变成实际运行链：

- hook：发现候选、守门、提示
- 主 agent / orchestrator：claim queue、派发 subagent、处理异常恢复
- `promote-notes` subagent：完整评估、写知识资产、回写结果

## 当前运行时协议

### 1. 候选发现

- `promotion-scan.py` 在 `Stop` / `SubagentStop` 轻量扫描最近 notes
- 命中候选时写入根目录 `promotion-queue.json`

### 2. 结束守门

- `promotion-gate.py` 检查 queue 中是否仍有 actionable candidates
- 若有，则 block stop，要求继续 Promotion Loop

### 3. queue claim

主 agent / orchestrator 运行：

```bash
python3 .claude/hooks/promotion-dispatch.py claim
```

效果：

- 选取 `pending/failed` 候选
- 标记为 `processing`
- 输出 `promotionDispatch.prompt`

### 4. 派发 subagent

主 agent / orchestrator 调用：

```text
Task(
  subagent_type: "promote-notes",
  prompt: promotionDispatch.prompt,
  model: "opus",
  run_in_background: true
)
```

`inject-subagent-context.py` 会自动注入：

- `skills/promote-notes/SKILL.md`
- `notes/design/promotion-scan-execution-bridge.md`
- `notes/design/notes-to-rules-skills-promotion.md`
- `notes/README.md`
- `promotion-queue.json`

### 5. 结果回写

subagent 必须：

1. 写 `promotion-result.json`
2. 运行：

```bash
python3 .claude/hooks/promotion-apply-result.py --result-file promotion-result.json
```

该 wrapper 内部调用 `promotion-dispatch.py apply`。

### 6. 异常恢复

如果 subagent 在 apply 之前异常退出，主链路运行：

```bash
python3 .claude/hooks/promotion-dispatch.py fail --error "promote-notes subagent failed"
```

效果：

- 将 `processing` 候选恢复成 `failed`
- 保留 queue，避免候选丢失

## 当前事实源

- queue 单一事实源：仓库根目录 `promotion-queue.json`
- 不再使用 `.claude/promotion-queue.json` 作为运行时事实源

## 结论

到这一层为止，Promotion Loop 已经不是“提醒去做”，而是具备标准 queue 协议的可执行调度链。

真正的剩余问题只会是：调用方是否遵守这条链，而不是链本身缺失。
