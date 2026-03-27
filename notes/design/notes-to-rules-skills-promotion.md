# Notes to Rules/Skills Promotion

- Status: proposed
- Date: 2026-03-27
- Trigger: 需要把 `notes` 真正接入提炼闭环，而不是停留在沉淀层

## 问题

如果只有 `brainstorm -> notes`，没有独立的 `notes -> promotion -> rules/skills`，那么 `notes/` 仍然只是缓冲区，而不是知识演化链条的一部分。

## 目标

- 明确哪些 note 可以继续停留在 `notes/`
- 明确什么时候应该被动晋升到 `rules/` 或 `skills/`
- 将 `notes` 的晋升路径与 `eat` 解耦

## 晋升闭环

```text
Correction / Research / Design / Recovery Loop
                    │
                    ▼
                 notes/
                    │
        （复用验证 / 状态稳定 / 触发条件成形）
                    │
                    ▼
             Promotion Loop
                    │
        ├─ 短而稳定、可执行 → rules/
        ├─ 长且流程化、按需触发 → skills/
        └─ 仍在变化 → 回写 notes/
```

## 晋升触发条件

满足任意两项时，被动触发 `Promotion Loop`：

- 同一主题被再次复用
- 触发条件已经清晰
- 执行步骤已经稳定
- 决策框架已不再依赖单个案例
- 不同任务中都出现相同教训或模式

## 不应晋升的信号

- 只有一次案例
- 仍高度依赖具体上下文
- 主要价值是解释背景，而不是指导动作
- 触发条件仍模糊

## 去向判断

- `rules/`：短、稳定、可执行、应被频繁引用
- `skills/`：长流程、工具导向、低频但高步骤数
- `notes/`：仍在探索、主要是解释、需要继续观察

## 与现有循环的关系

- `brainstorm` 负责把探索和调研写入 `notes/`
- `CLAUDE.md` 的 Learn / Correction Loop 负责把错误与教训写入 `notes/lessons/`
- `eat` 负责吸收新资料，而不是负责旧 note 的默认晋升
- `Promotion Loop` 负责把已经稳定的 note 被动晋升为更强约束的知识资产

## 结论

`notes/` 不是终点，而是知识演化链条中的中间层。

缺少提炼闭环时，它会越积越多；
补上独立的 `Promotion Loop` 后，它才会持续收敛成更稳定的 `rules/` 与 `skills/`。
