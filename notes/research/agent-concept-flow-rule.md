---
status: draft
created: 2026-04-20
---

# Agent Concept Flow Rule

## 问题

当前 agent 更擅长交付方案、代码、diff 与修复结论，但对刚接触相关内容的开发者来说，这种输出经常只解决“这次怎么做”，却没有同步建立“为什么这样做”的概念框架。

结果是：

- 用户能复用结论，但难以迁移方法
- 用户会使用 agent，但不会形成稳定的开发判断
- agent 输出容易停留在 `deliverable-only`

## 目标

把 agent 的部分输出升级为 `deliverable + pedagogy`：

- 仍以完成任务为主
- 只在合适场景补充关键概念
- 用当前代码、当前设计、当前报错做例子
- 帮用户建立可迁移的 mental model

## 调研结论

### 1. 最适合作为主框架的是 cognitive apprenticeship

最相关的不是“怎么多讲一点”，而是把专家的判断过程显化出来：

- 当前在关注什么信号
- 为什么选这个切分方式
- 为什么这个测试边界比另一个更稳

这与 agent 在真实工作流中的位置高度一致。

### 2. 支撑方式应采用 scaffolding，而不是百科式解释

好的概念流不是把理论全塞给用户，而是：

- 先给当前任务必需的支架
- 只解释眼前决策相关的概念
- 随着上下文变清楚，减少解释密度

### 3. 内容载体应优先使用 worked example

概念若脱离当前文件、当前 diff、当前设计取舍，学习效率会明显下降。

因此概念流应优先绑定：

- 当前改动
- 当前 bug
- 当前架构决策

而不是写成独立教程。

### 4. 要给 misconception correction 留位置

新手的问题不只是“没见过”，更常见的是“已经带着错的直觉在理解”。

因此规则应允许 agent 额外指出：

- 常见误解
- 为什么该误解在这里不成立
- 正确判断边界是什么

### 5. 展示层必须受 progressive disclosure 约束

如果不限制概念密度，概念流很容易反过来制造 cognitive overload。

因此 rule 必须明确：

- 默认只讲 1-2 个概念
- 优先短解释
- 用户显式要求时再展开

## 收敛判断

这条规则不属于：

- memory / recall / learning loop 规则
- skill 创建规则
- 任务管理规则

它更接近一条新的输出模式：

- 面向用户
- 与真实任务绑定
- 目标是“教会当前正在发生的工作”

因此应进入 `rules-library/pattern/`。

## 建议的规则骨架

推荐输出结构：

1. `Concept`
2. `Why It Matters Here`
3. `Worked Example`
4. `Common Misconception`
5. `Transfer`

其中：

- `Concept` 与 `Why It Matters Here` 为默认必选
- `Worked Example` 建议默认出现
- `Common Misconception` 与 `Transfer` 按场景补充

## 触发建议

适合触发：

- 用户显式说“讲讲原理 / 概念 / 为什么这样做”
- 用户是新手、刚接触某主题
- 当前任务涉及架构、调试、边界划分、测试取舍
- 当前回复不仅要给结果，还要帮助建立判断框架

不适合触发：

- 纯进度更新
- trivial 修复
- 用户明确要求只要结论、不要教学
- 时间敏感的高压排障场景

## 风险

### 1. 解释过载

如果每次都附带一段概念解释，规则会污染普通回复。

### 2. expert blind spot

如果 agent 直接抛术语，不补前提，概念流会变成新手无法消费的半成品。

### 3. 伪学习感

如果只有定义，没有当前例子和可迁移判断，用户只会得到“看起来懂了”的错觉。

## 结论

这条规则应该被定义为：

**在合适场景中，把 agent 当前正在使用的开发概念，用低负担、强上下文绑定的方式显化出来。**

它的重点不是“多讲”，而是“把专家判断过程教出来”。

## 参考

- Collins, Brown, Newman / Holum: Cognitive Apprenticeship
- Wood, Bruner, Ross: Scaffolding
- Sweller: Worked Example Effect
- Chi et al.: Self-Explanation
- Nielsen Norman Group: Progressive Disclosure
