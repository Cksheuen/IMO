---
name: shit
description: 结构精简元技能。分析并优化 rules/skills/CLAUDE.md 的结构，发现冗余、重复、过长内容，提出精简建议。与 eat（吸收）相对，排泄"消化不良"的结构问题。当用户说"精简结构"、"清理冗余"、"优化上下文"、"整理 rules"时触发此技能。
description_en: "Structure simplification meta-skill. Analyzes and streamlines the structure of rules, skills, and CLAUDE.md, identifies redundancy or overlong sections, and proposes cleanup recommendations."
---

# Shit - 结构精简元技能

吃多了要拉出来。精简臃肿结构，保持上下文健康。

## 核心理念

与 `eat`（吸收知识）相对，`shit` 负责"排泄"结构问题：

| 对比 | eat | shit |
|------|-----|------|
| 方向 | 输入 → 吸收 | 输出 → 精简 |
| 目标 | 增加能力 | 减少冗余 |
| 操作 | 写入新知识 | 优化现有结构 |

## 分析目标

### 1. rules/ 与 rules-library/ 目录

> `rules/`：always-loaded（当前 4 个元级约束文件）
> `rules-library/`：按需注入（pattern/technique/tool/domain/core 等）

**检查项**：
- 重复内容：多个文件描述同一概念
- 过长文件：超过 100 行的规则文件
- 孤立文件：无引用、无被引用的规则
- 分类错误：文件名与内容不匹配
- 层级错误：本该按需注入的规则放在了 `rules/`，或 always-loaded 的元级约束放在了 `rules-library/`

**检查命令**：
```bash
# 文件大小（两个目录都检查）
find ~/.claude/rules ~/.claude/rules-library -name "*.md" -exec wc -l {} \; | sort -rn | head -10

# 内容相似度（需要 LLM 分析）
# 孤立文件检查
```

### 2. skills/ 目录

**检查项**：
- 废弃技能：不再使用的技能
- 重复功能：多个技能做同样的事
- 过长 SKILL.md：超过 500 行的技能

### 3. CLAUDE.md

**检查项**：
- 总长度：超过 200 行需要拆分
- 冗余原则：与其他规则重复
- 过时内容：不再适用的配置

## 执行流程

### Step 1: 扫描结构

```bash
# 统计各目录文件数
echo "### rules 结构（always-loaded）"
find ~/.claude/rules -name "*.md" | wc -l
find ~/.claude/rules -type d

echo "### rules-library 结构（按需注入）"
find ~/.claude/rules-library -name "*.md" | wc -l
find ~/.claude/rules-library -type d

echo "### skills 结构"
ls -d ~/.claude/skills/*/ | wc -l

echo "### CLAUDE.md 行数"
wc -l ~/.claude/CLAUDE.md
```

### Step 2: 分析问题

**自动检测**：
```bash
# 过长文件（>100 行）
find ~/.claude/rules ~/.claude/rules-library -name "*.md" -exec sh -c 'lines=$(wc -l < "$1"); [ $lines -gt 100 ] && echo "$1: $lines lines"' _ {} \;

# 检查重复关键词
grep -rh "^# " ~/.claude/rules ~/.claude/rules-library | sort | uniq -c | sort -rn | head -10
```

**LLM 分析**（需要调用）：
- 语义重复检测
- 内容相关性分析
- 结构优化建议

### Step 3: 生成报告

```markdown
# 结构精简报告

## 发现的问题

### 过长文件
| 文件 | 行数 | 建议 |
|------|------|------|
| rules-library/technique/complex-rule.md | 150 | 拆分为多个小文件 |

### 潜在重复
| 文件1 | 文件2 | 重叠内容 |
|-------|-------|----------|
| rules-library/pattern/auth.md | rules-library/technique/auth-trick.md | 认证相关 |

### 结构建议
- 合并 `rules-library/technique/auth-trick.md` 到 `rules-library/pattern/auth.md`
- 拆分 `CLAUDE.md` 中"工作流"部分到 `rules-library/core/`

## 预计收益
- 减少 X 行上下文
- 减少 Y 个文件
- 提高检索效率
```

### Step 4: 用户确认执行

**精简操作类型**：

| 操作 | 说明 | 风险 |
|------|------|------|
| **合并** | 多个文件合并为一个 | 低 |
| **拆分** | 大文件拆分为小文件 | 低 |
| **删除** | 删除重复内容 | 中（需确认） |
| **移动** | 调整分类位置 | 低 |
| **摘要** | 用摘要替换冗长内容 | 中（需确认） |

## 精简原则

1. **保留核心**：原则性内容不删除
2. **合并相似**：相同主题合并为一个文件
3. **拆分过长**：超过 100 行的文件拆分
4. **引用链接**：用 `[[wikilink]]` 建立关联
5. **摘要替代**：长内容用摘要 + 引用替代

## 与 forget 的区别

| 对比 | shit | forget |
|------|------|--------|
| 操作 | 优化结构 | 移动文件 |
| 目标 | 减少冗余 | 节约上下文 |
| 文件位置 | 不变 | 移到冷记忆 |
| 触发场景 | 结构混乱 | 内容不用 |

## 输出模板

```markdown
# [标题]

> 来源：[合并自 A.md, B.md]
> 精简时间：YYYY-MM-DD

## 核心原则

[一句话概括]

## 详细内容

[精简后的内容，去除重复]

## 相关规则

- [[related-rule-1]]
- [[related-rule-2]]
```

## 安全原则

1. **先报告后执行**：所有操作先展示报告
2. **用户确认**：合并/删除需要用户确认
3. **保留备份**：合并前保留原文件内容到注释
4. **可逆操作**：优先使用合并/移动而非删除
