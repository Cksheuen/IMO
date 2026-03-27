# 调研：hooks 与 notes 的设计收敛

- Date: 2026-03-27
- Trigger: 用户要求基于现有仓库完善 `hooks/` 与 `notes/` 设计

## 理解的目标

在不偏离现有仓库语义的前提下，补齐 `hooks/` 与 `notes/` 为什么存在、应放什么、如何与 `rules/` / `memory/` 分工。

## 设计锚点

优先级最高的语义锚点来自 `.gitignore` 注释：

- `hooks/`：自定义 hooks（事件钩子脚本）
- `notes/`：知识沉淀（经验教训、笔记）

这意味着：

- `hooks/` 的核心不是“共享自动化层”这种二级抽象，而是更直接的“事件钩子脚本”
- `notes/` 的核心不是只放 ADR 或 research，而是更宽泛的知识沉淀

## Repo 调研记录

- 根目录 `.gitignore` 已将 `hooks/` 与 `notes/` 列入白名单，并写明了目录语义
- 根目录此前没有 `hooks/`、`notes/` 的正式说明，因此目录长期空置
- 仓库内存在 `.claude/settings.json` 与 `.claude/hooks/*.py`，说明“项目级 hooks 实践”已经存在，但它服务的是“开发当前仓库”这个项目，而不是根目录配置仓库本身
- 现有 `README.md`、`CLAUDE.md`、`AGENTS.md` 在本次改动前都没有给出 `hooks/` / `notes/` 的设计说明

## 官方文档调研

Claude Code 官方文档确认：

- hooks 通过 `settings.json` 配置，而不是仅靠脚本目录自动发现
- hook 事件包括 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`Notification`、`SubagentStop` 等
- `SessionStart` 适合注入动态上下文；如果是静态上下文，官方建议放 `CLAUDE.md`
- `~/.claude/settings.json` 是用户级设置；`.claude/settings.json` 是项目级、可提交到版本控制的设置

这些结论决定了目录分工：

- `hooks/` 存的是脚本资产
- `settings.json` / `.claude/settings.json` 决定这些脚本是否被实际挂载
- `CLAUDE.md` 负责静态长期指令，不应被 hook 替代

## 收敛后的设计

### hooks/

定义：事件钩子脚本目录。

放入条件：

- 由 Claude Code hook 事件触发
- 适合脚本化自动执行
- 与具体 hook 行为强相关

不放入：

- 经验笔记
- 非事件驱动工具
- 临时调试产物

### notes/

定义：知识沉淀目录。

放入条件：

- 值得保留的经验教训
- 调研、设计思考、迁移方案
- 暂未稳定到足以进入 `rules/` / `skills/` 的知识

不放入：

- 强约束规则
- 完整技能定义
- 代码索引

## 最重要的修正

上一版设计把 `notes/` 收窄成了“ADR / research 层”，这是不对的。

正确做法是：

- 先承认 `.gitignore` 已经把 `notes/` 定义为“知识沉淀（经验教训、笔记）”
- 再在这个更宽的定义下补充推荐子目录，而不是反过来用子目录去重写一级语义

## 建议

- `hooks/` 保持窄职责，只承担事件钩子脚本
- `notes/` 保持宽职责，允许经验、教训、笔记、调研并存
- 以后新增目录说明时，先读 `.gitignore` 注释，再做细化设计
