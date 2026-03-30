---
name: orchestrate
description: Multi-agent orchestration skill. Automatically decomposes large tasks into subtasks, assigns them to specialized agents (implementer/researcher/reviewer), and coordinates parallel execution with worktree isolation. Trigger when task involves 3+ files, 2+ domains, or user says "并行"/"parallel"/"orchestrate"/"拆分执行".
---

# Orchestrate - Multi-Agent Task Orchestration

**将大任务自动拆分为子任务，分配给专用 Agent 并行执行，收集并聚合结果。**

```
大任务 → 分解 → 分配 → 并行执行 → 聚合 → 验证 → 交付
```

## 触发条件

满足任一即可激活：
- 任务涉及 **3+ 文件**修改
- 任务跨越 **2+ 领域**（前端/后端/数据库/测试等）
- 预估代码量 **> 500 行**
- 用户明确要求并行/拆分执行
- `proactive-delegation` 规则评估为"需要委派"

## 可用 Agents

| Agent | 文件 | 能力 | 隔离 | 模型 |
|-------|------|------|------|------|
| **implementer** | `~/.claude/agents/implementer.md` | 写代码、改文件、提交 | worktree | inherit |
| **researcher** | `~/.claude/agents/researcher.md` | 搜索、阅读、调研 | 无 | haiku |
| **reviewer** | `~/.claude/agents/reviewer.md` | 验证、测试、审查 | 无 | inherit |

## 执行流程

### Step 1: 任务分解

分析用户任务，输出结构化子任务列表：

```markdown
## 任务分解

### 子任务列表

| # | 子任务 | Agent 类型 | 文件所有权 | 依赖 | 验收标准 |
|---|--------|-----------|-----------|------|----------|
| 1 | 描述 | implementer | file1.ts, file2.ts | 无 | 可验证的行为 |
| 2 | 描述 | implementer | file3.ts | #1 | 可验证的行为 |
| 3 | 描述 | researcher | (只读) | 无 | 回答具体问题 |

### 文件所有权矩阵

| 文件 | 所有者 | 操作 |
|------|--------|------|
| src/api/auth.ts | 子任务 #1 | 修改 |
| src/components/Login.tsx | 子任务 #2 | 新建 |
```

**分解规则**：
- 每个子任务的文件所有权**不可重叠**（一个文件只归属一个子任务）
- 如果两个子任务必须改同一个文件 → 合并为一个子任务，或串行执行
- 每个子任务必须有**可验证的验收标准**
- 子任务粒度：一个 agent 在 20-50 turns 内可完成

**分解后必须展示给用户确认**，再进入 Step 2。

### Step 2: 模式选择

```
子任务数量和关系？
    │
    ├─ 1-2 个，独立 → 直接 Subagent（不需要 orchestrate skill）
    │
    ├─ 3-5 个，独立或弱依赖
    │     │
    │     ├─ 无文件重叠 → 并行 Subagent + worktree 隔离
    │     │
    │     └─ 有文件重叠 → 串行 Subagent 或合并子任务
    │
    ├─ 3-5 个，强依赖/需要协商
    │     │
    │     └─ Agent Teams（实验性，需确认）
    │
    └─ > 5 个 → 分批执行（每批 3-5 个）
```

**模型分配策略**：

| 子任务类型 | 推荐模型 | 理由 |
|-----------|----------|------|
| 调研/搜索 | haiku | 只读操作，速度优先 |
| 简单实现 | sonnet | 性价比最优 |
| 复杂实现/架构 | opus / inherit | 需要深度推理 |
| 代码审查 | inherit | 需要理解全局上下文 |

### Step 3: 构建 Agent Prompt

为每个子任务构建完整的 agent 调用 prompt：

```markdown
## 子任务 #{n}: {标题}

### 目标
{一句话描述}

### 上下文
- 整体任务：{用户原始任务概述}
- 本子任务在整体中的位置：{与其他子任务的关系}

### 文件所有权
- 可修改：{file1.ts, file2.ts}
- 可读取（参考）：{file3.ts}
- 禁止修改：{其他所有文件}

### 验收标准
1. {具体的可验证行为}
2. {具体的可验证行为}

### 约束
- {项目特定约束，如代码风格、框架版本}
- {从 CLAUDE.md 或 rules 中提取的相关规范}
```

### Step 4: 分配执行

**并行子任务**（无依赖）：
```
在同一条消息中发起多个 Agent tool 调用：

Agent(subagent_type: "implementer", isolation: "worktree", prompt: 子任务 #1 prompt)
Agent(subagent_type: "researcher", prompt: 子任务 #3 prompt)
```

**串行子任务**（有依赖）：
```
等待前置子任务完成 → 将前置结果注入后续子任务 prompt → 启动后续子任务
```

**执行规则**：
- 独立子任务**必须并行**发起（同一条消息中多个 Agent 调用）
- implementer 类型子任务默认使用 `isolation: "worktree"`
- researcher 类型不需要 worktree（只读）
- 每个 agent 的 prompt 中包含完整上下文（不依赖主 agent 的对话历史）

### Step 5: 结果聚合

收集所有 agent 返回的报告，检查：

**5.1 完成度检查**

| 子任务 | 状态 | 验收标准通过 |
|--------|------|-------------|
| #1 | complete | 2/2 |
| #2 | blocked | 0/1 - 描述 blocker |

**5.2 文件冲突检查**

如果多个 worktree 修改了同一文件（不应发生，但需防御）：
- 列出冲突文件
- 提示用户选择保留哪个版本，或手动合并

**5.3 集成验证**

所有子任务完成后：
- 合并 worktree 变更到主分支
- 运行项目测试（如有）
- 如有 reviewer agent → 启动审查

### Step 6: 综合输出

```markdown
## 编排结果

### 总览
- 子任务总数：N
- 完成：X | 部分完成：Y | 阻塞：Z

### 子任务汇总
| # | 子任务 | 状态 | 关键决策 |
|---|--------|------|----------|
| 1 | 描述 | complete | 决策摘要 |

### 文件变更总览
| 文件 | 操作 | 来源子任务 |
|------|------|-----------|
| path/file.ts | 修改 | #1 |

### 验证结果
- 测试：通过/失败
- 审查：通过/需修复

### 遗留问题
- 问题描述（如有）

### 下一步建议
- 建议的后续动作（如有）
```

## 与已有规则的协作

| 规则 | 协作方式 |
|------|----------|
| `proactive-delegation.md` | 提供触发判断 → orchestrate 接手执行 |
| `long-running-agent-techniques.md` | 单个子任务超出 context 时，使用 Handoff 机制 |
| `generator-evaluator-pattern.md` | implementer = Generator, reviewer = Evaluator |
| `git-worktree-parallelism.md` | 并行 implementer 的隔离基础设施 |
| `task-centric-workflow.md` | 子任务的组织结构参考 |

## 决策框架总览

```
收到用户任务
    │
    ├─ proactive-delegation 评估 → 不需要委派 → 直接执行，不触发此 skill
    │
    └─ 需要委派
         │
         ├─ Step 1: 分解子任务 + 文件所有权
         │
         ├─ Step 2: 选择模式（Subagent / Teams / 分批）
         │
         ├─ 展示分解方案 → 用户确认
         │
         ├─ Step 3-4: 构建 prompt + 并行/串行执行
         │
         ├─ Step 5: 聚合结果 + 冲突检查 + 集成验证
         │
         └─ Step 6: 综合输出
```

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 未确认就执行 | 分解方案必须经用户确认 |
| 文件所有权重叠 | 一个文件只能属于一个子任务 |
| 所有子任务都用 opus | 按类型匹配模型，研究用 haiku |
| 子任务过大（> 50 turns） | 继续拆分，或使用 long-running harness |
| 子任务过小（< 5 turns） | 合并到相邻子任务，减少编排开销 |
| 串行任务用并行执行 | 有依赖关系的必须串行 |
| 忽略 agent 报告的 blocker | blocker 必须处理后再继续 |
