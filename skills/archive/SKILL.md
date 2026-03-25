---
name: archive
description: 归档元技能。将长期不使用的内容从主上下文移动到冷存储（.cold-storage/），实现热/冷两层检索机制，节约上下文空间。当用户说"归档"、"归档这个"、"移到冷存储"、或想清理不常用规则/技能时触发此技能。
---

# Archive - 归档元技能

归档是智能的一部分。将不常用知识移到冷存储，保持上下文精简。

## 核心理念

- **热存储**：自动加载，占用上下文 → 高频使用、核心原则
- **冷存储**：按需检索，不占上下文 → 低频使用、项目特定、历史知识

## 与 remember 的区别

| 技能 | 职责 | 目标存储 |
|------|------|----------|
| **remember** | 三层记忆（L1/L2/L3） | `memory/` 结构化记忆 |
| **archive** | 热/冷归档 | `.cold-storage/` 冷存储 |

**remember** 是"记忆系统"，按抽象层级组织知识。
**archive** 是"归档系统"，按使用频率移动知识。

## 目录结构

```
~/.claude/
├── rules/                    # 热存储
├── skills/                   # 热存储
├── memory/                   # 结构化记忆（remember 管理）
├── .cold-storage/            # 冷存储
│   ├── rules/                # 归档的规则
│   ├── skills/               # 归档的技能
│   ├── index.json            # 索引
│   └── manifest.md           # 清单（人类可读）
└── .gitignore                # 已排除 .cold-storage/
```

## 执行流程

### Step 1: 扫描归档候选

```bash
# 扫描 rules 和 skills 目录
Glob pattern="~/.claude/rules/**/*.md"
Glob pattern="~/.claude/skills/*/SKILL.md"
```

**候选判断**（展示给用户确认，不自动判断）：
- 创建时间超过 N 天
- 项目特定的知识（非通用）
- 用户明确表示不再需要

### Step 2: 展示候选报告

```markdown
# 归档候选报告

| 文件 | 创建时间 | 类型 | 建议理由 |
|------|----------|------|----------|
| rules/technique/old-pattern.md | 2025-01-15 | technique | 项目特定，已过时 |
| skills/experimental/SKILL.md | 2025-02-01 | skill | 实验性技能 |

**请选择要归档的内容**（输入序号或文件名）
```

### Step 3: 用户确认后执行

```bash
# 1. 创建冷存储目录
mkdir -p ~/.claude/.cold-storage/rules
mkdir -p ~/.claude/.cold-storage/skills

# 2. 移动文件
mv ~/.claude/rules/technique/old-pattern.md ~/.claude/.cold-storage/rules/

# 3. 更新索引
# 追加到 index.json
```

### Step 4: 更新索引文件

**index.json 格式**：
```json
{
  "version": "1.0",
  "entries": [
    {
      "originalPath": "rules/technique/old-pattern.md",
      "coldPath": ".cold-storage/rules/old-pattern.md",
      "archivedAt": "2026-03-25T10:00:00Z",
      "reason": "项目特定，已过时",
      "keywords": ["pattern", "optimization"],
      "summary": "旧的性能优化模式"
    }
  ]
}
```

**manifest.md 格式**（人类可读）：
```markdown
# 冷存储清单

## rules
- `old-pattern.md` - 旧的性能优化模式（归档于 2026-03-25）

## skills
- `experimental/` - 实验性技能（归档于 2026-03-25）
```

## 恢复功能（/recall）

从冷存储检索并恢复到热存储。

**触发词**：`/recall`、`恢复`、`从冷存储恢复`

**流程**：
1. 用户请求 "恢复 xxx"
2. 搜索热存储（未找到）
3. 搜索冷存储 `.cold-storage/`
4. 找到后询问是否恢复到热存储
5. 用户确认后移动回原位置

## 两层检索机制

```
用户搜索 "xxx"
    │
    ▼
搜索热存储（rules/, skills/）
    │
    ├── 找到 → 返回结果
    │
    └── 未找到 → 搜索冷存储（.cold-storage/）
                    │
                    ├── 找到 → 询问是否恢复
                    │
                    └── 未找到 → 返回"未找到"
```

## 与其他技能协作

| 技能 | 职责 |
|------|------|
| **eat** | 吸收新知识 → 热存储 |
| **remember** | 结构化记忆 → memory/ |
| **archive** | 归档旧知识 → 冷存储 |
| **shit** | 精简结构 → 优化组织 |

## 安全原则

1. **用户确认**：所有移动操作必须用户确认
2. **可恢复**：冷存储随时可恢复到热存储
3. **索引追踪**：所有归档操作记录在 index.json
4. **不同步**：冷存储不进入版本控制

## 初始化检查

首次使用时检查：

```bash
# 检查冷存储目录是否存在
ls ~/.claude/.cold-storage/ 2>/dev/null || mkdir -p ~/.claude/.cold-storage/{rules,skills}

# 检查 gitignore 是否已排除
grep -q ".cold-storage" ~/.claude/.gitignore || echo -e "\n# 冷存储（不同步）\n.cold-storage/" >> ~/.claude/.gitignore
```
