---
name: orchestrate
description: Choose direct execution or bounded delegation from task coupling, context cost and current authorization; coordinate delegated work through Herdr with explicit ownership, budgets, real integration and lifecycle return.
description_zh: "按任务耦合、上下文成本和当前授权选择主会话或有界委派；已选择的委派通过 Herdr 管理所有权、预算、真实集成与生命周期回传。"
---

# Orchestrate - Multi-Agent Task Orchestration

将大任务拆成可验证、可并行、可回收的子任务。

## 当前实现状态

- `SKILL.md` 描述的是目标编排协议和人工/host agent 执行规则。
- migrated LangGraph runtime 当前提供 `RuntimeExecutor` 边界，用于真实执行入口统一记录状态流、依赖关系、并行 batch selection、观测元数据和 verification/fixer loop。
- 调用 migrated runtime 前，先完成文件所有权、依赖和冲突 gate，再把已确认的执行项转换为 orchestrate subtasks。
- 任何 host-agent 或 git worktree backend 都必须复用 `.imo/ORCHESTRATION.md` 的 observability gate，并保持仓库或平台原生 task workflow 独立。

## 何时使用

主会话负责总体理解、设计、关键接口和验收。执行方式先遵守用户与宿主要求；
没有强制委派要求时，上下文已齐备的短闭环或强耦合修改可直接完成。只有可独立
交付、能降低总工时或需要独立视角的执行才委派，不把任务大小或模型品牌当开关。

选定委派后默认一个 Herdr worker；有真实并行收益、接口明确且写集独立时再增加。
模型能力变化时重新评估任务切分，不通过增加角色数体现“更强”，也不削弱验证。

## 核心约束

- 先收集上下文，再拆分任务
- 先锁文件所有权，再启动子 agent
- 写文件的子任务默认使用 `worktree` 隔离
- 子 agent 默认 `summary-only` 返回，不回灌完整中间过程
- 默认禁止递归 delegation；深度预算默认为 `1`
- 所有已委派的执行角色默认通过 Herdr 创建和控制；不使用常规 subagent/spawn 工具替代，除非当前用户指令或更高优先级宿主要求明确覆盖
- worker 启动前必须建立持久 coordinator、event inbox 和已验证 return channel
- `working`、`idle`、`done`、`blocked`、`unknown` 及进程退出都必须唤醒主会话
- 默认禁止共享治理资产写入：`rules/`、`skills/`、`hooks/`、`settings.json`、`AGENTS.md`
- 只有会扩大任务范围、引入高副作用或需要用户偏好选择时才暂停确认
- 主模型必须 review 聚合结果并完成必要验证；独立 reviewer 用于高风险或明确要求的交付，不强制每个小修复再起一条链

## 推荐 Agent 类型

以下是 Herdr worker 的职责名称，不是宿主原生 subagent 类型或工具选择。

| Agent | 用途 | 隔离 |
|------|------|------|
| `implementer` | 写代码、改文件、补测试 | 目标协议为 `worktree`；通过 runtime executor 边界接入 |
| `researcher` | 搜索、阅读、只读调研 | 无 |
| `reviewer` | 验证、审查、定位 root cause | 无 |

## 执行流程

### Step 0: 判断是否值得编排

先回答四个问题：

1. 是否真的有多块可独立推进的工作？
2. 是否能给每块工作明确的文件边界？
3. 是否能为每块工作写出可验证的验收标准？
4. 是否能在聚合阶段收回结果并统一验证？

先按当前指令判断执行方式，再用这些问题决定拆分。比较总成本：上下文交接、
执行、等待、聚合与复核；短闭环可留在主会话，独立执行可交给 worker。
已选 worker 且只有一条依赖链时串行执行。
边界或验收不清楚时由主模型补齐计划，不制造额外子任务。

### Step 1: 收集上下文

在分解前必须完成：

- 搜索相关文件与相似实现
- 读取项目约束：`AGENTS.md`、仓库说明、配置文件、测试入口
- 回读相关 `notes/lessons/`、`notes/research/`
- 判断任务类型：`frontend / backend / database / test / refactor / fix`

只提取必要约束，不把大段规则正文整体塞进 prompt。

若需要详细模板，查看 `references/playbook.md`。

### Step 2: 锁定执行契约

在当前平台 plan 或主 agent 的执行上下文中保持一份紧凑契约：

- Goal / Out of Scope
- 已验证事实与仍需验证的假设
- 子任务、文件所有权与依赖
- 每个子任务的 Acceptance Criteria
- 聚合验证与回滚方式

在按模块分工前先定义一个真实纵向验收：同一状态上的输入、跨模块后果与消费者。
共享接口由一个 owner 维护，worker 只提差异；集成时记录实际消费的接口/源版本。
对等模块未就绪时等待或回报缺口，不在产品或测试内复制另一套内核、动态 fallback
或假实现来通过局部测试。

默认不在仓库中生成 PRD、context、status、feature-list 或 implementation-plan。
只有用户、仓库规范或跨会话交接明确要求持久化时，才复用其原生任务/文档位置；
此 skill 不发明新的 task/spec 文件体系。

### Step 3: 分解子任务

每个子任务必须明确：

- 目标
- 文件所有权
- 依赖关系
- 验收标准
- 适用规则包

硬约束：

- 一个文件默认只属于一个子任务
- 若两个子任务必须改同一文件，要么合并，要么串行
- 子任务应是一次独立、可验证的交付；不使用固定 turn 数制造拆分仪式
- 过小子任务应合并，避免 orchestration 开销反噬

### Step 4: 选择执行模式

适合委派的本机有界执行，先加载 `multi-model-agent` 的
`references/herdr-claude.md`，用 Herdr 启动 Claude；不以需要混合模型为前提。实现 worker 使用当前明确选择的
model；生命周期 coordinator 与实现路由分开，但不能只报状态而不回传。Herdr 会话定位、启动检查、
精确模型选择与回收均遵守该执行规范；不得伪造 caller 环境。


| 情况 | 方式 |
|------|------|
| 短闭环或强耦合，且未强制委派 | 主会话直接实现并验证 |
| 适合独立交付的有界任务 | 一个 Herdr worker，主会话协调和验收 |
| 多个独立子任务 | 默认复用一个 Herdr worker 串行执行；有明确并行收益且写集独立时再增加 Herdr workers |
| 有文件重叠或强依赖 | Herdr workers 串行执行 |
| 子任务较多 | 按实际依赖和宿主并发预算分批派发 Herdr workers |

已选择 Herdr 后不可用或回传未验证时，记录原因并有界诊断；不能静默换模型或
用常规 subagent 绕过限制。用户已授权主会话接管、预算耗尽后的接管，或本任务
没有强制路由且重新评估后适合直接完成时，记录交接并收回写集，再由主会话继续。
仍被明确要求必须委派的任务则报告阻塞，不自行改道。

若任务是“读多写少”，优先把调研和实现并行化；不要把所有工作都塞给 implementer。

### 预算与停止条件

分别约束 worker 并发、请求次数、token 与外部费用；主模型和不同 provider 的预算
不得混用。启动/继续前预留，完成后按可信计量结算。可用额度扣除“已结算用量＋
在途预留＋未知请求的保守上界”，累计历史预留与已报告用量分别展示；不能把
累计预留达到上限报告成实际花费，也不能用不完整 usage 擅自退款。

继承原账本，不通过重启、换目录、换 worker 或改名称重置预算。未知记录保持
保守占用；成本核对不意味着自动获得继续调用授权。触及限制时先停止相关执行，
清理/回收写集，再按已授权的接管策略继续。局部重试必须有新证据和新的剩余预算。

### Step 5: 构建子任务 prompt

每个子任务 prompt 至少包含：

- 一句话目标
- 整体任务背景
- 可修改文件
- 可读取文件
- 禁止修改的范围
- 验收标准
- Rules Pack
- 能力边界
- 返回格式

能力边界固定包含：

- `max_delegation_depth: 1`
- `allow_recursive_delegation: false`
- `return_mode: summary_only`
- `shared_state_write: deny`
- `high_side_effect_actions: deny`

详细 prompt 模板见 `references/playbook.md`。

### Step 6: 执行与聚合

全局复用 `codex-use`，每个 Codex 对话一个 workspace、每个 worker 一个独立命名 tab；启动显式传 auto 参数。coordinator 必须把每个生命周期变化回传主会话；主会话对每个变化立即回读、review、回答阻塞、恢复或派发后继，不等无关 worker。所有交付均须 coordinator 验收；关键改动增加独立 review。具体契约以 Herdr 执行规范为准。

Herdr 使用的采集位置、关联 ID、超时、指标分母和真实效果检查见 [Herdr 埋点设计](../../../runtime/observability/herdr-telemetry.md)。必须区分通知已发、主会话已收、已经介入、后继已启动；未委派、无产物和失败样本不得遗漏。规范/fixture 验证不能代替生产接线与真实主会话唤醒验证。

并行子任务在同一轮启动；串行子任务等前置结果返回后再继续。当前 migrated runtime 会在一个 executor tick 内执行所有依赖满足且文件写入不冲突的 subtasks；productive worker backend 必须提供可观测 artifact、diff 或 final summary。

聚合时只保留：

- 完成情况
- 关键决策
- blocker
- 文件变更摘要
- 需要继续验证的点

若发现多个子任务碰了同一文件，视为编排失误，先解决冲突再继续。

### Step 7: 验证与 Fixer Loop

所有实现子任务完成后：

1. 合并结果
2. 运行测试 / 静态检查
3. 主模型复核跨模块真实行为；高风险或用户要求独立评审时，使用授权路由的 reviewer
4. 将审查结论写回当前平台 plan 或最终验证摘要

当 reviewer 判定失败时：

- reviewer 必须输出结构化 `delta_context`
- 主 agent 重新派发 implementer
- implementer 只读取与 `delta_context` 相关的范围

同一职责优先复用现有 worker 或串行 fixer；已收回写集且符合上述直接执行条件时，
主模型可完成收尾。验证证明的是实际行为，不是作者总结；对难以测试的内容说明
人工 review 的对象、证据与未覆盖边界。最后一次改动使哪些旧验证失效，就补哪些。

## Rules Pack 约定

Rules Pack 只保留三层：

- 核心原则：简洁优先 / 根因导向 / 最小影响
- 领域规则：与当前任务类型直接相关的约束
- 模式规则：`change-impact-review`、`requirements-confirmation`、`self-verification-mechanism` 等

目标是短、硬、可执行；不要复制整篇 rule。

## 输出要求

向用户汇报时至少包含：

- 子任务总数
- 完成 / 阻塞 / 待处理数量
- 关键文件变更
- 验证结果
- 剩余风险
- 仅在确实持久化时给出仓库原生 checkpoint 或交接文档路径

## 反模式

- 未收集上下文就开始拆分
- 未锁文件所有权就并行启动 implementer
- 把 worktree 当作完整 capability isolation
- 允许子 agent 递归委派
- 要求子 agent 回传完整日志或完整思考过程
- 跳过 reviewer / verification gate
- reviewer 失败后在没有根因证据时盲目重试
- 无 `delta_context` 就反复重试

## 参考文件

- `references/playbook.md`：详细模板与长示例
- `.imo/ORCHESTRATION.md`：执行后端的 capability、隔离和观测边界
