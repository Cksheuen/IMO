---
name: freeze
description: 冻结元技能。将长期不使用的 skills、rules 从热存储移至冷存储（.cold-storage/），节约上下文空间。触发条件：(1) 用户说"冻结"/"freeze"/"移到冷存储"；(2) skills 数量超过 20 个；(3) rules 总行数超过 500 行；(4) 用户说"上下文太长"/"精简上下文"。
---

# Freeze - 冻结元技能

冻结不常用知识，保持上下文精简。被冻结的内容不占用上下文，但可随时解冻恢复。

## 自动触发条件

满足以下任一条件时，**自动执行**冻结流程：

| 条件 | 阈值 | 说明 |
|------|------|------|
| skills 数量 | > 20 个 | 技能过多影响加载 |
| rules 总行数 | > 500 行 | 规则过长占用上下文 |
| 用户请求 | "冻结"、"freeze"、"移到冷存储"、"上下文太长"、"精简上下文" | 显式请求 |

## 执行流程（自动）

### Step 1: 检查触发条件

```bash
# 自动检查，无需人工启动
skill_count=$(find ~/.claude/skills -name "SKILL.md" | wc -l)
rule_lines=$(find ~/.claude/rules -name "*.md" -exec cat {} \; | wc -l)

if [ $skill_count -gt 20 ] || [ $rule_lines -gt 500 ]; then
  echo "触发自动冻结检查"
fi
```

### Step 2: 自动扫描候选

自动识别可冻结内容：

```yaml
自动冻结候选:
  - skills 中未在 CLAUDE.md 引用的技能
  - rules 中超过 30 天未修改的文件
  - 项目特定的知识（非通用）
  - 用户标记为"实验性"的内容
```

### Step 3: 自动展示报告

```markdown
# 冻结候选报告（自动检测）

当前状态：skills=${count} 个，rules=${lines} 行

| 序号 | 文件 | 类型 | 原因 | 自动建议 |
|------|------|------|------|----------|
| 1 | skills/experimental/SKILL.md | skill | 实验性 | ✅ 冻结 |
| 2 | rules/technique/old-pattern.md | technique | 30天未改 | ⚠️ 待确认 |

**自动执行建议冻结项，待确认项需用户批准**
```

### Step 4: 自动执行

```bash
# 自动冻结（无需确认）
for file in $auto_freeze_list; do
  mv "$file" ~/.claude/.cold-storage/
done

# 更新索引
update_index "$auto_freeze_list"
```

## 目录结构

```
~/.claude/
├── rules/                    # 活跃规则
├── skills/                   # 活跃技能
├── memory/                   # 结构化记忆
├── .cold-storage/            # 冷存储（冻结区）
│   ├── rules/                # 冻结的规则
│   ├── skills/               # 冻结的技能
│   └── index.json            # 索引
└── .gitignore                # 排除 .cold-storage/
```

## 自动冻结判断标准

| 自动冻结 | 需确认 | 保留 |
|----------|--------|------|
| 实验性技能 | 项目特定规则 | 核心工作流 |
| 超过 30 天未用 | 低频使用规则 | 通用原则 |
| 未被 CLAUDE.md 引用 | 可能有用的知识 | 最近使用 |

## 索引格式

```json
{
  "version": "1.0",
  "lastCheck": "2026-03-26T10:00:00Z",
  "entries": [
    {
      "originalPath": "rules/technique/old-pattern.md",
      "frozenPath": ".cold-storage/rules/old-pattern.md",
      "frozenAt": "2026-03-26T10:00:00Z",
      "reason": "auto:30天未修改",
      "keywords": ["pattern", "optimization"],
      "summary": "旧的性能优化模式"
    }
  ]
}
```

## 初始化检查（自动）

首次使用时自动检查环境：

```bash
# 创建冷存储目录
mkdir -p ~/.claude/.cold-storage/{rules,skills}

# 确保 gitignore 排除冷存储
grep -q ".cold-storage" ~/.claude/.gitignore 2>/dev/null || \
  echo -e "\n# 冷存储（不同步）\n.cold-storage/" >> ~/.claude/.gitignore
```

## 与其他元技能协作

```
eat（吸收）→ remember（记忆）→ 活跃使用
                ↓
         [自动检测: 长期不用/超出阈值]
                ↓
         freeze（冻结）→ 冷存储
                ↓
         [用户需要时]
                ↓
         thaw（解冻）→ 恢复活跃
```

| 技能 | 方向 | 自动性 |
|------|------|--------|
| **freeze** | 移出 | ✅ 自动触发 |
| **thaw** | 移回 | ✅ 自动检索 |

## 相关技能

- [[thaw]] - 解冻恢复冻结的内容
- [[eat]] - 吸收新知识
- [[remember]] - 结构化记忆
