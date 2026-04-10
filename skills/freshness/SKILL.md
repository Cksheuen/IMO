---
name: freshness
description: 参考时效性检查技能。扫描 skills/rules 文档中的参考链接（GitHub仓库、文章URL），检查其时效性（仓库是否archived/不活跃、文章是否过时），生成更新报告并同步更新原文档。当用户提到"检查时效性"、"验证参考"、"参考过时"、"更新参考"时触发此技能。也可在吸收新知识后定期运行，确保知识库持续新鲜。
---

# Freshness - 参考时效性检查技能

让知识库里的参考链接保持可信，而不是只保留“当时看过”。

## 何时使用

- 用户要求检查规则、技能、笔记中的参考是否过时
- 发现某个 GitHub 仓库可能 archived / 停更
- 发现文章太旧、链接失效、需要替换
- `eat` 吸收完新资料后，想补一轮时效性检查

## 核心目标

1. 找出已过时或不可访问的参考
2. 给出 `fresh / needs_attention / outdated / timeless / skipped / unknown` 状态
3. 生成报告
4. 只更新文档元数据，不擅自改核心内容

## 最小流程

### Step 0: 准备目录

确保存在：

- `~/.claude/references/reports/`
- `~/.claude/references/index.json`

### Step 1: 扫描范围

默认检查：

- `~/.claude/rules/**/*.md`
- `~/.claude/skills/*/SKILL.md`

### Step 2: 提取参考

主要关心三类：

- GitHub 仓库
- 技术文章
- X / Twitter 链接

其中 X / Twitter 默认标记为 `skipped`，不做时效性判断。

### Step 3: 判断状态

| 状态 | 含义 |
|------|------|
| `fresh` | 活跃、可访问、近期有效 |
| `needs_attention` | 还可用，但需要复核 |
| `outdated` | archived、死链、明显过时 |
| `timeless` | 经典原理型内容 |
| `skipped` | 默认跳过检查 |
| `unknown` | 无法验证 |

### Step 4: 生成报告

报告写入：

- `~/.claude/references/reports/YYYY-MM-DD.md`

内容至少包括：

- 扫描范围
- 总数统计
- 各状态数量
- 高优先级问题
- 建议动作

### Step 5: 更新文档元数据

自动可做：

- `fresh`
- `timeless`
- `needs_attention`

需要用户确认后再做：

- `outdated`
- 删除旧参考
- 用新参考替换旧参考

## 判定原则

### GitHub

- `archived=true` → `outdated`
- 近 `3` 个月活跃 → `fresh`
- `3-12` 个月未更新 → 通常 `fresh`
- `> 1` 年未更新 → `needs_attention`

### 文章

- 404 / 410 → `outdated`
- 可访问但明显过旧 → `needs_attention`
- 经典原理文章 → `timeless`

## 输出要求

至少说明：

- 检查模式：增量 / 全量 / 单文件
- 扫描了哪些文件
- 发现了哪些高风险项
- 哪些改动已自动完成
- 哪些改动在等待用户确认

## 参考文件

- `references/playbook.md`：提取规则、报告模板、索引格式、确认机制
- `skills/eat/SKILL.md`
