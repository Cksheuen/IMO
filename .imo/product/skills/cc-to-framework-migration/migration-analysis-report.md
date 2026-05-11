# CC 配置迁移分析报告

> 生成时间：2026-04-14
> 扫描范围：`~/.claude/skills`、`~/.claude/rules`、`~/.claude/agents`
> 结论口径：只评估“值得框架化并独立部署”的运行时流程，不把纯知识规则、重度本地文件操作和 MCP 强绑定能力硬迁出去

## 扫描概览

| 类型 | 数量 | 统计命令 |
|------|------|---------|
| Skills | 24 | `find skills -mindepth 2 -maxdepth 2 -name SKILL.md | sort | wc -l` |
| Rules | 51 | `find rules -type f -name '*.md' | sort | wc -l` |
| Agents | 12 | `find agents -type f -name '*.md' | sort | wc -l` |

## 当前已存在的迁移样例

这些对象已经有框架化原型，本次不再把它们当作“从零开始”的首批目标：

| 名称 | 当前状态 | 位置 |
|------|---------|------|
| `orchestrate` | 已有 LangGraph 原型 + 对照文档 | `skills/orchestrate/migrated/orchestrate/` |
| `self-verification-mechanism` | 已有 LangGraph 原型 + 对照文档 | `rules/pattern/migrated/self-verification/` |
| `dual-review-loop` | 已有 LangGraph 原型 + 对照文档 | `skills/dual-review-loop/migrated/dual-review-loop/` |
| `promote-notes` | 已有 LangChain 原型 + 对照文档 | `skills/promote-notes/migrated/promote-notes/` |
| `multi-model-agent` | 已有 LangGraph routing 原型 + 对照文档 | `skills/multi-model-agent/migrated/multi-model-agent/` |
| `generator-evaluator-pattern` | 已有 LangGraph 子图原型 + 对照文档 | `rules/pattern/migrated/generator-evaluator/` |
| `long-running-agent-techniques` | 已有 LangGraph harness 原型 + 对照文档 | `rules/technique/migrated/long-running-agent/` |

此外，当前已经开始收敛共享运行层：

- `skills/migrated/shared_runtime/`：共享 typed state 片段、graph compile helper 与 agent protocol

## 评估标准

### 维度

- **复杂状态/循环**：是否有显式状态流转、条件边、重试或阶段循环。
- **生产化价值**：是否值得做成可观测、可 checkpoint、可独立复用的 runtime。
- **CC 依赖强度**：是否强依赖 Bash、Edit、MCP 或 `~/.claude/*` 目录语义。

### 分档规则

| 分数 | 档位 | 含义 |
|------|------|------|
| 7-10 | 高价值 | 推荐迁移，框架能明显放大价值 |
| 4-6 | 中价值 | 可迁，但应排在高价值之后 |
| 0-3 | 低价值 | 建议保留在 CC 配置中 |

### 当前判断边界

- 深度依赖 `tasks/`、`notes/`、`hooks/` 目录语义的对象，即使流程复杂，也不应排进第一批。
- 纯知识规则、纯 frontmatter 约束、MCP 强绑定技能默认不迁。
- 已有样例优先进入“共享 runtime 收敛”问题域，而不是继续复制 demo。

## 迁移价值评估

### 高价值迁移候选

| 名称 | 类型 | 评分 | 成本 | 当前状态 | 迁移理由 | 推荐框架 |
|------|------|------|------|---------|---------|---------|
| `generator-evaluator-pattern` | rule | 7 | Low | 已有原型 | Generator / Evaluator 分离天然对应 LangGraph 节点和回路，复用面广 | LangGraph 子图 |
| `long-running-agent-techniques` | rule | 7 | Medium | 已有原型 | `initializer -> coding agent -> feature list -> handoff` 是典型长时任务 harness | LangGraph |
| `team-builder` | skill | 7 | High | 未迁移 | 有 roster、OKR、绩效流转，具备多角色状态机雏形 | LangGraph |
| `orchestrate` | skill | 8 | High | 已有原型 | 多 agent 编排、依赖分析、验证回路，本质就是图执行 | LangGraph |
| `self-verification-mechanism` | rule | 8 | High | 已有原型 | `passes/null/false` 状态机和 fixer loop 非常适合图模型 | LangGraph |

### 中价值迁移候选

| 名称 | 类型 | 评分 | 成本 | 说明 |
|------|------|------|------|------|
| `implementer` | agent | 6 | Medium | 更适合作为共享 worker 节点，而不是单独迁成服务 |
| `reviewer` | agent | 6 | Medium | 适合作为 evaluator 节点，与 verification/runtime 一起迁价值更高 |
| `researcher` | agent | 5 | Low | 易迁，但单独迁收益有限 |
| `promote-notes` | skill | 5 | Medium | 已有原型，但对仓库目录语义依赖仍较强 |
| `brainstorm` | skill | 4 | Medium | 有研究与收敛流程，但强依赖交互式上下文注入 |

### 低价值迁移候选

| 名称 | 类型 | 评分 | 保留理由 |
|------|------|------|---------|
| `design` | skill | 2 | 依赖 Pencil MCP 和编辑器状态，迁移后适配成本高 |
| `docx` / `pdf` / `pptx` | skill | 2-3 | 核心价值在本地文件处理，不在 LangGraph 编排 |
| `codex-cc-sync-check` | skill | 1 | 只服务 CC / Codex 配置对齐，脱离当前生态几乎无价值 |
| `freeze` / `thaw` / `locate` | skill | 1-2 | 直接操作本仓库知识结构，离开目录语义即失效 |
| 大多数 `rules/domain/*`、`rules/tool/*`、`rules/knowledge/*` | rule | 0-2 | 规则本身是知识或约束，不是运行时流程 |

## 重点判断

### 1. 当前新增样例已经补到 `generator-evaluator-pattern` 与 `long-running-agent-techniques`

原因：

- 规则侧现在已经有两个最小运行时样例：一个偏质量闭环，一个偏长时 harness。
- 这让后续 shared runtime 收敛有了更稳定的对照面。
- 下一步的收益点开始从“补 demo”转向“抽共用层”。
- 当前已新增 `skills/migrated/shared_runtime/`，说明收敛阶段已经启动。

### 2. 下一步更适合做 shared runtime，而不是继续追加第三个规则样例

原因：

- `orchestrate`、`self-verification`、`generator-evaluator`、`long-running-agent` 已经出现重复概念。
- 再追加新 demo 的边际收益已经下降。
- 现在更值得统一 reviewer / implementer / gate / handoff / checkpoint 等接口。

### 3. 已有样例的主要问题已从“缺 demo”转向“缺共享层”

已有样例之间已经出现共享概念：

- reviewer / implementer 角色节点
- verification / approval gate
- typed state + checkpoint
- interrupt / resume

因此下一阶段更合理的方向不是继续堆 demo，而是抽共享 runtime。

## 推荐迁移顺序

### Phase 1：从“补 demo”切到“收敛共用层”

1. reviewer / implementer 节点接口统一
2. approval / verification / handoff gate 抽象
3. 状态 schema 和 checkpoint 边界统一

目标：

- 减少已有迁移样例的重复样板
- 为后续服务化 runtime 打公共底座

### Phase 2：只在明确有收益时再补新对象

1. `team-builder`
2. persona 级 agent service 封装
3. 更完整的 long-running external executor

### Phase 3：只在明确服务化时迁 persona 或仓库治理技能

- `team-builder`
- `implementer` / `reviewer` / `researcher` 的服务封装
- `promote-notes` 的目录治理 runtime

## 技术映射表

| CC 概念 | LangChain / LangGraph 映射 |
|---------|----------------------------|
| `Generator` | graph node / runnable |
| `Evaluator` | evaluator node / guard node |
| “通过/不通过”评估结论 | typed review result in state |
| 反馈循环 | conditional edge + loop back |
| `feature-list.json` | `State(TypedDict)` + checkpointer |
| `stop hook` / gate | `interrupt_before` 或显式 gate node |
| `subagent persona` | 节点级 prompt / node implementation |
| `model:` frontmatter | 节点级模型绑定 |

## 风险与反模式

| 反模式 | 正确做法 |
|--------|----------|
| 把纯知识规则都当成候选 | 只迁运行时流程，不迁静态知识 |
| 已有 demo 还继续重复造轮子 | 优先补未覆盖能力或收敛共享层 |
| 忽略仓库目录语义 | 目录强绑定对象默认保留在 CC 侧 |
| 为了“看起来完整”一次迁多个候选 | 先做单对象样例，验证映射是否成立 |

## 本次建议的下一步

如果继续执行迁移，建议按以下顺序推进：

1. 开一个 shared runtime 收敛任务，统一 state schema 与 gate 语义。
2. 若仍需补对象，优先评估 `team-builder` 是否值得服务化。
3. 把 `long-running-agent` 从占位 harness 提升为可接真实执行器的 runtime。

## 证据

本报告基于以下本地证据生成：

- 目录扫描：
  - `find skills -mindepth 2 -maxdepth 2 -name SKILL.md | sort`
  - `find rules -type f -name '*.md' | sort`
  - `find agents -type f -name '*.md' | sort`
- 既有迁移样例核对：
  - `skills/orchestrate/migrated/orchestrate/`
  - `rules/pattern/migrated/self-verification/`
  - `skills/dual-review-loop/migrated/dual-review-loop/`
  - `skills/promote-notes/migrated/promote-notes/`
  - `skills/multi-model-agent/migrated/multi-model-agent/`
  - `rules/pattern/migrated/generator-evaluator/`
  - `rules/technique/migrated/long-running-agent/`
- 核心对象抽样阅读：
  - `rules/pattern/generator-evaluator-pattern.md`
  - `rules/technique/long-running-agent-techniques.md`
  - `skills/cc-to-framework-migration/SKILL.md`
