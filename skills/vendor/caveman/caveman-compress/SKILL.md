---
name: caveman-compress
description: >
  压缩自然语言 memory 文件（CLAUDE.md、notes、todos）为简洁中文格式以节省输入 token。
  保留所有技术内容、代码、URL、结构。压缩版覆盖原文件，原版备份为 `<filename>.original.md`。
  触发：`/caveman-compress <filepath>` 或用户说"压缩这个 memory 文件"。
---

# Caveman Compress

> 本 skill 是 [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) 中 `compress` skill 的中文化改版。
> **上游的 Python CLI 工具未引入**（避免额外依赖）。本版直接让 Claude 在对话内生成压缩结果。

## 目标

把冗长自然语言文件压缩为简洁中文，节省后续会话的输入 token 消耗。

## 触发

`/caveman-compress <filepath>` 或用户明确要求压缩某个 memory 文件。

## 执行流程

1. **读取目标文件**（绝对路径）
2. **备份原文件**：复制到 `<filepath>.original.md`（若已存在则跳过，不覆盖）
3. **按压缩规则生成新版本**
4. **写回覆盖**原文件
5. **报告结果**：原始字节数 / 新字节数 / 压缩比 / 已备份路径

## 压缩规则

### 必删

- 客套话、hedging、过渡句（参见主 caveman skill 的删除清单）
- 重复说明（同一个概念在不同段落反复解释）
- 示例冗余（保留最有代表性的 1-2 个，删其余）
- "本节将介绍..."、"综上所述..."、"总的来说..." 类元描述

### 必留

- 代码块（完整保留，不压缩代码）
- URL、文件路径、命令
- 错误原文、日志片段
- 表格（结构化信息压缩风险高）
- 配置示例（YAML / JSON 块）
- frontmatter（`---` 包裹的 metadata）
- Markdown 结构（标题层级、列表层级）

### 风格转换

| 原始 | 压缩后 |
|------|--------|
| 完整段落，多句解释 | 短句 + 列表 |
| 多层嵌套的叙述 | 表格或项目符号 |
| 反复引用的概念 | 首次定义 + 后续简称 |
| 每节开头的引言 | 直接进入要点 |

## 适用对象

- 用户级 `~/.claude/CLAUDE.md` 及各 `rules/` 文件
- 项目级 `<project>/.claude/CLAUDE.md` 与 `tasks/` 文档
- `notes/research/`、`notes/design/` 长文
- `todos`、`preferences` 类个人 memory

## 不适用对象

- 教程性文档（需要完整叙述才能理解）
- API 参考文档（每条字段都重要）
- 规则索引文件（已是结构化清单）
- 已压缩过的文件（查 frontmatter 的 `compressed-by: caveman`）

## 标记已压缩

压缩后在 frontmatter 添加：

```yaml
---
compressed-by: caveman-compress
compressed-at: 2026-04-17
original-backup: CLAUDE.original.md
---
```

这样后续扫描可识别已压缩文件，避免重复压缩。

## 安全

- **不删除**：frontmatter、代码块、URL、路径、命令
- **不改写代码**：代码块内一字不动
- **必备份**：不覆盖已存在的 `.original.md`，避免丢失首次备份
- **出错回滚**：写入失败时必须恢复原文件

## 边界

- 单次只处理一个文件
- 不递归压缩目录（需要用户对每个文件显式触发）
- 不压缩 frontmatter 本身
