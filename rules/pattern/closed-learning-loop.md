---
paths:
  - "src/**/*"
  - "lib/**/*"
  - "app/**/*"
  - "recall/**/*"
  - "memory/**/*"
---

# Closed Learning Loop Pattern

> 来源：
> - https://github.com/NousResearch/hermes-agent
> - https://hermes-agent.nousresearch.com/docs/
> 吸收时间：2026-04-09

## 触发条件

当设计长期运行、跨 session 累积能力的 Agent 时：

- 需要决定 transcript / task / notes / memory / recall / skills / user model 的边界
- 需要让 Agent 从历史执行中逐步变强
- 外部 recall 或用户建模存在明显延迟
- 需要避免“所有东西都塞进一个记忆仓库”
- 吸收外部 agent / framework 架构，并判断是否应直接优化本地系统

## 核心原则

**把“可持续学习”拆成多条回路，而不是一个万能 memory。**

同时遵守三条硬约束：

- `notes/` 是沉淀层，不是 recall engine
- `memory/` 不是万能仓，不混放过程日志/任务状态/技能正文
- episodic recall 是“检索与压缩过程”的实现层，不是任意目录别名

## 职责边界（必须同时成立）

| 层 | 作用 | 典型内容 | 明确不做 |
|----|------|----------|----------|
| **Transcript / Session Log** | 记录原始过程事实 | 对话、命令、报错、临时决策 | 不做长期事实注入 |
| **Task (`tasks/`)** | 推进当前任务闭环 | `prd/context/status/feature-list` | 不做跨任务方法论沉淀 |
| **Notes (`notes/`)** | 沉淀跨任务可复用结论 | lessons/research/design | 不做 session recall 查询引擎 |
| **Episodic Recall（实现层）** | 从 transcript/task 中检索并压缩回忆片段 | 查询结果、聚焦摘要 | 不直接承担长期存储职责 |
| **Declarative Memory (`memory/`)** | 稳定事实快照，供后续注入 | 偏好、稳定约束、环境事实 | 不混放任务进度、一次性排障过程 |
| **Procedural Memory (`skills/`)** | 固化“怎么做” | 可执行 workflow、操作套路 | 不替代事实存储 |
| **User Model（可选独立层）** | 长期用户/AI 表征推理 | profile、偏好推断、个性化策略 | 不与 declarative memory 混仓 |

## 最小 Runtime Mapping（截至 2026-04-10）

| 层 | 当前存储层（已存在） | 当前实现层（已存在） | 仍缺的实现层 |
|----|---------------------|---------------------|--------------|
| Transcript | `history.jsonl`、`sessions/` 等原始记录 | 可手动检索/回读 | 更强的结构化检索与排序策略 |
| Task | `tasks/<task>/` 文档与状态文件 | task-centric 工作流、feature 验证链 | 与 recall 的更细粒度标准化接入点 |
| Notes | `notes/` + promotion queue | note 写入、晋升评估流程 | 面向 recall 的结构化检索层（当前不应由 notes 直接承担） |
| Declarative Memory | `memory/` 目录与索引文件 | `memory/declarative/` 最小 schema、owner、写入边界 | 自动化 upsert helper、注入消费协议 |
| Episodic Recall | `recall/entries.jsonl` 独立 store | `UserPromptSubmit -> recall-entrypoint` 查询、`Stop -> recall-capture` 写入 | Hermes 式更强的 `session_search -> 聚焦摘要` runtime |
| User Model | `profiles/` 等资产存在 | 无稳定读写/消费协议 | 独立 schema、prefetch/cache、消费方 |

结论：当前已具备 recall/declarative memory 的**最小实现层 contract**，但仍未达到 Hermes 式完整 runtime。不得把“已有最小 runtime”表述成“已经完全对齐 Hermes 实现”。

## 执行规范

### 1. Declarative Memory 只存稳定事实

- 写入：用户偏好、稳定约束、环境事实、长期约定
- 不写：任务进度、一次性报错、临时 TODO、单次产物摘要
- 注入方式：session 级 frozen snapshot（优先下个 session 注入）

### 2. Episodic Recall 从 transcript/task 读取，不从 notes 假装读取

- 过程事实先落 transcript / task
- recall 负责“按需取回 + 压缩”，不改写 `notes/` 的定位
- 不要为了“以后可能有用”把执行过程塞进 declarative memory
- recall 的运行时消费方是主 agent（通过 hook 注入短上下文）
- `notes/`、`eat`、`promote-notes` 不是 recall consumer；它们属于沉淀/晋升链路，不直接消费 recall.query 结果

### 3. Notes 负责沉淀与晋升，不承担 recall 引擎职责

- `notes/` 记录可复用结论与取舍
- recall 需要的“会话过程检索”应来自 transcript/task 的实现层
- 即使后续要做 recall，也不把 notes 改造成聊天记录仓

### 3.5 Recall 自动触发必须有轻量门控

- 显式 `recall.query ...` contract 优先级高于任何自动触发
- 自动 recall 只在明显跨轮/恢复信号触发（如 `continue session`、`resume context`、`继续上次`、`恢复上下文`）
- 自动 recall 默认更保守（例如 `k=1`、更小预算），命中不足应直接不注入（`emit({})`）

### 4. Procedural Memory 以 Skill 形式维护

- 当一个任务足够复杂、可复用、重复出现时，沉淀为 skill
- skill 不是静态文档，而是可维护的操作资产
- 运行中发现 skill 过时、缺步骤、命令错误时，应立即 patch

### 5. User Model 单独成层（当前仅保留边界，不宣称已实现）

- 需要 personalization、偏好推理、长期 representation 时再接入
- 不把 user model 内容硬塞进 declarative memory
- 没有 schema/consumer 前，不宣称 user model runtime 已具备

### 6. 高延迟 Recall 走异步预取（原则已定，实现可后置）

- 外部 recall/profile 若高延迟，优先 turn-end 预取、next-turn 消费
- 不要每轮在 prompt build 前同步拉远程 context
- 本条是目标约束，不等于当前已完成通用 prefetch runtime

### 7. 外部学习必须回写本地能力

- 当外部资料与当前系统高度同构时，不要只写 research note
- 识别出的缺口应回写到本地 `rules/skills/hooks/workflows`
- `notes/` 保存来源与推理，不替代本地能力升级

## 判断规则

- “以后都成立的事实” -> Declarative Memory
- “只在当前任务闭环内有效” -> Task 或 Transcript
- “跨任务复用的结论/取舍” -> Notes
- “以后可能复用的做法” -> Skill
- “要从历史过程里找证据片段” -> Episodic Recall（实现层）

## 决策框架

```text
新信息应该写到哪里？
    │
    ├─ 当前任务推进必需，且会快速失效？
    │       ├─ 是结构化任务状态 → Task
    │       └─ 是原始过程证据   → Transcript
    │
    ├─ 脱离当前任务仍成立？
    │       ├─ 是稳定事实/偏好/约束 → Declarative Memory
    │       ├─ 是方法/步骤套路       → Skill
    │       └─ 是结论/取舍/反模式    → Notes
    │
    ├─ 现在要从历史过程找证据片段？
    │       → Episodic Recall（查询 transcript/task 的实现层）
    │
    └─ 需要长期个性化推理？
            → User Model（独立层）
```

## 检查清单

- [ ] 是否把 `事实` 与 `过程` 分开？
- [ ] 是否把 `怎么做` 与 `知道什么` 分开？
- [ ] 是否避免把临时任务进度写进 declarative memory？
- [ ] 是否避免把 `notes/` 当成 recall 查询引擎？
- [ ] 是否避免把 `memory/` 当成混合仓？
- [ ] 是否明确“当前是存储层已存在，还是实现层已存在”？
- [ ] 外部 recall 是否异步预取，而不是同步阻塞？
- [ ] skill 是否支持在使用中修补？
- [ ] 若吸收的是高同构外部架构，是否已经直接优化本地内容，而不只是新增 note？

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 把任务过程、报错、结论一股脑写进 MEMORY.md | 过程进 transcript，稳定事实才进 memory |
| 把 `notes/` 当成 recall engine | notes 只沉淀可复用结论，回忆检索走 transcript/task 的 recall 实现层 |
| 把 `memory/` 当事实+过程+偏好+技能混合仓 | memory 只保稳定事实快照，其他内容分别入 task/transcript/notes/skills |
| skill 只创建不维护 | 发现过时内容立即 patch |
| 每轮同步请求远程 memory/profile 服务 | turn-end async prefetch，next-turn consume |
| 用一个“万能记忆”同时承担事实、历史、技能、用户画像 | 拆成四层回路 |
| 为了跨 session 记住任务进度，污染主 prompt | 保留可搜索 transcript，按需召回 |
| 外部架构调研只停在 research note | 识别高同构后立即 patch 本地 rules/skills/workflows |

## 相关规范

- [[task-notes-boundary]]
- [[code-as-interface]]
- [[living-spec]]
