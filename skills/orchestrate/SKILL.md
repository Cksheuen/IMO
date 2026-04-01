---
name: orchestrate
description: Multi-agent orchestration skill. Automatically decomposes large tasks into subtasks, assigns them to specialized agents (implementer/researcher/reviewer), and coordinates parallel execution with worktree isolation. Trigger when task involves 3+ files, 2+ domains, or user says "并行"/"parallel"/"orchestrate"/"拆分执行".
---

# Orchestrate - Multi-Agent Task Orchestration

**将大任务自动拆分为子任务，分配给专用 Agent 并行执行，收集并聚合结果。**

```
大任务 → 规则提取 → 分解 → 分配 → 并行执行 → 聚合 → 验证 → 交付
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

### Step 0: 规则提取与注入（新增）

> **核心问题**：subagent 默认不继承主 agent 的 rules，导致行为不一致。
> **解决方案**：在构建 agent prompt 时，提取并注入相关规则。

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

#### 0.2 规则匹配表

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

  database:
    essential:
      - rules/domain/native/rust-egui-testing.md
    patterns:
      - rules/pattern/testable-architecture.md

  refactor:
    essential:
      - rules/core/
    patterns:
      - rules/pattern/change-impact-review.md
      - rules/pattern/cross-layer-preflight.md
      - rules/pattern/generator-evaluator-pattern.md

  test:
    essential:
      - rules/scoped/tests/
      - rules/domain/shared/testable-architecture.md
    patterns: []

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

#### 0.3 规则提取策略

**提取原则**：只提取规则的**核心约束**，而非全文。

| 规则类型 | 提取内容 | Token 预算 |
|---------|---------|-----------|
| core | 核心原则摘要（3-5 条） | 100 |
| domain | 关键约束列表（5-10 条） | 100-200 |
| pattern | 触发条件 + 执行要点 | 100-200 |
| technique | 工具使用要点 | 50-100 |

**总预算**：300-500 tokens，避免 prompt 膨胀。

#### 0.4 Rules Pack 格式

提取后的规则以如下格式注入 agent prompt：

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

#### 0.5 实现示例

```python
# 伪代码：规则提取逻辑
def extract_rules(task_description: str, files: list[str]) -> str:
    task_type = identify_task_type(task_description, files)
    rule_paths = TASK_TYPE_TO_RULES.get(task_type, TASK_TYPE_TO_RULES["default"])

    rules_pack = []
    for path in rule_paths:
        content = read_rule(path)
        extracted = extract_key_constraints(content)  # 只提取核心约束
        rules_pack.append(extracted)

    return format_rules_pack(rules_pack)
```

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

**Feature List 创建**（关键）：
分解完成后，**必须在项目级 task 目录中创建 feature-list.json**：

```bash
# 解析 task 根目录：优先 <project>/.claude/tasks
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

# 创建任务目录
TASK_DATE=$(date +%F)
TASK_SLUG="feature-auth"
TASK_DIR="$TASK_DATE-$TASK_SLUG"
mkdir -p "$TASKS_ROOT/$TASK_DIR"

# 创建 feature-list.json
cat > "$TASKS_ROOT/$TASK_DIR/feature-list.json" << 'EOF'
{
  "task_id": "$TASK_DIR",
  "created_at": "$(date -I --iso-8601-seconds=utc)",
  "session_id": "$SESSION_ID",
  "status": "in_progress",
  "features": [
    {
      "id": "F001",
      "category": "functional",
      "description": "子任务 #1 描述",
      "acceptance_criteria": ["验收标准1", "验收标准2"],
      "verification_method": "e2e",
      "passes": null,
      "verified_at": null,
      "attempt_count": 0,
      "max_attempts": 3,
      "notes": "",
      "delta_context": null
    }
  ],
  "summary": {
    "total": N,
    "passed": 0,
    "pending": N
  }
}
EOF

# 创建 current 符号链接
ln -sfn "$TASK_DIR" "$TASKS_ROOT/current"
```

目录名必须优先使用语义化 slug，例如 `2026-03-31-feature-auth`、`2026-03-31-skill-eval-iteration-2`。只有任务尚未成型时，才允许使用 `2026-03-31-draft-task-<shortid>` 作为临时兜底名。

路径规则：

- 默认使用 `<project>/.claude/tasks/`
- 当前仓库自身位于 `~/.claude/`，因此这里的任务目录表现为 `~/.claude/tasks/`
- 若当前不在 git 项目中，但从当前目录向上能找到某个项目的 `.claude/`，则仍使用该项目的 `.claude/tasks/`
- 只有既不在 git 项目中、向上也找不到 `.claude/` 时，才回退到 `~/.claude/tasks/`

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

### 适用规则（Rules Pack）
{从 Step 0 提取的 Rules Pack，包含核心原则、领域规范、模式规范}

### 输出格式
按 agent 类型要求的标准格式输出
```

**关键改进**：
- Rules Pack 替代了原来的占位符 `{从 CLAUDE.md 或 rules 中提取的相关规范}`
- Rules Pack 来自 Step 0 的结构化提取，而非临时拼凑

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

**5.3 集成验证与 Fixer Loop**

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

**verification-gate.sh 行为**：
- 检测 `passes=false` 时，输出 `VERIFICATION_FAILED` 指令
- 主 agent 读取指令后，spawn implementer 执行修复
- 循环直到 `pending=0` 或达到迭代上限

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
| `verification-gate.md` | Stop hook 验证门控，自动检测 pending features |

## 决策框架总览

```
收到用户任务
    │
    ├─ proactive-delegation 评估 → 不需要委派 → 直接执行，不触发此 skill
    │
    └─ 需要委派
         │
         ├─ Step 0: 规则提取（新增）
         │     └─ 识别任务类型 → 匹配规则 → 构建 Rules Pack
         │
         ├─ Step 1: 分解子任务 + 文件所有权
         │
         ├─ Step 2: 选择模式（Subagent / Teams / 分批）
         │
         ├─ 展示分解方案 → 用户确认
         │
         ├─ Step 3: 构建 prompt + 注入 Rules Pack
         │
         ├─ Step 4: 并行/串行执行
         │
         ├─ Step 5: 聚合结果 + Fixer Loop
         │     └─ reviewer 失败 → delta_context → 新 implementer
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
| 未创建 feature-list.json | 分解后必须创建 feature-list.json |
| 跳过验证门控 | 验证未通过时，会触发 Stop hook 阻止退出 |
| **subagent 不继承 rules** | Step 0 提取 Rules Pack 并注入 prompt |
| **主 agent 直接修改代码** | reviewer 失败后，spawn implementer 修复 |
| **无 delta_context 修复** | reviewer 必须输出结构化问题定位 |
| **无限修复循环** | max_attempts 保护，超限请求人工干预 |

## 检查清单

### 规则注入（Step 0）

- [ ] 任务类型是否识别正确？
- [ ] 相关 rules 是否匹配完整？
- [ ] Rules Pack 是否控制在 500 tokens 以内？
- [ ] 核心/领域/模式规范是否都有体现？

### Fixer Loop（Step 5.3）

- [ ] reviewer 是否输出 delta_context？
- [ ] delta_context 包含问题位置、根因、修复建议？
- [ ] 主 agent 是否 spawn implementer 而非直接修改？
- [ ] attempt_count 是否正确递增？
- [ ] max_attempts 是否正确保护？
