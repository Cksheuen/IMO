---
name: thaw
description: 解冻元技能。将冻结的内容从冷存储（.cold-storage/）恢复到热存储，使其重新激活。触发条件：(1) 用户说"解冻"/"thaw"/"恢复"/"从冷存储恢复"；(2) 用户搜索的内容在热存储中未找到；(3) 用户提到冷存储中存在的关键词。
---

# Thaw - 解冻元技能

解冻被冻结的知识，使其重新活跃并加载到上下文中。

## 自动触发条件

满足以下任一条件时，**自动执行**解冻流程：

| 条件 | 说明 |
|------|------|
| 用户请求 | "解冻"、"thaw"、"恢复"、"从冷存储恢复" |
| 热存储未找到 | 用户搜索的内容在 `rules/`、`skills/` 中未找到 |
| 关键词匹配 | 用户提到的关键词在冷存储索引中存在 |

## 两层自动检索机制

```
用户搜索 "xxx"
    │
    ▼
搜索热存储（rules/, skills/）
    │
    ├── 找到 → 返回结果
    │
    └── 未找到 → 自动搜索冷存储（.cold-storage/）
                    │
                    ├── 找到 → 自动提示："发现冻结内容 xxx，是否解冻？"
                    │           │
                    │           └── 用户确认 → 自动解冻
                    │
                    └── 未找到 → 返回"未找到"
```

## 执行流程（自动）

### Step 1: 自动搜索冻结内容

```bash
# 自动搜索冷存储
Glob pattern="~/.claude/.cold-storage/**/*.md"

# 自动读取索引
Read ~/.claude/.cold-storage/index.json
```

### Step 2: 自动匹配关键词

```python
# 用户输入: "我需要 pattern 相关的规则"
# 自动搜索 index.json 中的 keywords 字段
for entry in index.entries:
    if any(kw in user_input for kw in entry.keywords):
        suggest_thaw(entry)
```

### Step 3: 自动展示冻结清单

```markdown
# 冷存储发现匹配内容

| 序号 | 文件 | 类型 | 冻结时间 | 摘要 |
|------|------|------|----------|------|
| 1 | rules/technique/old-pattern.md | technique | 2025-01-15 | 旧的性能优化模式 |

**发现匹配项，是否解冻？**（输入序号确认，或输入 "all" 解冻全部）
```

### Step 4: 用户确认后自动执行

```bash
# 自动创建目标目录
mkdir -p ~/.claude/rules/technique

# 自动移动文件
mv ~/.claude/.cold-storage/rules/old-pattern.md ~/.claude/rules/technique/

# 自动更新索引（移除该条目）
update_index --remove "old-pattern"
```

## 索引同步

解冻后自动从 `index.json` 移除条目：

```json
// 解冻前
{"entries": [
  {"originalPath": "rules/technique/old-pattern.md", ...}
]}

// 解冻后（自动移除）
{"entries": []}
```

## 冲突处理

如果目标位置已有同名文件：

```markdown
⚠️ 冲突：rules/technique/old-pattern.md 已存在

选项：
1. 覆盖现有文件
2. 重命名解冻文件（old-pattern-restored.md）
3. 取消解冻

请选择（1/2/3）
```

## 智能提示

当用户可能需要冻结内容时，主动提示：

```
用户: "怎么优化性能？"
    │
    ▼
热存储搜索 "性能优化" → 未找到
    │
    ▼
冷存储搜索 → 发现 "old-pattern.md"（keywords: ["性能", "优化"]）
    │
    ▼
自动提示："发现冻结的性能优化规则，是否解冻查看？"
```

## 相关技能

- [[freeze]] - 冻结活跃内容
- [[locate]] - 代码地图索引
