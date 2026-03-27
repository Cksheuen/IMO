# Notes Activation Loop

- Status: proposed
- Date: 2026-03-27
- Trigger: 用户指出 `notes/` 只有存储语义，没有真正接入工作流循环

## 问题

当前 `notes/` 已经有“放什么”的定义，但还缺少两件关键的运行时设计：

1. 什么场景必须读取 `notes/`
2. 什么场景必须把新信息写回 `notes/`

没有这两条，`notes/` 只会是静态资料区，而不是工作流中的知识层。

## 设计目标

- 让 `notes/` 在真正需要时被读取，而不是默认全量加载
- 让 `notes/` 在关键反馈点稳定积累，而不是只靠“顺手记一下”
- 区分 `notes/research`、`notes/design`、`notes/lessons` 的触发边界
- 明确与 `hooks/` 的关系：`hooks` 负责事件自动化，`notes` 负责事件后的知识沉淀与决策支持

## 核心原则

- 按循环读取，不按目录全量读取
- 优先读取最接近当前问题类型的子目录
- 用户反馈优先进入 `lessons`
- 外部调研优先进入 `research`
- 结构设计与迁移决策优先进入 `design`

## 四条主循环

### 1. Correction Loop

适用场景：

- 用户纠正 agent
- 用户追问暴露遗漏、误判、设计漏洞
- 代码评审中发现本可避免的问题

读取顺序：

1. `notes/lessons/`
2. 相关 `rules/` 或 `skills/`

写回动作：

- 若已有同主题 lesson：更新 `Last Verified`、`Source Cases`、`Decision`
- 若没有：创建新的主题 lesson
- 若教训已稳定：标记 `candidate-rule`

### 2. Research Loop

适用场景：

- 使用 `brainstorm`
- 做技术选型、方案比较、外部调研
- 用户要求“研究一下”“看看最佳实践”

读取顺序：

1. `notes/research/`
2. 相关 `notes/lessons/`
3. 已提炼的 `rules/` / `skills/`

写回动作：

- 将新的对比、证据、收敛过程写入 `notes/research/`
- 若调研中暴露重复错误模式，同步更新 `notes/lessons/`

### 3. Design Loop

适用场景：

- 设计目录结构、调用链、迁移计划
- 调整技能分层、规则边界、知识架构
- 讨论“什么时候加载、什么时候触发”

读取顺序：

1. `notes/design/`
2. 相关 `notes/lessons/`
3. 必要时参考 `notes/research/`

写回动作：

- 设计收敛过程写入 `notes/design/`
- 若某次设计暴露通用失误，额外更新 `notes/lessons/`

### 4. Recovery Loop

适用场景：

- 执行失败
- 多轮返工
- 回滚、重试、补救
- 同类问题再次出现

读取顺序：

1. `notes/lessons/`
2. 相关 `memory/` 或 `rules/`

写回动作：

- 记录新的根因与补救方式到同主题 lesson
- 若某补救流程已稳定，可提炼到 `rules/` 或 `skills/`

## 与 hooks 的关系

`hooks/` 不负责保存知识，只负责在事件点自动执行动作。

两者关系应是：

- `hooks/` 负责触发或提醒
- `notes/` 负责沉淀和复用

推荐连接方式：

- `SessionStart` hook 可提示当前仓库有哪些高优先级 design / lesson 需要关注，但不应把整个 `notes/` 注入上下文
- `Stop` / `SubagentStop` hook 可提醒检查本轮是否产生了新的 lesson / design / research
- 真正的 note 内容读取仍由工作流自己决定，避免 hook 变成大段上下文注入器

## 最小调用协议

### 读取触发

- 被纠正、被质疑、被要求复盘 → 读 `notes/lessons/`
- 做调研、技术选型、方案比较 → 读 `notes/research/`
- 做目录/架构/调用链设计 → 读 `notes/design/`
- 执行失败或反复返工 → 回读 `notes/lessons/`

### 写入触发

- 用户纠正或追问暴露问题 → 写 `notes/lessons/`
- 完成一次外部调研或方案收敛 → 写 `notes/research/`
- 完成结构设计或迁移方案 → 写 `notes/design/`
- 同类教训再次出现 → 更新已有 lesson，不新建流水账

## 反模式

- 把 `notes/` 当作默认全量知识库
- 只设计写入触发，不设计读取触发
- 让 hook 自动注入大量 note 原文
- 用户已经指出漏洞，却不更新 `notes/lessons/`

## 结论

`notes/` 真正的价值不在于“有地方存”，而在于它被嵌入到几个高频循环里：

- 纠错循环
- 调研循环
- 设计循环
- 恢复循环

只有这样，它才是一个活的知识层，而不是静态文档目录。
