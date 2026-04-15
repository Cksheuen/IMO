# Project Rules (auto-synced from Claude Code)
# Source: ~/.claude/rules/

These rules guide coding style, architecture decisions, and quality standards.
Follow them when implementing tasks.

> **重要**：标记为索引的规则段落只包含触发条件摘要和文件路径。当索引行的触发条件匹配当前任务时，必须先用 cat 读取对应文件的完整内容，再按规则执行。不要仅凭摘要行事。

## 全局入口

## 核心原则

- **简洁优先**：每次只改完成目标所需的最小范围
- **根因导向**：拒绝临时修补，优先修正真正的设计或流程问题
- **最小影响**：不顺手扩范围，不混入无关清理
- **架构跟随**：进入新项目或陌生模块先读项目架构入口，再按现有分层、目录与命名方式扩展，不按个人偏好重塑结构

## 高优先级边界

- 当前任务事实写 `tasks/`
- 跨任务复用结论写 `notes/`
- 稳定事实快照写 `memory/declarative/`
- 历史过程检索走 `recall/`
- `hooks/` 只放事件脚本；未挂到 `settings.json` 或项目级 `.claude/settings.json` 前，不算已接通运行链

## 必查规则入口

- 上下文注入：`rules/core/context-injection.md`
- 规则目录分流：`rules-library/core/rules-directory-convention.md`
- 项目架构优先：`rules-library/core/project-architecture-first.md`
- 任务工作流：`rules-library/core/task-centric-workflow.md`
- task / notes 边界：`rules-library/core/task-notes-boundary.md`
- 改动边界守卫：`rules-library/pattern/change-scope-guard.md`
- 变更影响审查：`rules-library/pattern/change-impact-review.md`
- 废弃方案清理：`rules-library/pattern/abandoned-solution-cleanup.md`
- 闭环学习边界：`rules-library/pattern/closed-learning-loop.md`
- UI / 逻辑边界：`rules-library/domain/frontend/ui-logic-boundary.md`
- LangChain 迁移 runtime 依赖：`rules-library/tool/langchain-runtime-dependencies.md`
## 核心规范

### Context Injection Pattern

# Context Injection Pattern

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 核心原则

**按需注入，而非全局加载**

当项目规范变多时，分层组织规范文件，根据当前任务注入相关上下文，避免单文件膨胀。

## 实践要点

1. **CLAUDE.md 保持精简**：只放核心原则（< 100 行）
2. **规范两层存储**：
   - `rules/`：always-loaded，每次会话自动加载（仅放元级约束，当前 4 个文件）
   - `rules-library/`：按需注入，由 `hooks/rules-inject.py` 根据 prompt 关键词匹配加载
   - 子分类：`core/`、`pattern/`、`technique/`、`tool/`、`domain/`
3. **按需引用**：在 CLAUDE.md 中引用相关规则文件

## Claude Code 原生支持

```markdown
# CLAUDE.md 中引用其他文件

## 架构规范
See [architecture.md](rules-library/pattern/architecture.md)

## 当前任务
See [task-context.md](<project>/.claude/tasks/current/context.md)

若当前仓库本身就是 `~/.claude/`，则当前项目 task 路径等价为 `~/.claude/tasks/current/context.md`。
```

### 全局治理资产优先规范

# 全局治理资产优先规范

> 来源：项目内先改 CC / Codex 同步配置，随后确认应提升为全局真源的治理收敛 | 吸收时间：2026-04-13

## 核心问题

当某项修改本质上服务于 Claude Code / Codex 的共享工作流时，如果先写在某个项目目录里、却没有及时提升到全局，会出现：

- 项目内副本和全局真源双写漂移
- 新会话在其他目录下看不到同样的行为
- Codex / Claude 只在某个仓库里“表现正确”，离开仓库就失效
- 后续规则、skill、hook 修改不知道该改哪一份

## 核心原则

**凡是共享治理资产，默认全局真源优先。**

默认落点应是 `~/.claude/`，而不是某个项目目录。

只有在明确满足“仅该项目适用”时，才允许保留在项目内。

## 触发条件

当出现以下任一情况时，必须应用本规范：

- 修改或新增 `rules/`
- 修改或新增共享 `skills/`
- 修改或新增 `hooks/`
- 修改或新增 `AGENTS.md` 相关入口
- 修改或新增 Codex / Claude 同步配置
- 修改会影响多个项目复用的 agent 工作流约束

## 默认分类

以下内容默认视为全局治理资产：

- `~/.claude/rules/`（always-loaded）与 `~/.claude/rules-library/`（按需注入）
- `~/.claude/skills/`
- `~/.claude/hooks/`
- `~/.claude/shared-knowledge/AGENTS.md` 的来源内容
- `~/.codex/AGENTS*.md` 的对齐关系
- `~/.codex/skills/` 与 `~/.codex/commands/` 的同步可见性规则

以下内容默认不是全局治理资产：

- 项目级 `tasks/`
- 项目实现代码
- 项目测试样本与夹具
- 明确依赖该项目领域模型的脚本

## 执行规范

发现项目内新增或修改了共享治理资产时，按以下顺序处理：

1. 判断它是否只服务当前项目。
2. 若不是仅项目适用，提升到 `~/.claude/` 全局真源。
3. 运行同步链路，让 Codex 看见最新全局资产。
4. 清理项目内同名副本，避免双源漂移。
5. 在 task / status 中记录“已提升到全局”这一事实。

## 判断标准

满足以下任一条件，通常应提升到全局：

- 离开当前项目后仍然成立
- 服务的是 Agent 工作流，而不是项目业务逻辑
- 会影响 Codex / Claude 的共享行为
- 后续在其他仓库里也应该自动可用

满足以下全部条件，才可保留项目内：

- 明确依赖当前项目结构或领域术语
- 离开该项目就失去意义
- 用户明确指定“仅该项目适用”

## 决策框架

```text
这是治理资产？
    │
    ├─ 否 → 留在项目内
    │
    └─ 是 → 离开当前项目后仍有价值？
            │
            ├─ 是 → 提升到 ~/.claude/ 并同步到 Codex
            │
            └─ 否 → 仅在项目内保留，并显式标注 project-only
```

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 在项目里新增共享 skill，却不提升到全局 | 提升到 `~/.claude/skills/`，然后同步 |
| 项目内和全局各保留一份同名规则 | 保留单一真源，删除副本 |
| 先修了 Codex / Claude 对齐行为，却不跑同步脚本 | 修改后立即同步 |
| 默认把治理规则当项目文档 | 默认按全局资产处理 |
| 本该全局复用的内容只写进 task | task 记事实，全局目录记真源 |

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules-library/core/task-centric-workflow.md` | task 仍只记录当前任务事实，不承担全局治理真源 |
| `rules-library/core/task-notes-boundary.md` | 本规范进一步明确了治理资产不应沉在项目 task 中长期充当真源 |
| `skills/codex-cc-sync-check` | 本规范定义“何时应提升到全局”，该 skill 负责“提升后如何对齐到 Codex” |

### LLM 友好格式规范

# LLM 友好格式规范

> 来源：调研 Markdown/YAML/JSON 对 LLM 的效率影响 | 吸收时间：2026-03-26

## 触发条件

当编写供 LLM 阅读的文档（rules、skills、memory）时，应用此规范：
- 需要在 token 效率和可读性之间平衡
- 包含嵌套结构或配置数据
- 追求 Agent 正确解析的高准确性

## 核心原则

**混合格式：叙述用 Markdown，结构用 YAML**

| 格式 | Token 效率 | 准确性 | 适用场景 |
|------|------------|--------|----------|
| **Markdown** | 最高（比 JSON 省 34-38%） | 中 | 纯文本描述、流程说明 |
| **YAML** | 中（比 JSON 省 10-15%） | **最高 62%** | 嵌套结构、配置数据 |
| **JSON** | 低 | 中 50% | API 交互、程序化处理 |
| **XML** | 最差（比 Markdown 多 80%） | 低 | ❌ 禁止使用 |

## 决策框架

```
内容类型？
    │
    ├─ 嵌套层级 ≥ 3 层 ──→ YAML 代码块
    │
    ├─ 流程步骤 ──→ Markdown 列表
    │
    ├─ 对比数据 ──→ Markdown 表格
    │
    └─ 决策逻辑 ──→ Markdown 代码块（ASCII 树）
```

## 格式规范

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 全部用 YAML | Token 浪费 | 叙述用 Markdown |
| 全部用 Markdown | 嵌套结构难解析 | 深层嵌套用 YAML |
| 使用 XML | Token 浪费 80% | ❌ 禁止 |
| 使用 JSON | Token 浪费 34% | 仅 API 交互时用 |

### 用户交流语言规范

# 用户交流语言规范

> 来源：当前配置中“持久化内容默认中文”覆盖了文档层，但未稳定约束用户交互输出语言 | 吸收时间：2026-04-10

## 核心问题

Agent 当前对“中文”约束主要落在 `skills/`、`rules/`、`notes/`、`tasks/` 等持久化内容，导致用户交互层仍可能混入英文默认话术、英文状态更新或英文结论。

## 核心原则

**只要是在和用户说话，默认使用中文。**

代码、命令、路径、报错原文、协议字段名可以保留英文，但包裹它们的解释、判断、结论和行动说明应使用中文。

## 触发条件


*(truncated due to size limit)*

## 架构模式（索引）

> 触发条件匹配时，用 cat 读取对应路径获取完整规则

- **废弃方案清理规范** — 用户明确否定、撤回、替换先前批准过的方案 → `rules-library/pattern/abandoned-solution-cleanup.md`
- **自动创建的 Feature List 噪音处理** — `/codex:rescue` 等工具路由命令 → `rules-library/pattern/auto-created-feature-list-noise.md`
- **变更影响审查规范** — 重构代码结构 → `rules-library/pattern/change-impact-review.md`
- **改动边界守卫规范** — 修改现有文件或现有规则 → `rules-library/pattern/change-scope-guard.md`
- **Closed Learning Loop Pattern** — 需要决定 transcript / task / notes / memory / recall / skills / user model 的边界 → `rules-library/pattern/closed-learning-loop.md`
- **Code-as-Interface Pattern** — 需要控制复杂系统（浏览器、文件系统、API） → `rules-library/pattern/code-as-interface.md`
- **跨层功能预检规范** — Master→Worker→Python 调用链 → `rules-library/pattern/cross-layer-preflight.md`
- **连续执行规范** — 用户已经明确总体目标或接受了当前执行方向 → `rules-library/pattern/execution-continuity.md`
- **Generator-Evaluator 模式规范** — 当任务满足以下任一条件时，**必须**使用 Generator-Evaluator 分离： → `rules-library/pattern/generator-evaluator-pattern.md`
- **Living Spec Pattern** — 当使用 spec/specification 流程时，评估是否需要 Living Spec： → `rules-library/pattern/living-spec.md`
- **Promotion Loop 后台执行约束** — 当 Stop hook 检测到 correction signals 或 promotion candidates 时。 → `rules-library/pattern/promotion-loop-background-execution.md`
- **需求确认规范** — 需求存在多种合理理解 → `rules-library/pattern/requirements-confirmation.md`
- **Agent 自验证机制** — 所有 feature 通过验证 → `rules-library/pattern/self-verification-mechanism.md`
## 领域规则（索引）

> 触发条件匹配时，用 cat 读取对应路径获取完整规则

- **后端架构阶段定义** — 修改 `handlers/`、`controllers/`、`routes/`、`api/` 下的文件 → `rules-library/domain/backend/architecture-stages.md`
- **前端 UI / 逻辑边界规范** — 修改 `src/pages/**`、`src/components/**` → `rules-library/domain/frontend/ui-logic-boundary.md`
- **UI / 逻辑解耦后的测试编写规范** — 只测后端纯逻辑，失去真实前端调用链 → `rules-library/domain/frontend/ui-logic-decoupled-testing.md`
- **ML 训练代码预评估规范** — 训练时间 > 1 小时 → `rules-library/domain/ml/ml-training-preflight-checks.md`
- **Rust + egui 桌面应用测试方案** — UI 交互逻辑验证 → `rules-library/domain/native/rust-egui-testing.md`
- **通用/全栈领域架构阶段定义** — CLI 工具 / 命令行脚本项目 → `rules-library/domain/shared/architecture-stages.md`
- **可测试架构范式** — 新建桌面/移动应用项目 → `rules-library/domain/shared/testable-architecture.md`