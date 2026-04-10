# Claude Code 配置仓库

> 一个持续进化的 AI 助手配置系统，通过规范、技能和记忆管理实现能力的增量积累。

## 核心理念

**简洁优先 | 根因导向 | 最小影响**

这个仓库不是静态配置，而是一个**会学习的系统**：
- 每次纠正都会沉淀为规范
- 每次学习都会转化为能力
- 每次索引都是未来快速定位的路标

## 安装方式

### 用户级安装（推荐）

将配置放到 `~/.claude/` 目录，对所有项目生效：

```bash
# 克隆到用户配置目录
git clone https://github.com/your-repo/claude-config.git ~/.claude
```

### 项目级安装

将配置放到项目的 `.claude/` 目录，仅对当前项目生效：

```bash
# 在项目根目录
git clone https://github.com/your-repo/claude-config.git .claude
```

### 组合使用

项目级配置会覆盖用户级配置。常见做法：
- 用户级：放通用规则和技能
- 项目级：放项目特定的上下文和规则

## 如何使用

**直接问 AI**。这个仓库本身就是配置，AI 启动后会自动读取。

你可以这样问：
- "有哪些可用的技能？"
- "这个项目怎么用的？"
- "帮我看看 rules 目录里有什么规范"
- "检查哪些 notes 可以晋升成规则或技能"

AI 会根据当前上下文自动选择合适的技能和规范执行。

## 配置分层

为避免把办公环境、内网 registry、个人机器偏好误同步到所有环境，配置按两层管理：

- `settings.json`：共享基线。只放跨环境稳定、适合版本控制的公共配置。
- `settings.local.json`：本地覆盖。只放办公场景、内网 MCP、机器私有路径、个人偏好。
- `settings.local.example.json`：本地覆盖模板。用于展示推荐结构，不直接生效。
- `.mcp.example.json`：项目级 MCP 模板。用于展示“仅当前项目需要”的附加工具如何下沉。

推荐原则：

- 共享基线中不放依赖内网、租户、办公网络的 `mcpServers`
- 办公场景 MCP 优先放到本地覆盖层，或按项目放在项目级 `.claude/settings.local.json`
- 若某个 MCP 仅在少数项目使用，优先放项目级 `.mcp.json`，不要提升到用户级共享基线
- 示例文件可版本控制，真实本地文件不入库

当前仓库已按这个边界收敛：

- 根目录 `settings.json` 只保留共享 hooks、permissions 和稳定 marketplace
- `ttcodex-local` 一类本机路径 marketplace 不再放共享层
- `codemossProviderId` 一类个人 provider 标识只应放本地覆盖层

### 三层边界

- **共享层**：`settings.json`
  适合所有项目、所有环境都稳定成立的配置。
- **办公层**：`settings.local.json`
  适合当前机器、当前办公网络、当前租户的长期工具。
- **项目层**：`.mcp.json`
  只适合某个项目当前需要的附加 MCP，不应污染用户级配置。

### 办公场景建议放置位置

- 用户级长期办公工具：`~/.claude/settings.local.json`
- 项目特定办公工具：`<project>/.claude/settings.local.json` 或 `<project>/.mcp.json`

典型应放入本地覆盖层的内容：

- 内网 registry，如 `bnpm.byted.org`
- 办公环境专用 MCP，如 `semi-mcp`、`tiksearch`、`lark-docs`、`feishu`
- 带租户/端口/本地路径的环境变量
- 本机路径 marketplace，如 `ttcodex-local`
- 个人 provider 标识，如 `codemossProviderId`
- 临时授权过的高权限本地命令

### 推荐落地方式

1. 复制 `settings.local.example.json` 为本机 `settings.local.json`
2. 把机器私有配置填到本地覆盖层，如 `ttcodex-local` 和 `codemossProviderId`
3. 按实际办公环境删减不需要的 MCP
4. 优先固定版本，不使用 `@latest`
5. 对 Feishu 一类大工具面优先配置 `FEISHU_ENABLED_TOOLS`
6. 项目特定工具再下沉到项目级 `.mcp.json`
7. 参考 `.mcp.example.json` 为具体项目生成最小项目覆盖

### 运行时 Profile 审计

当前仓库有两套长期并存的 runtime profile：

- 共享 profile：根目录 `settings.json`
- 仓库开发态 profile：仓库内 `.claude/settings.json`

需要确认某条 hook、plugin 或 marketplace 配置属于哪一层时，运行：

```bash
python3 ~/.claude/hooks/runtime-profile-audit.py
```

这个工具只做对照，不修改任何配置。

## 架构设计

用户级与项目级目录分工如下：

- `~/.claude/notes`：全局共享知识沉淀
- `<project>/.claude/tasks`：当前项目自己的任务规格与状态
- 当前仓库本身就是放在 `~/.claude/` 的一个项目，因此仓库根下的 `tasks/` 只是这个仓库自己的项目级 tasks 目录

```
~/.claude/
├── CLAUDE.md              # 核心配置：工作流、原则、触发条件
├── hooks/                 # 自定义 hooks（事件钩子脚本）
├── notes/                 # 知识沉淀（经验教训、笔记）
├── skills/                # 可扩展技能模块
├── rules/                 # 执行规范（pattern/technique/tool/knowledge）
├── memory/                # 分层记忆系统（L1/L2/L3）
└── .cold-storage/         # 冷存储（上下文管理）

<project>/
└── .claude/
    └── tasks/             # 当前项目自己的任务目录
```

### 三层能力体系

| 层级 | 职责 | 特点 |
|------|------|------|
| **hooks/** | 事件钩子脚本 | 由 hooks 事件触发的脚本资产 |
| **tasks/** | 任务规格与状态 | 项目级目录，按 `YYYY-MM-DD-slug` 组织，便于扫描与恢复 |
| **notes/** | 知识沉淀 | 承接经验教训、笔记、调研与设计思考 |
| **skills/** | 完整工作流 | 用户可调用，有明确触发条件 |
| **rules/** | 执行规范 | 被 CLAUDE.md 或 skills 引用 |
| **memory/** | 知识索引 | 跨会话持久化 |

### hooks / notes 的定位

- `hooks/`：放自定义事件钩子脚本，配合 `settings.json` 或项目级 `.claude/settings.json` 使用。
- `notes/`：放经验教训、笔记、调研与设计思考，作为 `rules/` / `skills/` 之前的知识沉淀层，并按任务循环定向读取；它是用户级全局目录，位于 `~/.claude/notes/`。
- `tasks/`：是项目级目录，标准位置为 `<project>/.claude/tasks/`。
- `tasks/` 与 `notes/` 的边界：`tasks/` 记录当前任务事实，`notes/` 沉淀跨任务可复用知识；详见 `rules/core/task-notes-boundary.md`。
- 当前仓库位于 `~/.claude/`，所以仓库根下的 `tasks/` 只是这个仓库自身项目的 task 目录；它不代表其他项目共用同一个全局 task 池。
- 当前仓库内 `.claude/hooks/` 与 `.claude/settings.json` 用于开发当前仓库这个项目；根目录 `hooks/` 面向配置仓库自身的可同步资产。

### notes 的工作流循环

- `Correction Loop`：用户纠正、追问、质疑、复盘时，读取并更新 `notes/lessons/`
- `Research Loop`：技术选型、方案探索、brainstorm 时，读取并更新 `notes/research/`
- `Design Loop`：目录、调用链、迁移与结构设计时，读取并更新 `notes/design/`
- `Recovery Loop`：执行失败、返工、回滚时，回读并更新 `notes/lessons/`
- `Promotion Loop`：当 note 满足稳定条件时，被动评估是否晋升为 `rules/`、`skills/` 或 `memory/`

### hooks 与 notes 的关系

- `hooks/` 负责事件点自动动作或提醒
- `notes/` 负责事件后的知识沉淀、复盘与后续复用
- hook 可以提示“该检查哪类 note”，但不应自动注入整篇 note 内容

### 链路审计

- 根目录提供 `hooks/audit-runtime-links.py`，用于人工执行的静态审计：检查文档里声称已接通的运行链，是否真的在 `settings.json` 或 `.claude/settings.json` 中挂载
- 它是只读审计工具，不属于自动 hook，不会自行运行，也不应被当作需要挂载的运行时脚本
- 用途是防止“脚本已创建 / 设计已写出，但真实触发链路并未接通”再次被误写为已落地

### 为什么以前会空着

- `hooks/` 以前缺少正式设计说明，也缺少“需要在 settings 中挂载才会生效”的显式提醒。
- `notes/` 以前缺少“什么时候写入”的工作流触发条件，因此即使目录存在，也不会自然积累内容。
- 目录设计如果只有语义、没有调用链，最终仍然会是空目录。

### Runtime-heavy 目录

以下目录主要属于本地运行时资产，不应进入 git 白名单：

- `plugins/`：plugin cache、marketplace clone、本地 plugin data
- `projects/`：按项目路径聚合的本地 session / runtime 状态
- `file-history/`：本地历史快照
- `specs/`：工作流产出的规格资产

需要查看这些目录的体积与职责边界时，运行：

```bash
python3 ~/.claude/hooks/runtime-storage-audit.py
```

这个工具只做容量观测与建议输出，不删除、不移动任何目录内容。

## 核心工作流

**Plan → Execute → Verify → Learn**

| 阶段 | 要点 |
|------|------|
| **Plan** | 非平凡任务必须规划，拆成可验证的子任务 |
| **Execute** | 能委派就委派，无依赖就并发；已获方向后默认连续执行到闭环 |
| **Verify** | 未证明有效不标记完成 |
| **Learn** | 收到纠正后分析根因，写入规范 |

## 设计原则

1. **提取而非复制** - 不存储原文，提取可迁移的模式
2. **原子化** - 每个 rule 聚焦单一概念，便于组合
3. **可检索** - 命名清晰，便于触发和查找
4. **增量积累** - 新知识与现有规则建立关联
