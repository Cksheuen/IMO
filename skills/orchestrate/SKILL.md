---
name: orchestrate
description: Multi-agent orchestration skill. Automatically decomposes large tasks into subtasks, assigns them to specialized agents (implementer/researcher/reviewer), and coordinates parallel execution with worktree isolation. Trigger when task involves 3+ files, 2+ domains, or user says "并行"/"parallel"/"orchestrate"/"拆分执行".
---

# Orchestrate - Multi-Agent Task Orchestration

将大任务拆成可验证、可并行、可回收的子任务。

## 何时使用

满足任一条件即可：

- 任务预计修改 `3+` 个文件
- 任务跨越 `2+` 个领域（前端 / 后端 / 数据 / 测试 / 设计等）
- 预计代码量 `> 500` 行
- 用户明确要求并行、拆分执行、建立 agent 团队
- `proactive-delegation` 评估为需要委派

不要在以下场景使用：

- 只改 `1-2` 个文件且依赖关系简单
- 下一步被单一关键结果阻塞，主 agent 直接做更快
- 任务本质是问答、解释、轻量调研，而不是执行编排

## 核心约束

- 先收集上下文，再拆分任务
- 先锁文件所有权，再启动子 agent
- 写文件的子任务默认使用 `worktree` 隔离
- 子 agent 默认 `summary-only` 返回，不回灌完整中间过程
- 默认禁止递归 delegation；深度预算默认为 `1`
- 默认禁止共享治理资产写入：`rules/`、`skills/`、`hooks/`、`settings.json`、`AGENTS.md`
- 分解方案成型后先给用户确认，再批量启动实现子任务
- 所有子任务完成后必须经过 reviewer / verification / fixer loop

## 推荐 Agent 类型

| Agent | 用途 | 隔离 |
|------|------|------|
| `implementer` | 写代码、改文件、补测试 | `worktree` |
| `researcher` | 搜索、阅读、只读调研 | 无 |
| `reviewer` | 验证、审查、定位 root cause | 无 |

## 执行流程

### Step 0: 判断是否值得编排

先回答四个问题：

1. 是否真的有多块可独立推进的工作？
2. 是否能给每块工作明确的文件边界？
3. 是否能为每块工作写出可验证的验收标准？
4. 是否能在聚合阶段收回结果并统一验证？

若以上问题大多是否定，停止使用本 skill，改为主 agent 直接执行。

### Step 1: 收集上下文

在分解前必须完成：

- 搜索相关文件与相似实现
- 读取项目约束：`CLAUDE.md`、配置文件、测试入口
- 回读相关 `notes/lessons/`、`notes/research/`
- 判断任务类型：`frontend / backend / database / test / refactor / fix`

只提取必要约束，不把大段规则正文整体塞进 prompt。

若需要详细模板，查看 `references/playbook.md`。

### Step 2: 建立任务骨架

优先复用现有 `tasks/current/`；如果还没创建，则按 task-centric workflow 建立：

- `prd.md`
- `context.md`
- `status.md`
- `feature-list.json`

PRD 至少要有：

- Goal
- What I Already Know
- Assumptions
- Open Questions
- Requirements
- Acceptance Criteria
- Out of Scope

不要把大段调研正文塞进 PRD；PRD 只保留当前任务闭环必需的信息。

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
- 一个子任务应能在 `20-50` turns 内完成
- 过小子任务应合并，避免 orchestration 开销反噬

### Step 4: 选择执行模式

| 情况 | 方式 |
|------|------|
| `1-2` 个独立子任务 | 直接 subagent，不必重编排 |
| `3-5` 个独立子任务 | 并行 subagent |
| 有文件重叠或强依赖 | 串行 subagent |
| `> 5` 个子任务 | 分批执行，每批 `3-5` 个 |

若任务是“读多写少”，优先把调研和实现并行化；不要把所有工作都塞给 implementer。

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

并行子任务在同一轮启动；串行子任务等前置结果返回后再继续。

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
3. 启动 reviewer
4. 根据 reviewer 结果更新 `feature-list.json`

当 reviewer 判定失败时：

- reviewer 必须输出结构化 `delta_context`
- 主 agent 重新派发 implementer
- implementer 只读取与 `delta_context` 相关的范围
- 超过 `max_attempts` 后标记 `blocked`

主 agent 不负责手工修代码，主 agent 负责调度与收口。

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
- `prd.md` / `feature-list.json` 路径

## 反模式

- 未收集上下文就开始拆分
- 未锁文件所有权就并行启动 implementer
- 把 worktree 当作完整 capability isolation
- 允许子 agent 递归委派
- 要求子 agent 回传完整日志或完整思考过程
- 跳过 reviewer / verification gate
- reviewer 失败后主 agent 自己动手修代码
- 无 `delta_context` 就反复重试

## 参考文件

- `references/playbook.md`：详细模板与长示例
- `rules-library/core/proactive-delegation.md`
- `rules-library/core/task-centric-workflow.md`
- `rules-library/pattern/change-impact-review.md`
- `rules-library/pattern/generator-evaluator-pattern.md`
- `rules-library/pattern/self-verification-mechanism.md`
- `rules-library/technique/git-worktree-parallelism.md`
