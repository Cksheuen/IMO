# hooks / notes 调用链设计

- Status: historical-background
- Date: 2026-03-27

## 当前事实源

这份文档只保留早期设计背景；当前入口以这些文件为准：

- [`hooks/README.md`](../../hooks/README.md)
- [`notes/README.md`](../README.md)
- [`rules/core/task-notes-boundary.md`](../../rules/core/task-notes-boundary.md)

## 这份设计稿留下来的核心判断

它解决的不是“目录要不要存在”，而是“目录是否真的接入了调用链”。

后来保留下来的判断有两条：

- 只有目录名，没有写入/读取入口，不算设计完成
- `hooks/` 与 `notes/` 都需要明确各自的维护者、触发点和消费方

## 仍然有价值的背景结论

- hook 的存在不等于 hook 已接通；必须能说清挂载位置、事件、脚本与验证方式
- notes 的存在不等于 notes 在工作流里可用；必须能说清何时写、谁来读、如何晋升

## 为什么还保留这份文档

它保存的是“语义定义 + 调用链”这套思路最初是怎么被提出的。

如果要看今天的真实协议，请直接看当前事实源；如果要追溯为什么后来会强调“目录必须接入调用链”，这份背景稿仍然有用。
