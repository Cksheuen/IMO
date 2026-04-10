# notes/

`notes/` 是知识沉淀层，不是当前运行时规范。

它回答的是“哪些结论值得保留，之后再决定是否晋升”，而不是“现在必须怎么执行”。现行边界与运行时约束，以以下文件为准：

- [`rules/core/task-notes-boundary.md`](../rules/core/task-notes-boundary.md)
- [`rules/pattern/closed-learning-loop.md`](../rules/pattern/closed-learning-loop.md)
- [`CLAUDE.md`](../CLAUDE.md)

## 放什么

- `notes/lessons/`：可复用教训、反模式、复盘结论
- `notes/research/`：调研记录、方案比较、外部资料收敛
- `notes/design/`：设计草案、迁移方案、结构背景
- `notes/adrs/`：已稳定的架构决策

## 不放什么

- 立即生效的强约束规则
- 完整工作流正文
- 代码索引或 recall 替代品
- 自动生成的运行时产物

## 最小边界

| 目录 | 作用 |
|------|------|
| `rules/` | 当前规范 |
| `skills/` | 可执行工作流 |
| `notes/` | 背景、结论、待晋升资产 |
| `memory/` | 稳定事实快照 |

## 使用原则

- 按需读取，不默认全量注入
- 先归并同主题 note，再决定是否新建
- lesson 优先按主题维护，不按日期堆流水账
- 设计稿可以保留背景，但不应继续充当“第二真相源”

## 简化生命周期

1. 先把高信号结论写进 `notes/`
2. 同主题持续归并，而不是重复开新文
3. 结论稳定后，交给 `Promotion Loop` 评估是否晋升
4. 若已晋升，note 保留背景与来源，不再重复维护规范正文

## 与 hooks 的关系

- `hooks/` 负责事件触发
- `notes/` 负责沉淀与复用
- hook 可以提醒是否需要写 note，但不应自动注入大段 note 原文

## 维护要求

- 优先保留高信号内容
- 一篇 note 尽量只服务一个主题
- 已被规则或技能吸收的内容，应收缩成背景说明或索引入口
