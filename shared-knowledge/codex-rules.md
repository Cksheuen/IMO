# Project Rules (auto-synced from Claude Code)
# Source: ~/.claude/rules/

These rules guide coding style, architecture decisions, and quality standards.
Follow them when implementing tasks.

## 设计哲学

三条不可违背的原则:

- **简洁优先** - 每个变更尽可能简单，影响最少的代码
- **根因导向** - 找到根因，拒绝临时修复，保持 Staff 级工程师标准
- **最小影响** - 只触及必要部分，不引入新问题
## 核心规范

### Context Injection Pattern

# Context Injection Pattern

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 核心原则

**按需注入，而非全局加载**

当项目规范变多时，分层组织规范文件，根据当前任务注入相关上下文，避免单文件膨胀。

## 实践要点

1. **CLAUDE.md 保持精简**：只放核心原则（< 100 行）
2. **规范分层存储**：`rules/pattern/`, `rules/technique/`, `rules/tool/`, `rules/knowledge/`
3. **按需引用**：在 CLAUDE.md 中引用相关规则文件

## Claude Code 原生支持

```markdown
# CLAUDE.md 中引用其他文件

## 架构规范
See [architecture.md](rules/pattern/architecture.md)

## 当前任务
See [task-context.md](<project>/.claude/tasks/current/context.md)

若当前仓库本身就是 `~/.claude/`，则当前项目 task 路径等价为 `~/.claude/tasks/current/context.md`。
```

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

### 主动委派决策框架

# 主动委派决策框架

> 来源：brainstorm 调研（JetBrains Research、dev.to、Claude Code Docs）| 吸收时间：2026-03-26

## 核心原则

**预防优于补救：在上下文膨胀发生前主动委派**

| 对比维度 | 事后处理 | 主动委派 |
|---------|---------|---------|
| **时机** | 上下文已膨胀后 | 任务开始前评估 |
| **范围** | 跨会话恢复 | 会话内预防 |
| **成本** | 高（需 Handoff/Reset） | 低（仅委派决策） |

## 触发条件

当接收到任务后，**执行前**评估任务规模：

| 评估维度 | 高风险阈值 | 权重 |
|---------|-----------|------|
| **文件数量预估** | > 5 文件 | 高 |
| **代码行数预估** | > 500 行 | 高 |
| **领域数量** | > 2 领域（前端/后端/数据库/测试等） | 中 |
| **后续任务** | 有明确的后续任务 | 中 |

## 决策框架

```
评估任务规模
    │
    ├─ 高风险项 ≥ 2
    │       │
    │       ├─ 子任务独立 → 并行 Subagent
    │       │
    │       └─ 子任务有依赖 → 链式 Subagent
    │
    ├─ 高风险项 = 1
    │       │
    │       └─ 考虑委派（参考复杂度）
    │
    └─ 无高风险 → 直接执行
```

## 执行规范

## Subagent 汇报

## 与现有规则的关系

| 规则 | 关系 | 协作方式 |
|------|------|----------|
| [[long-running-agent-techniques]] | **互补** | 主动委派（会话内预防）+ Harness（跨会话恢复） |
| [[generator-evaluator-pattern]] | **增强** | 复杂任务可用 Subagent 做 Generator，主 Agent 做 Evaluator |
| [[context-injection]] | **关联** | 按需注入上下文 + 主动委派避免膨胀 |

### Task-Centric Workflow

# Task-Centric Workflow

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 核心原则

**任务驱动，上下文隔离**

每个任务独立目录，包含完整的上下文（PRD、实现状态、评审标准），使 AI 能准确理解工作目标。

`tasks/` 的标准位置是项目级目录：`<project>/.claude/tasks/`。

如果当前项目根目录本身就是 `.claude/`（例如本仓库），那么任务目录会自然落在仓库根下的 `tasks/`。

## 目录结构

```text
<project>/.claude/tasks/
├── 2026-03-31-feature-auth/
│   ├── prd.md        # 需求 + Acceptance Criteria
│   ├── context.md    # 相关文件、依赖
│   └── status.md     # 进度、blockers、next steps
└── 2026-03-31-feature-payment/
    └── ...
```

## 命名规范

任务目录名使用 `YYYY-MM-DD-slug`，其中 `slug` 必须直接表达任务目标，风格尽量接近 Trellis 的 `feature-auth` 这种语义化命名。

- 优先使用任务目标，例如 `2026-03-31-feature-auth`
- 评估/调研类任务也保持语义化，例如 `2026-03-31-skill-eval-iteration-2`
- 若任务尚未成型、暂时没有稳定语义，才允许使用 `YYYY-MM-DD-draft-task-<shortid>` 兜底
- 禁止直接使用纯 UUID 作为目录名，否则目录扫描时不可读、不可检索、不可恢复

## 关键实践

1. **PRD 明确验收标准**：Acceptance Criteria 作为评审依据
2. **status.md 记录进度**：便于会话恢复
3. **context.md 隔离上下文**：每个任务有独立的相关文件列表
4. **目录名可读**：扫描 `tasks/` 时应能直接看出任务主题，而不是再打开文件反查 UUID

## 文件规范

## 与 `notes/` 的分工

- `tasks/`：项目级目录，服务当前任务闭环
- `notes/`：用户级全局目录 `~/.claude/notes/`，沉淀跨任务复用知识
- 当一段内容既需要当前执行、又值得长期保留时，`tasks/` 只保留摘要和指针，完整正文写入 `notes/`

详见 [[task-notes-boundary]]。

## 与 CLAUDE.md 的关系

CLAUDE.md Plan 阶段已整合此模式：每个任务独立规划，状态可追踪。

### Task / Notes Boundary

# Task / Notes Boundary

> 来源：对 `tasks/` 与 `notes/` 职责重叠问题的收敛分析 | 吸收时间：2026-03-31

## 核心原则

**`<project>/.claude/tasks/` 记录本次任务事实，`~/.claude/notes/` 沉淀跨任务知识。**

两者可以引用同一事件，但不能承担同一职责。

## 触发条件

当出现以下任一情况时，必须应用本规范：

- 准备创建或更新 `<project>/.claude/tasks/<task>/` 内容
- 准备把执行过程、失败原因、调研结论写入 `~/.claude/notes/`
- 发现同一段内容既想写进 task，又想写进 note
- 进行任务归档、复盘、调研收敛、设计收敛

## 职责边界

| 目录 | 核心问题 | 应存内容 | 不应存内容 |
|------|----------|----------|------------|
| `<project>/.claude/tasks/` | 这次任务要做什么、做到哪了、卡在哪 | PRD、context、status、feature list、验收、blocker、当前证据链接 | 脱离当前任务仍成立的通用原则、长期复盘、跨任务方法论 |
| `~/.claude/notes/` | 这类问题以后应该怎么理解和复用 | lessons、research、design、稳定结论、跨任务模式 | 只服务单次执行的临时状态、运行时锁文件、纯任务队列 |

## 写入规则

## 决策框架

写入前依次判断：

1. 这段内容如果离开当前任务，是否仍然有价值？
2. 这段内容的主要用途是推进执行，还是指导未来决策？
3. 它会在任务完成后失效，还是应继续被检索复用？

决策规则：

- 三问都偏“当前执行” -> 写 `<project>/.claude/tasks/`
- 三问都偏“长期复用” -> 写 `~/.claude/notes/`
- 若同时满足两边：`tasks/` 只留摘要和指针，完整结论写 `notes/`

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

## 最小落地要求

- `tasks/` 中出现长段解释性结论时，检查是否应迁移到 `notes/`
- `notes/` 中出现纯进度汇报时，回退到 `tasks/`
- 调研型任务和复盘型任务默认采用“task 摘要 + notes 正文”双层结构，而不是双写正文
## 架构模式

### 动画帧驱动设计原则

# 动画帧驱动设计原则

> 来源：[Venni Kauppila Thesis - Hollow Knight Animation](https://www.theseus.fi/bitstream/handle/10024/796853/Venni_Kauppila.pdf)、[GDC - Rain World Animation Process](https://www.gdcvault.com/play/1023475/Animation-Bootcamp-Rainworld-Animation)
> 吸收时间：2026-03-28

## 核心洞察

**角色手感 99% 来自精心设计的逐帧动画，代码只负责触发式辅助效果。**

空洞骑士 Team Cherry 在 Photoshop 中手绘每一帧，所有 squash & stretch 在帧内预绘——代码从不用 `scaleX/scaleY` 模拟变形。雨世界的程序化动画同样遵循此原则：物理驱动的是**部件位置**，而非替代手工设计的表现力。

## 触发条件

当设计 2D 游戏角色动画系统时：
- 需要决定某个视觉效果由动画帧还是代码实现
- 角色手感不佳，考虑用代码 tween/粒子补救
- 规划精灵表和动画状态机

## 分工框架

## 决策框架

```
这个视觉效果应该用什么实现？
    │
    ├─ 角色的姿态/形变/节奏？
    │       → 动画帧（美术画）
    │
    ├─ 瞬时反馈（闪烁/震动/暂停）？
    │       → 代码触发
    │
    ├─ 持续跟随物理的装饰？
    │       → 程序化附件
    │
    └─ 不确定？
            → 先尝试动画帧。
              如果帧数爆炸或需要实时响应 → 改为程序化。
              绝对不要用代码 tween 补救动画不足。
```

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|---------|
| 用 `scaleX/scaleY` 做 squash | 看起来像 bug，不像设计 | 在帧内画出变形后的角色 |
| 用随机 offset 做"不稳定" | 像输入延迟，不像角色特征 | 画不同稳定性等级的动画变体 |
| 用 tween 做攻击拖影 | 缺乏帧间姿态差异的速度感 | 攻击帧本身画出动态模糊线条 |
| 攻击前摇用代码延迟 | 感觉"卡"而非"蓄力" | 画 1 帧蓄力姿态（~16ms） |

### 变更影响审查规范

# 变更影响审查规范

> 来源：notes/lessons/refactor-introduces-regression.md | 晋升时间：2026-03-30

## 触发条件

当进行以下操作时：
- 重构代码结构
- 修改共享状态或接口
- 修改跨模块依赖的功能
- 用户说"调整/修改/重构"

## 核心原则

**修改前预判影响，修改后回归验证**

| 现象 | 根因 | 解决方案 |
|------|------|---------|
| "修改 X 后 Y 坏了" | 修改范围超出预期 | 修改前列影响范围 |
| 只验证新功能，未检查已有功能 | 缺乏回归验证 | 修改后主动回归测试 |
| 跨模块副作用 | 接口/状态依赖未追踪 | 影响范围清单 |

## 执行规范

## 变更影响分析

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 只测试新功能 | 测试新功能 + 回归测试 |
| 等 bug 报告 | 修改后主动验证相关功能 |
| 跳过影响分析 | 修改前列出影响范围 |

### 改动边界守卫规范

# 改动边界守卫规范

> 来源：`notes/research/2026-04-01-change-scope-guard.md` | 晋升时间：2026-04-01

## 触发条件

当任务满足以下任一条件时，必须启用本规范：

- 修改现有文件或现有规则
- 需求只要求修一个点，但代码邻近区域存在其他问题
- 执行过程中产生“顺手一起改掉”的冲动
- 需要提交多文件改动，但用户没有明确要求重构/清理/批量修复

## 核心原则

**先锁定边界，再动手；无关问题只记录，不顺手修。**

| 原则 | 含义 |
|------|------|
| **Scope Lock** | 开工前先明确本次允许改什么、明确不改什么 |
| **Incidental Findings Stay Out** | 执行中发现无关问题，默认只记录，不直接修 |
| **Expansion Requires Justification** | 只有 blocker、同一根因链路或用户明确授权，才能扩范围 |
| **Diff Audit Before Finish** | 完成前检查自己引入的 diff，删掉无关改动 |

## 执行流程

## 改动边界

- 目标：...
- 允许修改：fileA, fileB
- 明确不改：重构、样式顺手调整、无关 lint、历史 TODO
- 扩范围条件：仅当当前方案被 blocker 卡住，或用户明确批准
```

不要求每次都单独发给用户，但 agent 自己必须先收敛这个边界，避免一边写一边漂移。

## 决策框架

| 情况 | 是否允许纳入本次变更 | 处理方式 |
|------|----------------------|---------|
| 为完成当前任务必须修改的文件/逻辑 | 允许 | 直接纳入 |
| 同一根因导致的关联修复 | 有条件允许 | 记录理由后纳入 |
| 无关 lint / TODO / 命名清理 | 不允许 | 记录，不修改 |
| 顺手重构、顺手美化、顺手统一风格 | 不允许 | 拆为后续独立任务 |
| 工具或格式化器被动改出的噪音 diff | 不允许保留 | 清理后再交付 |

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/pattern/requirements-confirmation.md` | 负责确认“做什么”；本规范负责控制“只做这些” |
| `rules/pattern/change-impact-review.md` | 负责防回归；本规范负责防无关扩散 |
| `CLAUDE.md` / `AGENTS.md` 中的“最小影响” | 本规范是其可执行展开 |

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 修 A 时顺手把 B 的 TODO 一起改了 | 只修 A，B 记录为附带发现 |
| 用户只要 bug fix，却顺便做了结构重构 | 先完成 bug fix，重构另开任务 |
| 看到附近有 lint / 命名问题就一起清理 | 除非它阻塞当前修改，否则不要混入 |
| 改完不审 diff，直接交付 | 收尾前检查并删除无关改动 |

### Code-as-Interface Pattern

# Code-as-Interface Pattern

> 来源：[Sawyer Hood @sawyerhood](https://x.com/sawyerhood/status/2036842374933180660) | 吸收时间：2026-03-26

## 触发条件

当设计 Agent 与外部系统交互的接口时：
- 需要控制复杂系统（浏览器、文件系统、API）
- 追求更少的交互轮次和更低的成本
- 需要可组合、可复用的操作

## 核心原则

**代码生成 > 工具调用**

让 Agent 生成可执行的代码脚本，比调用离散的工具函数更高效。

## 执行规范

## 基准数据

| 方法 | 时间 | 成本 | Turns | 成功率 |
|------|------|------|-------|--------|
| Dev Browser (代码) | 3m 53s | $0.88 | 29 | 100% |
| Playwright MCP (工具) | 4m 31s | $1.45 | 51 | 100% |
| Playwright Skill | 8m 07s | $1.45 | 38 | 67% |
| Chrome Extension | 12m 54s | $2.81 | 80 | 100% |

**关键发现**：代码生成比工具调用减少 **44% turns**，降低 **39% 成本**

## 实践示例

### 跨层功能预检规范

# 跨层功能预检规范

> 来源：notes/lessons/cross-layer-iterative-fix-antipattern.md | 晋升时间：2026-03-30

## 触发条件

当开发涉及跨层功能时：
- Master→Worker→Python 调用链
- Rust↔Python 跨语言交互
- Proxy↔Upstream 代理转发
- 任何跨进程/跨语言的数据传递

## 核心原则

**一次做对，避免"修一个发现下一个"的循环**

| 现象 | 根因 | 解决方案 |
|------|------|---------|
| 单个功能需要 3-5 个 commit 才收敛 | 只看当前层，忽略跨层副作用 | 全链路预审 |
| 问题部署后才逐个暴露 | 缺乏分层测试 | preflight check |
| 性能诊断循环过长 | 一次只看一层 | 完整 profiling |

## 执行规范

## 边界校验清单

- [ ] Rust→Python：字符串编码（UTF-8）、数值精度、None/null 映射
- [ ] Proxy 透传：status code + headers + body 全保留
- [ ] Master→Worker：配置值序列化/反序列化一致性
- [ ] Python 子进程：logger 配置、环境变量继承

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 修一层跑一次看下一层问题 | 开发前画数据流图，标注所有边界 |
| 假设层间传递无损 | 每个边界都显式校验类型和编码 |
| 性能问题逐层诊断 | 完整 profiling 后一次性修复 |

### 连续执行规范

# 连续执行规范

> 来源：用户关于“完成一步后再次发问是否继续”的纠正 | 吸收时间：2026-03-31

## 核心问题

Agent 在用户已经给出明确目标和方向后，仍把同一路径上的自然后续步骤拆成多轮请示，导致：

1. 工作流被无意义打断
2. 用户需要重复下达“继续”指令
3. 执行节奏退化成“做一步问一步”

## 核心原则

**已获方向后，默认连续执行；只有真正的不确定性才再次发问。**

## 触发条件

当满足以下条件时，必须按连续执行处理：

- 用户已经明确总体目标或接受了当前执行方向
- 后续步骤属于同一条实现路径上的自然延续
- 不需要新的高影响决策即可继续推进

## 执行规则

## 与现有规则关系

| 规则 | 关系 |
|------|------|
| [[requirements-confirmation]] | 解决“执行前如何确认”；本规范解决“确认后如何持续推进” |
| [[living-spec]] | 规格更新后若方向未变，应继续执行而非再次请示 |
| [[task-centric-workflow]] | status 可记录 next step，但不代表必须暂停等待 |

## 配合方式

推荐顺序：

1. 先用 `requirements-confirmation` 解决方向与边界
2. 一旦用户确认方向，立即切换到本规范，连续执行到闭环
3. 只有出现 blocker / 高影响分叉 / 目标变化时，才回到确认流程

这两条规则应视为一前一后配合，而不是重复触发的双重请示。


## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 完成一步就问“要不要继续” | 判断是否存在自然后续步骤，若有则直接继续 |
| 把阶段完成当成新的决策点 | 先判断是否只是同一路径上的连续推进 |
| 没有 blocker 也停下来请示 | 无 blocker 时默认执行到闭环 |
| 用户已说“继续”后仍频繁再次确认 | 将“继续”视为对当前执行路径的持续授权 |

### Generator-Evaluator 模式规范

# Generator-Evaluator 模式规范

> 来源：[Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 触发条件

当任务满足以下任一条件时，**必须**使用 Generator-Evaluator 分离：

| 条件 | 示例 |
|------|------|
| 输出质量需主观判断 | 前端设计、文案创作、架构设计 |
| 任务复杂度超单次上下文 | 全栈应用、多模块系统 |
| 自我评估不可靠 | Agent 倾向"自信表扬"自己工作 |
| 需要"品味"的创造性工作 | 非模板化输出、需原创性 |

## 执行规范

## 决策框架

```
有客观测试？
    ├─ 是 → 测试通过？→ 完成/修复
    └─ 否 → 需要品味判断？→ 是：需要 Evaluator / 否：Solo
```

## 评估标准模板

```markdown
## [维度名称] (权重: 高/中/低)

## Sprint Contract 模板

```markdown
## Sprint [N]: [功能名称]

### Living Spec Pattern

# Living Spec Pattern

> 来源：[Augment Code - What spec-driven development gets wrong](https://x.com/augmentcode/status/2025993446633492725)
> 吸收时间：2026-03-26

## 核心洞察

**文档需要持续维护，而人类不擅长持续维护。**

Spec-Driven Development 的根本缺陷：spec 是静态文档，会过时。过时的 spec 会误导 agent 自信地执行错误计划。

**解决方案**：让 spec 成为人类与 agent 双向读写的"活文档"。

## 触发条件

当使用 spec/specification 流程时，评估是否需要 Living Spec：

| 场景 | 推荐模式 |
|------|----------|
| 需求明确、边界清晰 | 传统 spec（一次性规划） |
| 需求模糊、需要探索 | **Living Spec（双向同步）** |
| 快速迭代、实验性开发 | 可能不需要 spec |

## 执行规范

## 人类 Intent（原始需求）
[人类描述的需求]

## Agent 发现（执行中更新）
## 当前状态
- 反映实际构建的内容，而非最初计划
```

## 决策框架

```
使用 spec 流程？
    │
    ├─ 否 → 直接编码
    │
    └─ 是 → 需求明确？
            │
            ├─ 是 → 传统 spec
            │       └─ 一次性规划，agent 执行
            │
            └─ 否 → Living Spec
                    └─ 建立双向写入机制
                    └─ Agent 发现偏差时更新 spec
```

## 与 Trellis 等现有流程的整合

**短期改进**（现有流程）：

在 `status.md` 中增加 **"发现与偏差"** 字段：

```markdown
# status.md

## 进度
- [x] 已完成
- [ ] 进行中

## 发现与偏差（Agent 写入）
- 发现 API 不支持分页，改用 cursor-based pagination
- 发现现有 ThemeContext，复用而非新建
```

**中长期**：

1. Spec 格式支持 agent 写入
2. 区分"人类 intent"与"agent 发现的现实"
3. 建立自动化的偏差报告机制

## 根本原则

> **If agents can write code, they can update the plan. Let them.**

如果 agent 能写代码，它们就能更新计划。让它们做。

### 需求确认规范

# 需求确认规范

> 来源：`notes/lessons/implementation-vs-user-intent-mismatch.md` + Superpowers/brainstorming 启发 | 吸收时间：2026-03-31

## 核心问题

模型在未完全理解需求时就开始工作，导致：
1. 代码冗余（写了不相关的代码，未清理）
2. Token/时间浪费（用户需重复纠正）

## 核心原则

**确认优于假设，一次性问完**

| 原则 | 含义 |
|------|------|
| **Hard Gate** | Complex 级别禁止未经批准的实现 |
| **批量提问** | 所有问题一次性列出，不反复打断 |
| **分级处理** | 不同复杂度用不同确认强度 |
| **预设选项** | 多选格式，减少用户输入 |

## 触发条件

当任务满足以下任一条件时，执行确认流程：

- 需求存在多种合理理解
- 用户明确区分“参考 vs 复用”“调整 vs 新建”等边界
- 任务达到 Moderate 或 Complex 复杂度

## 复杂度分级

| 级别 | 标准 | 确认流程 |
|------|------|---------|
| **Trivial** | 单行修复、错别字、明确的小调整 | 直接执行，无需确认 |
| **Simple** | 目标明确，1-2 文件，无歧义 | 直接执行；如存在轻微歧义，可问 1 个确认问题 |
| **Moderate** | 多文件，或存在 1-2 个歧义点 | 需求复述 + ≤ 3 个问题 |
| **Complex** | 目标模糊，架构选择，≥ 3 个歧义点 | 完整确认流程（见下） |

## 执行流程

## 我理解的需求

**目标**：[一句话描述]

**范围**：
- 包含：...
- 排除：...

**关键假设**：
1. [假设1]
2. [假设2]

**待确认**（请一次性回答）：
1. [Blocking 问题，必答]
2. [Blocking 问题，必答]
3. [Preference 问题，可选]
```

**一次性提问规则**：
- 所有问题在**一个消息**中列出
- 问题数量 **≤ 5 个**
- 超过 5 个问题 → 需求本身太模糊，建议先拆分
- Blocking 问题和 Preference 问题分开标注

## 实现方案

**推荐方案**：[方案名]
- 理由：...
- 代价：...

**备选方案**：
- 方案 B：...（优缺点）
- 方案 C：...（优缺点）
```

## 与现有规则整合

| 现有规则 | 整合方式 |
|---------|---------|
| [[living-spec]] | 当任务需要长期规格维护时协同使用 |
| [[brainstorm]] | 当任务进入方案探索或架构选择时协同使用 |
| [[task-centric-workflow]] | 确认后创建 task 目录 |
| [[execution-continuity]] | 一旦方向确认，后续自然步骤应连续执行，不要重新碎片化请示 |
| [[implementation-vs-user-intent-mismatch]] | 本规范是该 lesson 的解决方案 |

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 问一个问题 → 等回答 → 又问一个 | 一次性列出所有问题 |
| "我理解了"就开始写代码 | 必须输出需求复述 + 等待确认 |
| 假设用户说"调整"就是"修改现有" | 区分"参考"与"复用"、"调整"与"新建" |
| "这个很简单，不需要确认" | Simple 级别可选确认，Moderate+ 必须确认 |
| 沉默就继续执行 | Complex 级别必须等待明确批准 |

### Agent 自验证机制

# Agent 自验证机制

> **来源**: harness 设计哲学 + long-running-agent-techniques
> **吸收时间**: 2026-03-31

## 核心洞察

**Harness 的 loop 设计哲学**：Agent 在完成实现后应自动进行验证，验证失败时自动迭代修复，直到所有功能通过验证或达到迭代上限。

## 问题诊断

| 稡式 | 表现 |
|------|------|
| **过早宣布完成** | 看到一些进展就认为任务完成，忽略未实现功能 |
| **无验证循环** | 实现后没有自动验证，需要用户手动调用 reviewer |
| **无限迭代** | 验证失败后无限制重试，浪费 token |

## 解决方案

### 架构

```
Stop Event Pipeline:
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ralph-loop ──► verification-gate ──► lesson-gate ──► exit   │
│      │               │                    │                 │
│      ▼               ▼                    ▼                 │
│  [loop active?]  [pending          [unhandled              │
│      │           features?]            signals?]            │
│      ▼               ▼                    ▼                 │
│  block + loop    block +            block +                 │
│  same prompt     trigger reviewer   write lesson            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Feature List Schema

```json
{
  "task_id": "auth-implementation",
  "created_at": "2026-03-31T10:00:00Z",
  "session_id": "<current_session>",
  "status": "in_progress",
  "features": [
    {
      "id": "F001",
      "category": "functional",
      "description": "User can login with email and password",
      "acceptance_criteria": [
        "Navigate to /login page",
        "Fill email field",
        "Fill password field",
        "Click submit",
        "Verify redirect to dashboard"
      ],
      "verification_method": "e2e",
      "passes": null,
      "verified_at": null,
      "attempt_count": 0,

*(truncated due to size limit)*
