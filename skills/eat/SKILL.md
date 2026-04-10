---
name: eat
description: 知识吸收元技能。深度分析输入内容（X/Twitter帖子、GitHub项目、技术文章、代码片段），提取可复用模式与原理，写入持久存储（rules/或创建新skill），实现能力增量。当用户提供URL、代码片段、技术文章或要求"学习"、"吸收"、"消化"知识时触发此技能。
---

# Eat - 知识吸收元技能

吸收新资料，把它变成可复用能力。

## 核心边界

- 处理的是**新输入**：URL、文章、项目、代码片段、长文本
- 目标是提取 pattern、workflow、decision rule，而不是复制原文
- 可以写 `notes/`、`rules/`、`skills/`
- 可以提出 declarative memory candidate，但**不能直接写** `memory/declarative/*`
- `eat` 不是旧 note 的默认晋升入口；旧经验升格交给 `promote-notes`

## 关键原则

- 提取，不复制
- 高同构输入优先反哺本地能力
- 新资料若能直接修正本地缺口，本轮必须落地 patch
- 还不稳定的理解先写 `notes/`
- 写入前先做相关知识检索与去重

## 最小流程

### Step 1: 获取内容

按输入类型选择：

- URL：优先抓正文；遇到鉴权再走浏览器登录态复用
- 本地文件：直接读取
- 粘贴内容：直接分析
- 多媒体：先提取文字或结构

### Step 2: 检索现有知识

至少检查：

- `notes/research/`
- `notes/lessons/`
- `notes/design/`
- `rules/`
- `skills/`

目的不是复习旧知识，而是避免重复吸收和重复落地。

### Step 3: 判断同构度

问四个问题：

1. 外部资料是否在解决和本地系统相同的问题？
2. 其分层或闭环能否映射到本地 `rules/skills/hooks/workflows`？
3. 本地是否已经存在明确缺口？
4. 现在是否已经足够支撑一次直接优化？

处理规则：

- 高同构：直接 patch 本地内容，`notes/` 只存证据
- 中同构：先写 `notes/research/` 或 `notes/design/`
- 低同构：可只沉淀 research note

### Step 4: 验证时效性

外部资料默认要做时效性判断：

- `< 1 年`：通常可直接采用
- `1-3 年`：检查核心方法是否仍成立
- `> 3 年`：只参考原理，不默认采用具体实践
- 数学 / 基础原理：可视为长期有效

### Step 5: 决定输出位置

| 情况 | 去向 |
|------|------|
| 已能直接形成稳定规范 | `rules/` |
| 已能形成完整工作流 | `skills/` |
| 还在探索、需要缓冲 | `notes/research/` 或 `notes/design/` |
| 只补充已有 lesson | 更新 `notes/lessons/` |
| 发现本地明确缺口 | 先 patch 本地内容，再补 note |

## 写入前检查

- 是否已搜索相近 rule / skill / note
- 是否只是已有 note 的晋升冲动，而不是新资料吸收
- 是否已经脱离具体案例，具备迁移性
- 若判断为高同构，是否已经把本地缺口一并修掉

## 输出要求

至少说明：

- 核心价值是什么
- 可迁移 pattern 是什么
- 与现有知识的关系
- 输出去向为什么是这里
- 若高同构，本轮具体 patch 了哪些本地内容

## 参考文件

- `references/playbook.md`：详细 phase、模板、即时配置细节
- `rules/technique/browser-auth-reuse.md`
- `skills/promote-notes/SKILL.md`
- `skills/skill-creator/SKILL.md`
