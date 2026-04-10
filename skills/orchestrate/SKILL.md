---
name: orchestrate
description: Multi-agent orchestration skill. Automatically decomposes large tasks into subtasks, assigns them to specialized agents (implementer/researcher/reviewer), and coordinates parallel execution with worktree isolation. Trigger when task involves 3+ files, 2+ domains, or user says "并行"/"parallel"/"orchestrate"/"拆分执行".
---

# Orchestrate - Multi-Agent Task Orchestration

**将大任务自动拆分为子任务，分配给专用 Agent 并行执行，收集并聚合结果。**

```
大任务 → 上下文分析 → PRD创建 → 分解 → 分配 → 并行执行 → 聚合 → 验证 → 交付
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

## Delegation Capability Boundary（Hermes 对标，最小落地）

> 本 skill 当前落地的是 **workflow + gate 约束**，不是 Hermes 那种完整 delegation runtime。  
> 可以声明边界、做部分守门，但不声称“能力隔离已完全自动化”。

### 边界原则

- **capability isolation ≠ worktree isolation**：worktree 仅隔离代码工作区，不自动隔离工具权限与副作用。
- **默认禁止高风险能力**（除非显式授权）：递归 delegation、共享治理资产写入、高副作用外部动作。
- **默认 summary-only 回流**：子 agent 返回结论、证据路径、风险，不回灌完整中间过程。
- **深度预算默认 1**：只允许主 agent 委派一层子 agent；子 agent 再委派默认禁止。

### 默认禁止项（子 agent）

- 再次调用 `Agent(...)` 或发起新的 delegation
- 修改共享治理资产（如 `rules/`、`hooks/`、`skills/`、`settings.json`、`AGENTS.md`）
- 执行外部不可逆动作（如远端 push、系统级变更）且未显式授权
- 回传完整中间日志/思考链路污染父上下文

## 执行流程

### Step 0: 上下文自动收集（新增）

> **核心改进**：在分解任务前，先自动收集上下文，而非等待用户提供。

#### 0.1 任务类型识别

根据以下信号识别任务类型：

| 信号 | 匹配规则 |
|------|----------|
| 文件路径 | `src/components/*`, `app/**/*.tsx` → `frontend` |
| 文件路径 | `src/api/*`, `server/*`, `routes/*` → `backend` |
| 文件路径 | `prisma/*`, `db/*`, `migrations/*` → `database` |
| 文件路径 | `**/*.test.*`, `**/*.spec.*`, `tests/*` → `test` |
| 关键词 | "重构"、"refactor"、"优化" → `refactor` |
| 关键词 | "修复"、"fix"、"bug" → `fix` |

#### 0.2 上下文收集（自动化）

**必须执行**：在开始分解前，自动收集以下信息：

| 收集项 | 来源 | 目的 |
|--------|------|------|
| **相关文件** | Glob/Grep 搜索 | 识别可能涉及的文件 |
| **现有模式** | 读取相似实现 | 提取可复用模式 |
| **项目约束** | CLAUDE.md / package.json / tsconfig | 技术栈、依赖、规范 |
| **历史上下文** | `notes/` 目录 | 是否有相关经验教训 |

**收集方式**：
```markdown
## 上下文收集

1. **文件搜索**：根据任务关键词搜索相关文件
2. **模式识别**：读取 2-3 个相似实现的文件
3. **约束提取**：读取项目配置文件
4. **经验检索**：检查 notes/ 中是否有相关 lesson
```

#### 0.3 规则提取与注入

**提取原则**：只提取规则的**核心约束**，而非全文。

```yaml
task_type_to_rules:
  frontend:
    essential:
      - rules/domain/frontend/
      - rules/scoped/frontend/
    patterns:
      - rules/pattern/change-impact-review.md
      - rules/pattern/requirements-confirmation.md

  backend:
    essential:
      - rules/domain/backend/
      - rules/scoped/backend/
    patterns:
      - rules/pattern/cross-layer-preflight.md
      - rules/pattern/change-impact-review.md

  refactor:
    essential:
      - rules/core/
    patterns:
      - rules/pattern/change-impact-review.md
      - rules/pattern/cross-layer-preflight.md

  fix:
    essential:
      - rules/core/
    patterns:
      - rules/pattern/change-impact-review.md
      - rules/pattern/self-verification-mechanism.md

  default:
    essential:
      - rules/core/
    patterns:
      - rules/pattern/generator-evaluator-pattern.md
      - rules/pattern/self-verification-mechanism.md
```

**Rules Pack 格式**（300-500 tokens）：
```markdown
## 适用规则（Rules Pack）

### 核心原则
- 简洁优先：每个变更尽可能简单，影响最少的代码
- 根因导向：找到根因，拒绝临时修复
- 最小影响：只触及必要部分，不引入新问题

### 领域规范（{task_type}）
- {约束1}
- {约束2}

### 模式规范
#### {pattern_name}
- 触发条件：{when}
- 执行要点：{what}
```

### Step 1: 创建结构化 PRD（新增）

> **核心改进**：参考 Trellis brainstorm 的 PRD 结构，自动创建更完整的 PRD。

#### 1.1 任务目录创建

```bash
# 解析 task 根目录
resolve_tasks_root() {
  local project_root dir

  if project_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    if [ "$(basename "$project_root")" = ".claude" ]; then
      printf '%s/tasks\n' "$project_root"
    else
      printf '%s/.claude/tasks\n' "$project_root"
    fi
    return
  fi

  dir="$PWD"
  while :; do
    if [ "$(basename "$dir")" = ".claude" ]; then
      printf '%s/tasks\n' "$dir"
      return
    fi

    if [ -d "$dir/.claude" ]; then
      printf '%s/.claude/tasks\n' "$dir"
      return
    fi

    [ "$dir" = "/" ] && break
    dir=$(dirname "$dir")
  done

  printf '%s/tasks\n' "$HOME/.claude"
}

TASKS_ROOT=$(resolve_tasks_root)
TASK_DATE=$(date +%F)

# 从用户消息提取 slug
TASK_SLUG=$(echo "$USER_MESSAGE" | python3 -c "
import re, sys
text = sys.stdin.read()
words = re.findall(r'[a-zA-Z0-9]+', text.lower())[:6]
stop = {'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'is', 'are', 'be', 'this', 'that', 'it', 'do', 'does', 'did', 'check', 'fix', 'issue', 'task', 'please', 'help'}
filtered = [w for w in words if w not in stop][:4]
print('-'.join(filtered) if filtered else 'task')
")

TASK_DIR="$TASKS_ROOT/$TASK_DATE-$TASK_SLUG"
mkdir -p "$TASK_DIR"
```

#### 1.2 结构化 PRD 模板

**自动创建** `prd.md`，融入 Trellis brainstorm 的字段结构：

```markdown
# {任务标题}

## Goal

{一句话描述：做什么 + 为什么}

## What I Already Know

> 自动收集的事实，区分用户原文 vs 已确认信息

### From User
- {用户消息中的原始需求}

### From Context
- {从代码/配置/文档中发现的事实}
- {相关的项目约束}

### Related Files (Auto-discovered)
- `path/to/file1.ts` - {简要说明}
- `path/to/file2.ts` - {简要说明}

## Assumptions (Temporary)

> 自动推断的假设，待验证

- [ ] {假设1} - {验证方法}
- [ ] {假设2} - {验证方法}

## Open Questions

> 仅保留 Blocking / Preference 问题，保持简短

1. **{问题类型}**: {问题描述}
   - 选项 A: {描述} - {权衡}
   - 选项 B: {描述} - {权衡}

## Requirements (Evolving)

> 从已知信息推导的需求

- [ ] {需求1}
- [ ] {需求2}

## Acceptance Criteria (Evolving)

> 可验证的完成标准

- [ ] {具体的可验证行为}
- [ ] {具体的可验证行为}

## Definition of Done

> 团队质量标准（可继承自项目配置）

- [ ] 测试通过（单元/集成/E2E 按需）
- [ ] Lint / TypeCheck / CI 绿色
- [ ] 文档更新（如有行为变更）
- [ ] 风险评估（如有高风险变更）

## Out of Scope (Explicit)

> 明确不做的事项

- {排除项1}
- {排除项2}

## Technical Notes

> 技术约束、参考、研究笔记

### Constraints
- {技术栈约束}
- {依赖版本约束}

### References
- `similar-feature.ts` - {相似实现参考}
- {外部文档链接}

### Research Notes (If Applicable)
- {调研结论摘要}
```

#### 1.3 Feature List 创建

同步创建 `feature-list.json`：

```json
{
  "task_id": "$TASK_DIR",
  "created_at": "$(date -I --iso-8601-seconds=utc)",
  "session_id": "$SESSION_ID",
  "status": "in_progress",
  "prd_path": "prd.md",
  "features": [
    {
      "id": "F001",
      "category": "task",
      "description": "任务整体完成",
      "acceptance_criteria": [
        "所有 Open Questions 已解决",
        "所有 Requirements 已实现",
        "所有 Acceptance Criteria 已通过"
      ],
      "verification_method": "manual",
      "passes": null,
      "verified_at": null,
      "attempt_count": 0,
      "max_attempts": 3,
      "notes": "",
      "delta_context": null
    }
  ],
  "summary": {
    "total": 1,
    "passed": 0,
    "pending": 1
  }
}
```

### Step 2: 任务分解

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

**更新 PRD**：分解完成后，更新 `prd.md`：

```markdown
## Implementation Plan

### 子任务分解

| # | 子任务 | Agent | 文件 | 状态 |
|---|--------|-------|------|------|
| 1 | {描述} | implementer | {文件列表} | pending |
| 2 | {描述} | implementer | {文件列表} | pending |

### 执行策略
- {并行/串行}执行
- {原因说明}
```

**更新 feature-list.json**：为每个子任务创建 feature 条目。

**分解后必须展示给用户确认**，再进入 Step 3。

### Step 3: 模式选择

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

### Step 4: 构建 Agent Prompt

为每个子任务构建完整的 agent 调用 prompt：

```markdown
## 子任务 #{n}: {标题}

### 目标
{一句话描述}

### PRD 引用
完整 PRD 见：`{task_dir}/prd.md`

### 上下文
- 整体任务：{用户原始任务概述}
- 本子任务在整体中的位置：{与其他子任务的关系}

### 文件所有权
- 可修改：{file1.ts, file2.ts}
- 可读取（参考）：{file3.ts}
- 禁止修改：{其他所有文件}

### 能力边界（Mandatory）
- max_delegation_depth: 1
- allow_recursive_delegation: false
- shared_state_write: deny（除非显式 override）
- high_side_effect_actions: deny（除非显式 override）
- return_mode: summary_only

### 验收标准
1. {具体的可验证行为}
2. {具体的可验证行为}

### 适用规则（Rules Pack）
{从 Step 0 提取的 Rules Pack，包含核心原则、领域规范、模式规范}

### 输出格式
按 agent 类型要求输出，并满足：
- 只返回结果摘要、关键证据、风险与 blocker
- 中间日志写入 task artifacts，返回路径即可
```

### Step 5: 分配执行

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
- 每个子任务 prompt 必须包含 capability boundary 字段（不允许只给文件所有权）
- 子 agent 默认禁止递归 delegation；如需突破，必须显式 override 并记录理由
- 共享治理资产写入默认禁止；只有当前任务必须修改且已显式授权时才允许
- summary-only 回流：主 agent 只接收摘要，不拉取完整中间过程
- 每个 agent 的 prompt 中包含完整上下文（不依赖主 agent 的对话历史）

### Step 6: 结果聚合

收集所有 agent 返回的报告，检查：

**6.1 完成度检查**

| 子任务 | 状态 | 验收标准通过 |
|--------|------|-------------|
| #1 | complete | 2/2 |
| #2 | blocked | 0/1 - 描述 blocker |

**6.2 文件冲突检查**

如果多个 worktree 修改了同一文件（不应发生，但需防御）：
- 列出冲突文件
- 提示用户选择保留哪个版本，或手动合并

**6.3 更新 PRD**

完成后更新 `prd.md`：

```markdown
## Implementation Progress

### Completed
- [x] {子任务 #1} - {关键决策摘要}

### In Progress
- [ ] {子任务 #2} - {当前状态}

### Blockers
- {问题描述}

### Key Decisions (ADR-lite)
- **决策**: {选择了什么}
- **原因**: {为什么选择这个}
- **后果**: {权衡和风险}
```

**6.4 集成验证与 Fixer Loop**

所有子任务完成后，进入验证修复循环：

```
验证流程：
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  合并 worktree → 运行测试 → 启动 reviewer                     │
│                              │                               │
│                              ▼                               │
│                     reviewer 判定？                           │
│                              │                               │
│              ┌───────────────┴───────────────┐               │
│              ▼                               ▼               │
│          passes=true                    passes=false         │
│              │                               │               │
│              ▼                               ▼               │
│          更新 feature-list             生成 delta_context    │
│              │                               │               │
│              ▼                               ▼               │
│          检查 pending=0?            spawn implementer #2     │
│              │                         (带 delta_context)    │
│              ▼                               │               │
│           通过退出 ◄─────────────────────────┘               │
│                       (循环直到通过或达到 max_attempts)       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Fixer Loop 关键机制**：

1. **Delta Context Handoff**：
   - reviewer 在发现问题时，必须输出结构化的 `delta_context`
   - 包含：问题位置、根因分析、修复建议、读取范围
   - 新 implementer 只需读取问题相关部分，无需重新理解全部代码

2. **迭代上限保护**：
   - 每个 feature 有 `max_attempts`（默认 3）
   - 达到上限后标记为 `blocked`，请求人工干预

3. **主 agent 职责约束**：
   - 主 agent 只做调度，**禁止直接修改代码**
   - reviewer 发现问题后，主 agent 必须 spawn 新 implementer

**delta_context 格式**：
```json
{
  "problem_location": {
    "file": "src/auth/login.ts",
    "lines": "45-52",
    "code_snippet": "..."
  },
  "root_cause": "Token 生成未设置过期时间",
  "fix_suggestion": {
    "action": "add_parameter",
    "details": "传入 { expiresIn: '24h' }",
    "reference_example": "src/auth/refresh.ts:23"
  },
  "files_to_read": ["src/auth/login.ts:45-52"],
  "files_to_skip": ["src/auth/login.ts:1-44"]
}
```

### Step 7: 综合输出

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

### PRD 位置
- `{task_dir}/prd.md`

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
| `verification-gate.md` | Stop hook 验证门控，自动检测 pending features |
| `requirements-confirmation.md` | PRD 中的 Open Questions 遵循确认规范 |

## 决策框架总览

```
收到用户任务
    │
    ├─ proactive-delegation 评估 → 不需要委派 → 直接执行，不触发此 skill
    │
    └─ 需要委派
         │
         ├─ Step 0: 上下文收集 + 规则提取
         │     ├─ 自动搜索相关文件
         │     ├─ 读取相似实现模式
         │     ├─ 提取项目约束
         │     └─ 构建 Rules Pack
         │
         ├─ Step 1: 创建结构化 PRD（新增）
         │     ├─ 创建任务目录
         │     ├─ 填充 PRD 模板
         │     └─ 创建 feature-list.json
         │
         ├─ Step 2: 分解子任务 + 文件所有权
         │     └─ 更新 PRD 的 Implementation Plan
         │
         ├─ Step 3: 选择模式（Subagent / Teams / 分批）
         │
         ├─ 展示分解方案 + PRD → 用户确认
         │
         ├─ Step 4: 构建 prompt + 注入 Rules Pack
         │
         ├─ Step 5: 并行/串行执行
         │
         ├─ Step 6: 聚合结果 + 更新 PRD + Fixer Loop
         │     └─ reviewer 失败 → delta_context → 新 implementer
         │
         └─ Step 7: 综合输出
```

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 未收集上下文就开始分解 | Step 0 自动收集相关文件和模式 |
| 未创建结构化 PRD | Step 1 自动创建 prd.md |
| PRD 只有用户原文 | 区分 "From User" vs "From Context" |
| 未确认就执行 | 分解方案 + PRD 必须经用户确认 |
| 文件所有权重叠 | 一个文件只能属于一个子任务 |
| 所有子任务都用 opus | 按类型匹配模型，研究用 haiku |
| 子任务过大（> 50 turns） | 继续拆分，或使用 long-running harness |
| 子任务过小（< 5 turns） | 合并到相邻子任务，减少编排开销 |
| 串行任务用并行执行 | 有依赖关系的必须串行 |
| 忽略 agent 报告的 blocker | blocker 必须处理后再继续 |
| 未创建 feature-list.json | 分解后必须创建 feature-list.json |
| 跳过验证门控 | 验证未通过时，会触发 Stop hook 阻止退出 |
| **subagent 不继承 rules** | Step 0 提取 Rules Pack 并注入 prompt |
| **把 worktree 当作完整能力隔离** | 额外声明 capability contract（工具/副作用/共享状态） |
| **子 agent 继续递归委派** | 默认禁止递归，深度预算默认 1 |
| **回传完整中间过程污染父上下文** | 默认 summary-only，日志落 task artifacts |
| **主 agent 直接修改代码** | reviewer 失败后，spawn implementer 修复 |
| **无 delta_context 修复** | reviewer 必须输出结构化问题定位 |
| **无限修复循环** | max_attempts 保护，超限请求人工干预 |

## 检查清单

### 上下文收集（Step 0）

- [ ] 是否搜索了相关文件？
- [ ] 是否读取了相似实现模式？
- [ ] 是否提取了项目约束？
- [ ] Rules Pack 是否控制在 500 tokens 以内？

### PRD 创建（Step 1）

- [ ] 是否区分了 "From User" vs "From Context"？
- [ ] Assumptions 是否有验证方法？
- [ ] Open Questions 是否只保留 Blocking/Preference？
- [ ] Definition of Done 是否符合项目标准？
- [ ] feature-list.json 是否同步创建？

### Delegation Boundary（Step 4/5）

- [ ] 子任务 prompt 是否声明 capability boundary？
- [ ] 是否明确限制 delegation depth（默认 1）？
- [ ] 是否避免把 worktree 误当作完整隔离？
- [ ] 返回是否保持 summary-only（中间过程不污染父上下文）？

### Fixer Loop（Step 6.4）

- [ ] reviewer 是否输出 delta_context？
- [ ] delta_context 包含问题位置、根因、修复建议？
- [ ] 主 agent 是否 spawn implementer 而非直接修改？
- [ ] attempt_count 是否正确递增？
- [ ] max_attempts 是否正确保护？
