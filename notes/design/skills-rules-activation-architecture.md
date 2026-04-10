# skills / rules 激活式架构方案

- Status: historical-background
- Date: 2026-03-27
- Related ADR: [`notes/adrs/0001-activation-oriented-context-architecture.md`](../adrs/0001-activation-oriented-context-architecture.md)

## 当前事实源

这份文档保留的是早期结构设计背景；当前可执行入口应以这些文件为准：

- [`CLAUDE.md`](../../CLAUDE.md)
- [`commands/README.md`](../../commands/README.md)
- [`rules/core/context-injection.md`](../../rules/core/context-injection.md)

## 这份设计稿留下来的核心判断

它最重要的贡献不是当时列出的完整迁移计划，而是下面几条现在仍然成立的判断：

1. 按激活边界加载，比按存储方便归档更重要。
2. 背景解释不应长期伪装成 always-on 规则。
3. 长流程、低频、工具导向内容更适合进入 `skills/`。
4. 设计草案与迁移讨论应保留在 `notes/`，而不是直接挤进全局入口。

## 为什么这份文档被降级为背景稿

其中很多“目标结构”和“分阶段计划”已经过时，尤其包括：

- 对目录骨架的早期预测
- “当前仓库还没有 `commands/`” 这类已失效事实
- 对后续迁移批次的具体承诺

这些内容今天继续保留在主规范里只会制造第二真相源，因此不再作为执行依据。

## 仍然有价值的背景信息

- 为什么后来会强调“核心入口保持精简”
- 为什么 `rules/`、`skills/`、`notes/` 需要按不同激活边界分层
- 为什么解释性长文应该退出高频热路径

## 为什么还保留这份文档

如果问题是“现在应该按什么结构执行”，请看当前事实源。

如果问题是“为什么后来会推进激活式架构、并持续压缩默认热路径”，这份设计稿仍然能提供历史上下文。
