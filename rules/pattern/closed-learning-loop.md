# Closed Learning Loop Pattern

> 来源：
> - https://github.com/NousResearch/hermes-agent
> - https://hermes-agent.nousresearch.com/docs/
> 吸收时间：2026-04-09

## 触发条件

当设计长期运行、跨 session 累积能力的 Agent 时：

- 需要决定 memory / session log / skills / user model 的边界
- 需要让 Agent 从历史执行中逐步变强
- 外部 recall 或用户建模存在明显延迟
- 需要避免“所有东西都塞进一个记忆仓库”

## 核心原则

**把“可持续学习”拆成多条回路，而不是一个万能 memory。**

最低应区分四类状态：

| 类型 | 存什么 | 为什么不能混在一起 |
|------|--------|-------------------|
| **Declarative Memory** | 稳定事实、偏好、环境约束 | 需要短、稳、适合提示词注入 |
| **Episodic Recall** | 历史任务过程、对话、报错、临时决策 | 量大、易过时，不适合直接注入 |
| **Procedural Memory** | 可复用 workflow、修复套路、技能 | 属于“怎么做”，不是“知道什么” |
| **User Model** | 跨 session 的用户/AI 表征与高阶推理 | 成本高、节奏慢、适合独立后端 |

## 执行规范

### 1. Declarative Memory 只存稳定事实

- 写入：用户偏好、稳定约束、环境事实、长期约定
- 不写：任务进度、一次性报错、临时 TODO、单次产物摘要
- 注入方式：**session 级 frozen snapshot**

关键要求：

- 本轮可以写磁盘
- 但不要在同一 session 中反复重建 system prompt
- 下个 session 再把新快照注入

### 2. Episodic Recall 通过 transcript/search 召回

- 把完整过程留在 transcript / session store
- 需要时用搜索或摘要召回
- 不要为了“以后可能有用”把执行过程塞进长期 memory

适合放入该层的内容：

- 某次任务做了哪些尝试
- 某个报错是如何被排查的
- 某次讨论达成了什么短期结论

### 3. Procedural Memory 以 Skill 形式维护

- 当一个任务足够复杂、可复用、重复出现时，沉淀为 skill
- skill 不是静态文档，而是**可维护的操作资产**
- 运行中发现 skill 过时、缺步骤、命令错误时，应立即 patch

判断规则：

- “以后都成立的事实” → Declarative Memory
- “以后可能复用的做法” → Skill

### 4. User Model 单独成层

- 当系统开始需要 personalization、偏好推理、长期 representation 时
- 不要继续往普通 memory 中硬塞摘要
- 把这类能力抽成独立 user-model / profile / dialectic layer

好处：

- 降低主 prompt 负担
- 允许不同成本/频率的更新策略
- 避免“事实记忆”和“推理表征”相互污染

### 5. 高延迟 Recall 走异步预取

对于外部 memory / profile / dialectic API：

- 本轮结束时后台触发预取
- 下一轮开始时直接消费 cache
- 第一轮允许冷启动，后续轮次避免阻塞主路径

不要每轮在 prompt build 前同步拉远程 context。

### 6. 把学习闭环接起来

建议闭环顺序：

1. 执行任务
2. 过程保存在 transcript
3. 稳定事实进入 declarative memory
4. 可复用方法进入 skill
5. 用户长期表征进入 user model
6. 下次任务用搜索、memory、skill、user model 各自回读

## 决策框架

```
新信息应该写到哪里？
    │
    ├─ 这是稳定事实/偏好吗？
    │       → Declarative Memory
    │
    ├─ 这是某次任务过程、报错、临时决策吗？
    │       → Transcript / Session Recall
    │
    ├─ 这是可复用的做法/流程吗？
    │       → Skill / Procedural Memory
    │
    ├─ 这是跨 session 的人格/偏好表征，需要推理吗？
    │       → User Model
    │
    └─ 不确定？
            → 先放 Transcript，
              观察是否稳定，再晋升到 Memory 或 Skill
```

## 检查清单

- [ ] 是否把 `事实` 与 `过程` 分开？
- [ ] 是否把 `怎么做` 与 `知道什么` 分开？
- [ ] 是否避免把临时任务进度写进长期 memory？
- [ ] 外部 recall 是否异步预取，而不是同步阻塞？
- [ ] skill 是否支持在使用中修补？

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 把任务过程、报错、结论一股脑写进 MEMORY.md | 过程进 transcript，稳定事实才进 memory |
| skill 只创建不维护 | 发现过时内容立即 patch |
| 每轮同步请求远程 memory/profile 服务 | turn-end async prefetch，next-turn consume |
| 用一个“万能记忆”同时承担事实、历史、技能、用户画像 | 拆成四层回路 |
| 为了跨 session 记住任务进度，污染主 prompt | 保留可搜索 transcript，按需召回 |

## 相关规范

- [[task-notes-boundary]]
- [[code-as-interface]]
- [[living-spec]]
