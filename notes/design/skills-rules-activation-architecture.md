# skills / rules 激活式架构方案

- Status: proposed
- Date: 2026-03-27
- Related ADR: `notes/adrs/0001-activation-oriented-context-architecture.md`

## 目标

将当前仓库从“按知识类型归档”调整为“按激活边界加载”。

目标状态：

- 全局内核保持精简
- 项目类型规范通过 profile 组合加载
- 文件相关规范通过 `paths` 条件注入
- 低频、长流程内容归入 skills
- 解释性、研究性材料归入 notes

这份文档关注的是**如何把方案真正落成结构**，而不是停留在原则表述。

## 现状证据

### 当前仓库状态

- `CLAUDE.md` 仅 93 行，入口本身已经比较克制，主要问题不在入口，而在下层知识组织。
- `rules/` 当前有 19 个文件，按 `pattern / technique / tool / knowledge` 分类。
- `skills/` 当前有 12 个 skill，部分已经很长，说明它们更适合被视为按需加载的完整工作流，而不是轻量提示。
- 本地 `.trellis/spec/` 已按 `frontend/`、`backend/`、`guides/` 分目录，说明 Trellis 的组织方向本身就是按领域分层，而不是统一热加载。

### 外部演进方向

- Claude Code 官方支持通过 `@imports` 组合 `CLAUDE.md`，适合做 profile 风格的入口组合。
- Claude Code 官方支持 `.claude/rules/` 中使用 `paths` frontmatter，把规则限制在匹配文件范围内加载。
- Claude Code 官方明确建议：不需要常驻上下文的复杂指令，应放到 skills 中按需加载。
- Trellis 的文档强调将“relevant specs”注入当前上下文，而不是把所有 spec 全部打热。
- Trellis v0.3.1 已修正 init/update 行为，使 frontend/backend spec 的创建与注入遵循 `projectType`，这说明“按项目类型裁剪”是其正在强化的方向。

## 非目标

- 不在一个步骤里重写全部规则与 skills。
- 不在迁移模型未验证前就删除旧知识。
- 不试图立刻把所有 skill 都优化到最终形态。

## 设计原则

1. **按适用边界加载，而不是按存储方便归档。**
2. **默认路径必须收窄。**
3. **背景解释不进入常驻运行时指令。**
4. **能通过 `paths` 限定的，不提升为全局规则。**
5. **长流程、工具化、低频内容优先成为 skill。**

## 目标结构

```text
~/.claude/
├── CLAUDE.md
├── profiles/
│   ├── frontend.md
│   ├── backend.md
│   ├── ml.md
│   ├── docs.md
│   └── agentic-research.md
├── rules/
│   ├── core/
│   ├── domain/
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── ml/
│   │   ├── docs/
│   │   └── shared/
│   ├── scoped/
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── tests/
│   │   └── docs/
│   └── archive/
├── skills/
├── commands/
├── notes/
│   ├── research/
│   ├── design/
│   ├── lessons/
│   └── adrs/
└── memory/
```

## 各层语义

### 1. `CLAUDE.md`

只保留运行内核：

- 设计哲学
- Plan / Execute / Verify / Learn
- 极少数全局行为约束
- 少量稳定的共享导入

禁止继续把项目域规范、工具长教程、研究摘要直接塞进 `CLAUDE.md`。

### 2. `profiles/`

`profiles/` 是组合层，不承担知识细节本身，只负责导入。

示例：

```md
# frontend profile
@~/.claude/rules/core/workflow.md
@~/.claude/rules/core/verification.md
@~/.claude/rules/domain/frontend/index.md
@~/.claude/rules/domain/shared/typescript.md
```

使用方式：

- 具体项目的 `.claude/CLAUDE.md` 通常只导入一个主 profile
- 混合项目可以显式导入多个 profile
- 用户级 `~/.claude/CLAUDE.md` 保持中立，不默认假设项目类型

### 3. `rules/core/`

放真正接近“总是成立”的规则，例如：

- context injection
- proactive delegation
- verification discipline
- instruction-writing conventions

硬约束：如果一个纯前端或纯后端项目可以合理忽略它，它就不应该进入 `core`。

### 4. `rules/domain/`

放某类项目的通用规范，但不一定需要 `paths`。

例如：

- React 架构约束
- backend 错误处理约定
- ML 训练前置检查
- 文档写作与交付规范

这些规范通过 profile 激活，而不是用户级全局常驻。

### 5. `rules/scoped/`

放带 `paths:` frontmatter 的条件规则。

示例：

- `**/*.{ts,tsx}`
- `src/api/**/*.ts`
- `**/*.{test,spec}.{ts,tsx,js,jsx,py}`
- `**/*.md`

这是避免无关规范进入上下文的关键手段。

### 6. `skills/`

放低频、长流程、程序化内容。

一个内容满足以下任一条件，就应优先考虑成为 skill：

- 有 8 步以上明确动作或长决策树
- 强依赖某个工具的安装、配置、排错
- 使用频率低
- 需要大量示例、参考资料或脚本
- 适合由用户显式触发

### 7. `notes/`

放支持决策但不应常驻的内容：

- `research/`：对比、调研、生态变化
- `design/`：迁移方案、结构设计、分阶段计划
- `lessons/`：反复出现的问题与教训，带 freshness 管理
- `adrs/`：稳定的架构决策

## 分类决策顺序

新增或迁移内容时，按以下顺序判断：

1. 如果几乎所有编码场景都适用，放进 `rules/core/`。
2. 否则，如果它属于某个项目类型，放进 `rules/domain/<profile>/`，并由 `profiles/<profile>.md` 导入。
3. 否则，如果适用范围可由文件路径判断，放进 `rules/scoped/` 并加 `paths:`。
4. 否则，如果它是长流程、工具导向或低频任务，放进 `skills/`。
5. 否则，如果它偏解释、背景、尚未稳定，放进 `notes/`。

## 迁移矩阵

### 保留或重构为 `rules/core/`

- `rules/core/context-injection.md`
- `rules/core/task-centric-workflow.md`
- `rules/core/proactive-delegation.md`
- `rules/core/llm-friendly-format.md`

预期动作：

- 保留原则
- 压缩措辞
- 移除不属于全局层的示例与主题细节

### 迁入 `rules/domain/`

- `rules/domain/shared/testable-architecture.md`
- `rules/domain/ml/ml-training-preflight-checks.md`
- `rules/domain/native/rust-egui-testing.md`

### 转为 `skills/`

- `rules/tool/agent-browser.md`
- `rules/technique/browser-auth-reuse.md`
- `rules/tool/feishu-lark-mcp.md`

原因：

- 低频
- 强工具/流程导向
- 对绝大多数仓库不应作为默认热规则存在

### 迁入 `notes/research/`

- `notes/research/ai-search-integration.md`
- `notes/research/browser-agent-architecture.md`
- `notes/research/privacy-proxy-architecture.md`
- `rules/pattern/living-spec.md` 中偏解释性的长段落

原因：

- 更像研究摘要，而不是直接执行规范
- 可以保留一个短的 distilled rule，但长解释不应伪装成热规则

## `commands/` 策略

`AGENTS.md` 要求顶层 skill 有匹配的 `commands/<name>.md` wrapper，但当前仓库还没有 `commands/`。

决策：

- 创建 `commands/`
- 只为用户可见、顶层的 skill 创建 wrapper
- wrapper 保持很薄，只承担显式入口作用

这不是第一阶段唯一重点，但在宣告结构改造完成前必须补齐。

## 分阶段落地计划

### Phase 0：治理

- 接受 ADR 与本设计文档
- 停止继续把新文件塞进旧 taxonomy 且不声明激活边界
- 新增内容必须声明归属：`core` / `profile` / `paths` / `skill` / `notes`

### Phase 1：骨架

- 创建 `profiles/`
- 创建 `rules/core/`、`rules/domain/`、`rules/scoped/`、`rules/archive/`
- 创建 `commands/`
- 暂时保留旧文件不动

### Phase 2：高信号迁移

- 先把 ML、browser automation、Feishu 这类明显不该常驻的内容迁出默认热规则层
- 创建第一批 profile：`frontend.md`、`backend.md`
- 将研究型长文迁入 `notes/research/`

### Phase 3：路径限定

- 识别可以通过文件 glob 限定的规则
- 为其补上 `paths:` frontmatter
- 重新验证哪些无条件规则仍然真的属于全局层

### Phase 4：skill 卫生

- 将长 skill 拆为 `SKILL.md + references/ + scripts/`
- 把长解释和示例迁出主 skill body
- 补齐 command wrapper

### Phase 5：清理

- 通过 archive stub 或迁移说明退役旧 taxonomy 路径
- 更新 README 与维护者指南
- 删除已确认废弃的重复文件

## 验收标准

满足以下条件时，认为迁移成功：

- 一个纯前端项目可以只加载 frontend profile，而不会默认带上 backend 或 ML 规范
- 至少存在一个可用的 frontend profile 和一个可用的 backend profile
- 剩余无条件规则都能为“为什么必须全局加载”给出充分理由
- 至少 3 个低频工具类规则被迁成 skill 或移出默认热路径
- 至少 3 条 path-scoped rule 已落地，并使用有意义的 glob
- 研究型长文不再伪装成 always-on rules
- `commands/` 已为维护中的顶层 user-facing skills 建立 wrapper

## 验证计划

1. 创建一个最小项目 `.claude/CLAUDE.md`，只导入 `@~/.claude/profiles/frontend.md`。
2. 在 Claude Code 中检查启动后实际加载内容。
3. 打开前端文件，确认只注入匹配的 scoped rules。
4. 对 backend profile 重复一次。
5. 确认 Feishu、browser automation 等 skill 不再出现在默认启动上下文中。

## 开放问题

- `native/` 现在是否值得成为一等 profile，还是先作为可选 domain？
- 当前某些 `pattern` 文件应进入 `shared/` 还是 `core`？
- 后续是否需要机器可读 manifest，还是先用 import 组合即可？

## 立即下一步

先完成骨架和第一批高信号迁移，不做一次性大重写。
