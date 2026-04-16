---
paths:
  - "skills/**/*"
  - ".claude/skills/**/*"
---

# Skills CLI 发现与安装规范

> 来源：[skills.sh/vercel-labs/skills/find-skills](https://skills.sh/vercel-labs/skills/find-skills)
> 吸收时间：2026-03-26

## 触发条件

当满足以下任一条件时，应用此规范：
- 用户问 "how do I do X" 且 X 可能是已有 skill 的常见任务
- 用户说 "find a skill for X" 或 "is there a skill for X"
- 用户问 "can you do X" 且 X 是专门能力
- 用户表达希望扩展 Agent 能力
- 用户提到特定领域需要帮助（设计、测试、部署等）
- **创建新 skill 前** - 先搜索是否已存在高质量 skill，避免重复造轮子

## 执行规范

### Step 1: 理解需求

识别用户需要：
- **领域**: React、测试、设计、部署等
- **具体任务**: 写测试、创建动画、PR 审查等
- **通用性**: 是否是足够常见的任务（可能已有 skill）

### Step 2: 先检查 Leaderboard

访问 [skills.sh](https://skills.sh/) 查看 leaderboard，确认是否有知名 skill 已覆盖该领域。

**热门来源**：
- `vercel-labs/agent-skills` — React、Next.js、web design（100K+ 安装）
- `anthropics/skills` — Frontend design、document processing（100K+ 安装）

### Step 3: 搜索 Skills

```bash
npx skills find [query]
```

**示例**：
| 用户问题 | 搜索命令 |
|---------|---------|
| "如何让 React 应用更快?" | `npx skills find react performance` |
| "帮我做 PR 审查" | `npx skills find pr review` |
| "需要创建 changelog" | `npx skills find changelog` |

### Step 4: 验证质量（必须执行）

**不要仅基于搜索结果推荐**，必须验证：

| 维度 | 标准 | 风险等级 |
|------|------|---------|
| **安装量** | 1K+ 安装优先 | < 100 需谨慎 |
| **来源信誉** | 官方源优先 | 未知作者需验证 |
| **GitHub Stars** | 100+ stars | < 100 需怀疑 |

**可信来源**：
- `vercel-labs`
- `anthropics`
- `microsoft`

### Step 5: 展示选项

推荐格式：
```
我找到一个 skill 可能帮到你！"react-best-practices" 提供
React 和 Next.js 性能优化指南，来自 Vercel Engineering。
(185K 安装)

安装命令：
npx skills add vercel-labs/agent-skills@react-best-practices

了解更多：https://skills.sh/vercel-labs/agent-skills/react-best-practices
```

### Step 6: 安装 Skill

用户确认后安装：
```bash
npx skills add <owner/repo@skill> -g -y
```

- `-g`: 全局安装（用户级别）
- `-y`: 跳过确认提示

## 决策框架

```
触发场景？
    │
    ├─ 用户请求能力扩展 → 搜索 → 验证 → 推荐安装
    │
    └─ 创建新 skill 前 → 搜索是否存在
            │
            ├─ 已存在高质量 skill
            │       │
            │       ├─ 完全满足需求 → 直接推荐，无需创建
            │       │
            │       └─ 部分满足需求 → 作为参考/依赖，补充差异
            │
            └─ 不存在或质量不足 → 继续创建新 skill
```

### Skill 创建前的检查流程

在调用 `skill-creator` 创建新 skill 之前，必须执行：

1. **搜索现有 skill**：`npx skills find [相关关键词]`

2. **评估发现结果**：
   | 发现情况 | 处理方式 |
   |---------|---------|
   | 高质量 skill 完全覆盖 | 直接推荐使用，无需创建 |
   | 部分覆盖 | 作为参考，补充缺失功能 |
   | 存在但质量不足 | 可 fork 改进或重新创建 |
   | 不存在 | 继续创建新 skill |

3. **记录发现**：在创建 skill 时，记录是否参考了现有 skill

## 常见 Skill 类别

| 类别 | 搜索关键词 |
|------|-----------|
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| Documentation | docs, readme, changelog, api-docs |
| Code Quality | review, lint, refactor, best-practices |
| Design | ui, ux, design-system, accessibility |
| Productivity | workflow, automation, git |

## 搜索技巧

- **使用具体关键词**: "react testing" 比 "testing" 更好
- **尝试替代词**: "deploy" 不行时尝试 "deployment" 或 "ci-cd"
- **检查热门源**: 许多 skill 来自 `vercel-labs/agent-skills` 或 `ComposioHQ/awesome-claude-skills`

## 无匹配时的处理

```
我搜索了与 "xyz" 相关的 skill 但没有找到匹配。

我可以直接帮你处理这个任务！要继续吗？

如果这是你经常做的事情，可以创建自己的 skill：
npx skills init my-xyz-skill
```

## 相关规范

- [skill-creator](../../skills/skill-creator/SKILL.md) - 创建新 skill（创建前必须先搜索现有 skill）
- [[browser-auth-reuse]] - 浏览器认证复用

## 参考

- [Skills CLI](https://skills.sh/)
- [Vercel Labs Skills](https://github.com/vercel-labs/skills)
