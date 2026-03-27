# Lesson: notes 设计必须同时定义读取循环与写回循环

- Status: active
- First Seen: 2026-03-27
- Last Verified: 2026-03-27
- Trigger: 用户指出 `notes/` 只有存储语义，没有真正接入工作流

## 现象

已经给 `notes/` 定义了子目录、生命周期和沉淀规则，但它依然像静态资料区，而不是会参与决策的知识层。

## 根因

此前只设计了“写到哪里”，没有完整设计：

- 什么场景必须读取 `notes/`
- 读哪个子目录
- 读完后如何更新、提炼或忽略

结果是：

- `notes/` 很容易只增不读
- lessons/research/design 会混用
- 用户指出问题时，agent 不会自然想到先查或更新 `notes/lessons/`

## 正确做法

设计 `notes/` 时，至少同时补齐四条循环：

1. `Correction Loop`
2. `Research Loop`
3. `Design Loop`
4. `Recovery Loop`

并对每条循环明确：

- 读取触发条件
- 优先读取哪个子目录
- 写回到哪里
- 何时晋升为 `rules/` / `skills/` / `memory/`

## Decision

- 被纠正、被质疑、被要求复盘时：先读 `notes/lessons/`
- 做调研与技术选型时：先读 `notes/research/`，必要时补读 `notes/lessons/`
- 做结构与调用链设计时：先读 `notes/design/`，必要时补读 `notes/lessons/`
- 执行失败或反复返工时：回读 `notes/lessons/`

## Source Cases

- 2026-03-27：用户指出当前设计虽然定义了 `notes/` 的存储方式，但没有定义真正可执行的使用循环

## Promotion Criteria

- 如果这套读取/写回协议在多个工作流中稳定复用，提炼到 `CLAUDE.md` 或独立 skill/rule
