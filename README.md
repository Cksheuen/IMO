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

## 架构设计

```
~/.claude/
├── CLAUDE.md              # 核心配置：工作流、原则、触发条件
├── hooks/                 # 自定义 hooks（事件钩子脚本）
├── notes/                 # 知识沉淀（经验教训、笔记）
├── skills/                # 可扩展技能模块
├── rules/                 # 执行规范（pattern/technique/tool/knowledge）
├── memory/                # 分层记忆系统（L1/L2/L3）
└── .cold-storage/         # 冷存储（上下文管理）
```

### 三层能力体系

| 层级 | 职责 | 特点 |
|------|------|------|
| **hooks/** | 事件钩子脚本 | 由 hooks 事件触发的脚本资产 |
| **notes/** | 知识沉淀 | 承接经验教训、笔记、调研与设计思考 |
| **skills/** | 完整工作流 | 用户可调用，有明确触发条件 |
| **rules/** | 执行规范 | 被 CLAUDE.md 或 skills 引用 |
| **memory/** | 知识索引 | 跨会话持久化 |

### hooks / notes 的定位

- `hooks/`：放自定义事件钩子脚本，配合 `settings.json` 或项目级 `.claude/settings.json` 使用。
- `notes/`：放经验教训、笔记、调研与设计思考，作为 `rules/` / `skills/` 之前的知识沉淀层，并按任务循环定向读取。
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

### 为什么以前会空着

- `hooks/` 以前缺少正式设计说明，也缺少“需要在 settings 中挂载才会生效”的显式提醒。
- `notes/` 以前缺少“什么时候写入”的工作流触发条件，因此即使目录存在，也不会自然积累内容。
- 目录设计如果只有语义、没有调用链，最终仍然会是空目录。

## 核心工作流

**Plan → Execute → Verify → Learn**

| 阶段 | 要点 |
|------|------|
| **Plan** | 非平凡任务必须规划，拆成可验证的子任务 |
| **Execute** | 能委派就委派，无依赖就并发 |
| **Verify** | 未证明有效不标记完成 |
| **Learn** | 收到纠正后分析根因，写入规范 |

## 设计原则

1. **提取而非复制** - 不存储原文，提取可迁移的模式
2. **原子化** - 每个 rule 聚焦单一概念，便于组合
3. **可检索** - 命名清晰，便于触发和查找
4. **增量积累** - 新知识与现有规则建立关联
