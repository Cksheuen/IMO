# Task / Notes Boundary

> 来源：对 `tasks/` 与 `notes/` 职责重叠问题的收敛分析 | 吸收时间：2026-03-31

## 核心原则

**`<project>/.claude/tasks/` 记录本次任务事实，`~/.claude/notes/` 沉淀跨任务知识。**

两者可以引用同一事件，但不能承担同一职责。

补充边界：

- `notes/` 不是 episodic recall 引擎
- `tasks/` 不是长期 memory 仓
- recall 的“查询与压缩”属于实现层，不能用目录职责偷换

## 触发条件

当出现以下任一情况时，必须应用本规范：

- 准备创建或更新 `<project>/.claude/tasks/<task>/` 内容
- 准备把执行过程、失败原因、调研结论写入 `~/.claude/notes/`
- 发现同一段内容既想写进 task，又想写进 note
- 进行任务归档、复盘、调研收敛、设计收敛
- 准备把 transcript / recall / memory 的内容塞进 task 或 notes

## 职责边界

| 目录 | 核心问题 | 应存内容 | 不应存内容 |
|------|----------|----------|------------|
| `<project>/.claude/tasks/` | 这次任务要做什么、做到哪了、卡在哪 | PRD、context、status、feature list、验收、blocker、当前证据链接 | 脱离当前任务仍成立的通用原则、长期复盘、跨任务方法论 |
| `~/.claude/notes/` | 这类问题以后应该怎么理解和复用 | lessons、research、design、稳定结论、跨任务模式 | 只服务单次执行的临时状态、运行时锁文件、纯任务队列 |

## 与 Transcript / Recall / Memory 的关系

| 层 | 主要职责 | 与本规范关系 | 常见误用 |
|----|----------|--------------|----------|
| `transcript` / session log | 保存原始过程事实 | 与 `tasks/notes` 并列，不互相替代 | 把原始过程复制进 notes 充当检索 |
| `episodic recall`（实现层） | 从 transcript/task 中检索并压缩历史片段 | 本规范只定义边界，不声明已实现完整 recall runtime | 误把 notes 目录当 recall service |
| `memory/`（declarative） | 稳定事实快照 | 是 `tasks/notes` 的下游晋升目标之一 | 把 task 状态、排障过程写进 memory |

## 最小 Runtime Mapping（截至 2026-04-10）

| 对象 | 当前作为存储层 | 当前作为实现层 | 结论 |
|------|----------------|----------------|------|
| `tasks/` | 已存在且在用 | task workflow 已存在 | 仅承担任务闭环，不承担 recall |
| `notes/` | 已存在且在用 | note 写入 + promotion 流程已存在 | 仅承担知识沉淀，不承担 recall engine |
| `memory/` | 已存在（目前以索引资产为主） | 稳定事实协议不完整 | 不能宣称为完整 declarative memory runtime |
| `episodic recall` | 无专属目录要求 | 缺统一查询/摘要接口 | 当前仍是待实现层，不能伪装成已具备 |

## 写入规则

### 写入 `tasks/`

满足以下特征时，写入项目级 `tasks/`：

- 只对当前任务闭环有意义
- 内容会随着任务推进频繁变化
- 需要表达进度、状态、依赖、blocker、验收
- 下一个 agent 需要据此继续执行，而不是提炼原则

典型内容：

- `prd.md`：目标、范围、Acceptance Criteria
- `context.md`：相关文件、依赖、外部约束
- `status.md`：当前进度、blocker、next step
- `feature-list.json`：结构化验证状态

补充约束：

- 原始过程证据优先留在 transcript/session log；`tasks/` 只放任务推进必需摘要
- 若需要“回忆历史过程”，应走 recall 能力建设，不把 `tasks/` 写成过程日志仓

### 写入 `notes/`

满足以下特征时，写入全局 `notes/`：

- 结论脱离当前任务仍然成立
- 未来其他任务大概率会复用
- 已经出现“为什么会这样”的解释、取舍、反模式或决策框架
- 需要长期检索，而不是只在本次执行中消费

典型内容：

- `notes/lessons/`：失败模式、纠正复盘、反模式
- `notes/research/`：方案比较、调研证据、收敛结论
- `notes/design/`：目录设计、调用链设计、迁移取舍

补充约束：

- `notes/` 不承担 session 级检索接口职责
- 需要可检索的历史过程时，优先补 recall 实现层，不向 notes 追加流水式对话堆积

## 决策框架

写入前依次判断：

1. 这段内容如果离开当前任务，是否仍然有价值？
2. 这段内容的主要用途是推进执行，还是指导未来决策？
3. 它会在任务完成后失效，还是应继续被检索复用？

决策规则：

- 三问都偏“当前执行” -> 写 `<project>/.claude/tasks/`
- 三问都偏“长期复用” -> 写 `~/.claude/notes/`
- 若同时满足两边：`tasks/` 只留摘要和指针，完整结论写 `notes/`

若问题是“我需要从历史过程里快速找证据片段”，优先结论：

- 这属于 episodic recall 能力缺口
- 不通过扩大 `tasks/notes` 职责来临时补洞

## 迁移规则

当任务内容满足以下任一条件时，应从 `tasks/` 晋升或归并到 `notes/`：

- 已经形成可复用的教训或反模式
- 已经形成稳定的调研结论或设计取舍
- 同类问题在多个任务中重复出现
- 内容开始脱离任务状态，转而解释“以后应该怎么做”

推荐路径：

`<project>/.claude/tasks/` -> `~/.claude/notes/` -> `rules/` / `skills/` / `memory/`

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 在 `status.md` 中写大段通用方法论 | `status.md` 只保留当前任务摘要，把方法论写到 `notes/` |
| 把 task 里的完整调研结论再复制一份到 `notes/research/` | `tasks/` 只保留结论摘要 + note 链接 |
| 把失败原因长期堆在 `feature-list.json` 的 `notes` 字段里 | 当前失败原因保留在 task，跨任务教训归并到 `notes/lessons/` |
| 用 `notes/` 记录“待做事项 / 当前进度 / 下一步” | 这些属于 `tasks/` 或运行时状态，不属于知识沉淀 |
| 把 `tasks/` 当长期知识库使用 | 任务完成后只保留必要规格，其余可复用结论迁移到 `notes/` |
| 把 `notes/` 当 recall engine | notes 只沉淀结论；历史过程检索属于 recall 实现层 |
| 把 `memory/` 当 task + note + transcript 混合仓 | memory 仅保稳定事实快照，其他层各归其位 |

## 最小落地要求

- `tasks/` 中出现长段解释性结论时，检查是否应迁移到 `notes/`
- `notes/` 中出现纯进度汇报时，回退到 `tasks/`
- 调研型任务和复盘型任务默认采用“task 摘要 + notes 正文”双层结构，而不是双写正文
- 讨论 recall 缺口时，优先补“实现层接口”而不是扩张 `tasks/notes` 职责

## 相关规则

- [[task-centric-workflow]] - 定义任务目录的基本结构
- [[context-injection]] - 任务上下文如何按需注入
- [[requirements-confirmation]] - 收敛需求，避免在 task/note 中重复解释目标
