# CC 配置迁移分析报告

> 生成时间：2026-04-10
> 扫描范围：`~/.claude/skills`、`~/.claude/rules`、`~/.claude/agents`
> 结论口径：只评估“值得框架化并独立部署”的部分，不把 Markdown 规范和深度 CC 集成能力硬迁出去

## 扫描概览

| 类型 | 数量 | 统计命令 |
|------|------|---------|
| Skills | 22 | `find skills -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l` |
| Rules | 42 | `find rules -type f -name '*.md' | wc -l` |
| Agents | 12 | `find agents -type f -name '*.md' | wc -l` |

## 当前已存在的迁移样例

这些对象已经有框架化原型，不应再被当成“从零开始”的第一批目标：

| 名称 | 当前状态 | 位置 |
|------|---------|------|
| orchestrate | 已有 LangGraph 原型 + 对照文档 | `skills/orchestrate/migrated/orchestrate/` |
| self-verification-mechanism | 已有 LangGraph 原型 + 对照文档 | `rules/pattern/migrated/self-verification/` |
| dual-review-loop | 已有 LangGraph 原型 + 对照文档 | `skills/dual-review-loop/migrated/dual-review-loop/` |
| promote-notes | 已有 LangChain 原型 + 对照文档 | `skills/promote-notes/migrated/promote-notes/` |

这意味着当前阶段更需要的是：

1. 刷新全局优先级，而不是重复生成旧样例。
2. 识别“还没迁、但最值得迁”的对象。
3. 把已有样例收敛成共享 runtime，而不是继续散落复制。

## 评估标准

### 维度

- **复杂状态/循环**：是否有显式状态流转、条件边、重试或多阶段流程。
- **生产化价值**：是否值得做成可观测、可 checkpoint、可独立部署的服务。
- **CC 依赖强度**：是否强依赖 Bash / Edit / Write / MCP / `~/.claude` 文件结构。

### 分档规则

| 分数 | 档位 | 含义 |
|------|------|------|
| 7-10 | 高价值 | 推荐迁移，框架能明显放大价值 |
| 4-6 | 中价值 | 可迁，但应排在高价值之后 |
| 0-3 | 低价值 | 建议保留在 CC 配置中 |

### 额外约束

- 深度依赖 `~/.claude/tasks/`、`~/.claude/teams/`、`~/.claude/notes/` 目录语义的对象，即使流程复杂，也不应排进第一批。
- 纯知识规则、纯声明式规范、MCP 强绑定技能，默认不迁。

## 迁移价值评估

### 高价值迁移候选

| 名称 | 类型 | 评分 | 成本 | 当前状态 | 迁移理由 | 推荐框架 |
|------|------|------|------|---------|---------|---------|
| `multi-model-agent` | skill | 8 | Medium | 未迁移 | 有清晰路由规则、模型选择、fallback、成本治理，且天然适合服务化 | LangChain + LiteLLM |
| `orchestrate` | skill | 8 | High | 已有原型 | 多 agent 编排、条件分支、并行执行、验证回路，是最像 LangGraph 的对象 | LangGraph |
| `self-verification-mechanism` | rule | 8 | High | 已有原型 | `passes/null/false` 状态机、fixer loop、`delta_context`、`max_attempts` 非常适合图模型 | LangGraph |
| `dual-review-loop` | skill | 7 | Medium | 已有原型 | 典型 review/fix/review 循环，可直接映射为条件边和回边 | LangGraph |
| `generator-evaluator-pattern` | rule | 7 | Low | 未迁移 | Generator / Evaluator 分离是通用编排原语，复用面广 | LangGraph 子图 |
| `long-running-agent-techniques` | rule | 7 | Medium | 未迁移 | Initializer + Coding Agent + feature list + handoff，本质是长时任务 harness | LangGraph |

### 中价值迁移候选

| 名称 | 类型 | 评分 | 成本 | 说明 |
|------|------|------|------|------|
| `implementer` | agent | 6 | Medium | 可抽成通用 worker 节点，但本身更像 runtime 组件，不该先于编排层迁移 |
| `reviewer` | agent | 6 | Medium | 适合作为独立 evaluator 节点，与 `self-verification` 一起迁移价值更高 |
| `researcher` | agent | 5 | Low | 只读研究 agent 易迁，但单独迁收益有限 |
| `promote-notes` | skill | 5 | Medium | 已有 LangChain 原型，但对 `notes/`、`rules/`、`skills/` 边界语义依赖较强 |
| `team-builder` | skill | 4 | High | 有 roster / OKR / 绩效流程，但重度绑定 `~/.claude/teams/` 目录语义 |

### 低价值迁移候选

| 名称 | 类型 | 评分 | 保留理由 |
|------|------|------|---------|
| `design` | skill | 2 | 依赖 Pencil MCP 和设计编辑器上下文，迁移后适配成本高 |
| `docx` / `pdf` / `pptx` | skill | 2-3 | 主要价值在本地脚本与文件处理，不在图编排 |
| `codex-cc-sync-check` | skill | 1 | 专门服务 CC / Codex 配置对齐，脱离当前生态价值极低 |
| `freeze` / `thaw` / `locate` | skill | 1-2 | 直接操作本仓库知识结构，离开 `~/.claude` 目录语义即失效 |
| `brainstorm` / `eat` | skill | 2-3 | 强依赖交互式上下文注入、Web/Search、文件沉淀流程 |
| 大多数 `rules/domain/*`、`rules/tool/*`、`rules/knowledge/*` | rule | 0-2 | 规则本身是知识或约束，不是运行时流程 |

## 重点判断

### 1. 现在最值得新迁移的不是 `orchestrate`

原因不是它不重要，而是它已经有样例。若现在继续投入，最合理的方向是：

- 把 `skills/orchestrate/migrated/orchestrate/`
- `rules/pattern/migrated/self-verification/`
- `skills/dual-review-loop/migrated/dual-review-loop/`

中的共用概念收敛成统一 runtime，而不是再做第四套平行示例。

### 2. `multi-model-agent` 是当前最好的“下一批第一项”

理由：

- 还没有现成迁移产物，补齐后能扩大迁移覆盖面。
- 其核心是模型路由和策略选择，不依赖 CC 文件结构。
- 它能直接服务后续 `orchestrate` / `reviewer` / `researcher` 节点的模型分配。

可映射对象：

- 模型矩阵 -> 路由配置
- 成本规则 -> policy layer
- fallback -> router fallback chain
- agent frontmatter 的 `model` -> 节点级模型覆盖

### 3. `generator-evaluator-pattern` 和 `long-running-agent-techniques` 应成套迁移

单独迁一个规则价值有限；一起迁移则能形成：

- 长时任务初始化
- 单 feature 递进执行
- evaluator 独立审查
- feature list / checkpoint 持久化

这套组合是构建生产级 agent harness 的骨架。

## 推荐迁移顺序

### Phase 1：补齐未迁移的高价值能力

1. `skills/multi-model-agent/SKILL.md`
2. `rules/pattern/generator-evaluator-pattern.md`
3. `rules/technique/long-running-agent-techniques.md`

目标：

- 增加一个未覆盖的生产能力面
- 补齐共用 routing / evaluator / harness 原语
- 为已有迁移样例提供共享基础设施

### Phase 2：收敛已有迁移样例

1. 收敛 `orchestrate`、`self-verification`、`dual-review-loop` 的共享状态结构
2. 抽出共用节点接口：
   - reviewer node
   - implementer node
   - delta context schema
   - verification gate / interrupt adapter
3. 减少各 `migrated/` 目录中的重复样板代码

### Phase 3：只在有明确服务化需求时再迁

- `promote-notes`
- `team-builder`
- `implementer` / `reviewer` / `researcher` 的独立 agent 包装

这些对象适合在“确实要独立部署”为服务时再处理，不建议现在优先投入。

## 技术映射表

| CC 概念 | LangChain / LangGraph 映射 |
|---------|----------------------------|
| `Agent(subagent_type="implementer")` | 独立 worker node / tool-calling runnable |
| `Agent(subagent_type="reviewer")` | evaluator node |
| `feature-list.json` | `State(TypedDict)` + checkpointer |
| `passes = null/false/true` | 有类型的验证状态机 |
| `delta_context` | state 内结构化修复上下文 |
| Stop hook gate | `interrupt_before` 或显式 gate node |
| Fixer loop | 条件边 + 回边 |
| worktree isolation | 框架外部执行器；不是 LangGraph 内置能力 |
| agent frontmatter `model:` | 节点级 LLM 绑定 |
| LiteLLM routing | LangChain model router / middleware |

## 风险与反模式

| 反模式 | 正确做法 |
|--------|----------|
| 看到规则复杂就全部迁 | 只迁“运行时逻辑”，不迁纯知识 |
| 继续为已迁样例重复造 demo | 先收敛共享 runtime |
| 忽略 `~/.claude` 目录语义 | 深度依赖本仓库结构的对象优先保留 |
| 把 MCP 依赖硬塞进框架 | MCP 强绑定能力保持在 CC 侧 |
| 先迁 agent persona，再迁 orchestration | 先迁编排层和状态层，再抽 persona |

## 建议的下一步

如果继续执行迁移，建议只做下面一条，不要并行扩范围：

1. 以 `skills/multi-model-agent/SKILL.md` 为目标，生成 `migrated/` 代码框架和 `COMPARISON.md`。

备选：

2. 若目标是统一现有样例，则启动一次“shared runtime 收敛”任务，而不是新增第五个 demo。

## 证据

本报告基于以下本地证据生成：

- 目录扫描：
  - `find skills -mindepth 2 -maxdepth 2 -name SKILL.md | sort`
  - `find rules -type f -name '*.md' | sort`
  - `find agents -type f -name '*.md' | sort`
- 核心对象抽样阅读：
  - `skills/orchestrate/SKILL.md`
  - `skills/dual-review-loop/SKILL.md`
  - `skills/promote-notes/SKILL.md`
  - `skills/multi-model-agent/SKILL.md`
  - `rules/pattern/self-verification-mechanism.md`
  - `rules/pattern/generator-evaluator-pattern.md`
  - `rules/technique/long-running-agent-techniques.md`
  - `agents/reviewer.md`
  - `agents/implementer.md`
- 既有迁移样例核对：
  - `skills/orchestrate/migrated/orchestrate/COMPARISON.md`
  - `rules/pattern/migrated/self-verification/COMPARISON.md`
  - `skills/dual-review-loop/migrated/dual-review-loop/COMPARISON.md`
  - `skills/promote-notes/migrated/promote-notes/COMPARISON.md`
