# Notes Activation Loop

- Status: historical-background
- Date: 2026-03-27
- Trigger: 当时需要回答 `notes/` 何时被读、何时被写，而不只是定义“放什么”

## 当前事实源

这份文档保留的是早期设计思路；当前规范入口以以下文件为准：

- [`rules/pattern/closed-learning-loop.md`](../../rules/pattern/closed-learning-loop.md)
- [`rules/pattern/task-notes-boundary.md`](../../rules/pattern/task-notes-boundary.md)
- [`notes/README.md`](../README.md)

## 这份设计稿留下来的核心洞察

它最重要的贡献不是“四条循环”本身，而是两条后来被保留下来的原则：

- `notes/` 必须按需读取，不能默认全量注入
- `notes/` 的写入触发要和工作流事件绑定，否则它只会变成静态资料堆

## 仍然有参考价值的早期分层

这份文档用四类高频场景来解释 `notes/` 的使用边界：

- correction 更靠近 `notes/lessons/`
- research 更靠近 `notes/research/`
- design 更靠近 `notes/design/`
- recovery 会回到 lessons/rules 等更强约束层

这套表述今天仍可作为背景理解，但“哪些事件必须触发、读取顺序如何定义、哪些层已经是 runtime contract”已经被后续规则吸收，不应继续以这份 note 为准。

## hooks 与 notes 的背景关系

当时这份设计稿强调了一条重要边界：`hooks/` 负责事件自动化，`notes/` 负责知识沉淀；hook 不应变成大段 note 原文的自动注入器。

这条边界后来已被更完整的 learning-loop 规则覆盖，因此这里仅作为设计来历保留。

## 为什么还保留这份文档

如果问题是“现在 notes 层应该怎么定义”，请看规则。

如果问题是“为什么后来会强调按需读取 notes、为什么要把 lessons/research/design 分开”，这份设计稿仍然能提供历史上下文。
