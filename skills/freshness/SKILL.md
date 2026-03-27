---
name: freshness
description: 参考时效性检查技能。扫描 skills/rules 文档中的参考链接（GitHub仓库、文章URL），检查其时效性（仓库是否archived/不活跃、文章是否过时），生成更新报告并同步更新原文档。当用户提到"检查时效性"、"验证参考"、"参考过时"、"更新参考"时触发此技能。也可在吸收新知识后定期运行，确保知识库持续新鲜。
---

# Freshness - 参考时效性检查技能

让知识库保持新鲜，自动发现过时的参考。

## 核心理念

知识有时效性。GitHub 仓库可能被 archived，文章可能被更好的替代，技术方案可能被淘汰。

这个技能帮你：
1. **发现过时参考** - 检测 archived 仓库、不活跃项目、过时文章
2. **追踪变更** - 发现 GitHub 仓库的新版本、重要更新
3. **自动更新** - 生成报告，同步更新原文档

---

## 执行流程

```
Setup → 扫描文档 → 提取参考 → 检查时效性 → 生成报告 → 更新文档 → 更新索引
```

---

## Phase 0: 环境准备

### 0.1 创建目录结构

**必须先创建**以下目录（如果不存在）：

```bash
mkdir -p ~/.claude/references/reports
```

### 0.2 目录结构

```
~/.claude/references/
├── index.json           # 参考索引（所有参考的元数据）
└── reports/             # 检查报告
    └── YYYY-MM-DD.md    # 按日期命名
```

---

## Phase 1: 扫描与提取

### 1.1 扫描范围

```yaml
扫描目录:
  - ~/.claude/rules/**/*.md
  - ~/.claude/skills/*/SKILL.md

排除:
  - node_modules/
  - .git/
  - 图片/字体等资源文件
```

### 1.2 提取参考链接

**提取模式**：

| 类型 | 正则/模式 | 提取内容 | 处理方式 |
|------|----------|----------|----------|
| **GitHub 仓库** | `github\.com/([^/]+)/([^/\)\s]+)` | owner, repo | API 检查 |
| **技术文章** | 非 github/x 的 https URL | URL | 可访问性 + 时效性 |
| **X/Twitter** | `(x\|twitter)\.com/[^/]+/status/` | 跳过 | 不检查 |

### 1.3 提取来源信息

同时提取参考的上下文信息：

```yaml
提取字段:
  - 来源行: "> 来源：[...](URL) | 吸收时间：..."
  - 吸收时间: 从文档头部提取
  - 参考章节: "## 参考" 下的链接列表
```

---

## Phase 2: 时效性检查

### 2.1 GitHub 仓库检查

**判断标准**：

| 维度 | 检查方法 | 判断 | 状态 |
|------|----------|------|------|
| **archived** | API `archived` 字段 | `true` | ❌ 过时 |
| **不活跃** | `pushed_at` 字段 | > 1 年未更新 | ⚠️ 需关注 |
| **活跃** | 近期有提交 | < 3 个月 | ✅ 新鲜 |
| **正常** | 有更新但非近期 | 3-12 个月 | ✅ 正常 |

**API 调用优先级**：

```yaml
优先级 1: gh CLI（如果已安装）
  命令: gh repo view {owner}/{repo} --json archived,pushedAt,stargazerCount

优先级 2: WebFetch GitHub API（公开仓库无需 Token）
  URL: https://api.github.com/repos/{owner}/{repo}

优先级 3: WebSearch 搜索仓库状态
  查询: "{owner}/{repo} github archived status"
```

### 2.2 文章时效性检查

**检查维度**：

| 维度 | 方法 | 判断标准 |
|------|------|----------|
| **可访问性** | HTTP HEAD 请求 | 200 OK = ✅, 404 = ❌ 死链 |
| **发布时间** | 元数据提取 | > 3 年 = ⚠️ 需验证 |
| **经典内容** | 手动标记 | 永不过时 |

**经典内容识别**：

某些内容虽旧但仍有价值（如 Karpathy 的 ML Recipe），应该标记为 **"经典/ timeless"**：

```yaml
经典内容特征:
  - 作者权威性高（Karpathy、Andrej、论文等）
  - 内容为基础原理而非具体工具版本
  - 社区广泛认可

处理方式:
  - 在文档中添加标记: > 时效性：📜 经典（原理永不过时）
  - 跳过后续时效性警告
```

### 2.3 检查结果分类

```yaml
状态分类:
  ✅ fresh: 活跃/可访问/新鲜
  ⚠️ needs_attention: 不活跃/需验证
  ❌ outdated: archived/死链/过时
  📜 timeless: 经典内容，永不过时
  🔍 skipped: 跳过检查（X/Twitter）
  ❓ unknown: 无法验证
```

---

## Phase 3: 生成报告

### 3.1 报告路径

`~/.claude/references/reports/YYYY-MM-DD.md`

### 3.2 报告模板

```markdown
# 参考时效性检查报告

**检查时间**：YYYY-MM-DD HH:MM
**检查范围**：rules/（N 文件）、skills/（M 文件）
**发现参考**：GitHub 仓库 X 个、文章 Y 个、X/Twitter Z 个（已跳过）

---

## 汇总

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 新鲜 | N | X% |
| ⚠️ 需关注 | N | X% |
| ❌ 过时 | N | X% |
| 📜 经典 | N | X% |
| 🔍 跳过 | N | X% |

---

## GitHub 仓库检查结果

### ✅ 活跃仓库

| 文件 | 仓库 | Stars | 最后更新 | 状态 |
|------|------|-------|----------|------|
| xxx.md | [owner/repo](url) | 1000 | 2026-03-20 | ✅ 活跃 |

### ⚠️ 需关注仓库

| 文件 | 仓库 | 问题 | 建议 |
|------|------|------|------|
| xxx.md | [owner/repo](url) | 2年未更新 | 搜索替代方案 |

### ❌ 已归档仓库

| 文件 | 仓库 | 建议 |
|------|------|------|
| xxx.md | [owner/repo](url) | 寻找替代或移除 |

---

## 文章检查结果

### ✅ 可访问文章

| 文件 | 文章 | 状态 |
|------|------|------|
| xxx.md | [标题](url) | ✅ 200 OK |

### ⚠️ 需验证文章（> 3年）

| 文件 | 文章 | 发布时间 | 建议 |
|------|------|----------|------|
| xxx.md | [标题](url) | 2020-01-01 | 搜索更新版本 |

### ❌ 死链

| 文件 | 原链接 | 建议 |
|------|--------|------|
| xxx.md | url | 移除或替换 |

---

## 建议行动

### 高优先级

1. **问题**: 描述
   **建议**: 具体行动

### 中优先级

2. **问题**: 描述
   **建议**: 具体行动

---

*报告由 freshness 技能自动生成*
```

---

## Phase 4: 更新文档

### 4.1 时效性元数据更新

**只更新元数据，不修改核心内容**。

在文档头部添加/更新时效性状态：

```markdown
# 更新前
> 来源：[browser-use/browser-use](https://github.com/browser-use/browser-use) | 吸收时间：2026-03-26

# 更新后
> 来源：[browser-use/browser-use](https://github.com/browser-use/browser-use) | 吸收时间：2026-03-26 | 时效性：✅ 2026-03-26 检查
```

### 4.2 经典内容标记

对于经典内容，添加特殊标记：

```markdown
> 来源：[Karpathy's Recipe](http://karpathy.github.io/2019/04/25/recipe/) | 吸收时间：2026-03-26 | 时效性：📜 经典（ML 训练方法论，永不过时）
```

### 4.3 需关注内容标记

对于需要关注的参考，添加警告：

```markdown
## 参考

- [browser-use GitHub](https://github.com/browser-use/browser-use)
- [旧仓库](https://github.com/example/stale-repo) ⚠️ *最后更新: 2024-04-13，建议检查替代方案*
```

### 4.4 确认机制

| 变更类型 | 自动/需确认 |
|---------|------------|
| 添加时效性状态（✅ fresh） | 自动执行 |
| 标记经典内容（📜 timeless） | 自动执行 |
| 标记需关注（⚠️ needs_attention） | 自动执行 + 报告 |
| 标记过时（❌ outdated） | **需用户确认** |
| 移除参考 | **需用户确认** |
| 替换为新参考 | **需用户确认** |

---

## Phase 5: 更新索引

### 5.1 索引文件路径

`~/.claude/references/index.json`

### 5.2 索引格式

```json
{
  "last_full_scan": "2026-03-26T10:30:00Z",
  "total_references": 54,
  "by_status": {
    "fresh": 43,
    "needs_attention": 6,
    "outdated": 0,
    "timeless": 3,
    "skipped": 2
  },
  "references": [
    {
      "id": "gh-001",
      "type": "github",
      "url": "https://github.com/browser-use/browser-use",
      "source_files": ["notes/research/browser-agent-architecture.md"],
      "absorbed_at": "2026-03-26",
      "last_checked": "2026-03-26T10:30:00Z",
      "status": "fresh",
      "metadata": {
        "owner": "browser-use",
        "repo": "browser-use",
        "stars": 84561,
        "last_push": "2026-03-25T08:00:00Z",
        "archived": false
      }
    },
    {
      "id": "article-001",
      "type": "article",
      "url": "http://karpathy.github.io/2019/04/25/recipe/",
      "source_files": ["rules/domain/ml/ml-training-preflight-checks.md"],
      "absorbed_at": "2026-03-26",
      "last_checked": "2026-03-26T10:30:00Z",
      "status": "timeless",
      "metadata": {
        "publish_date": "2019-04-25",
        "note": "Classic ML training recipe - principles remain relevant"
      }
    },
    {
      "id": "gh-002",
      "type": "github",
      "url": "https://github.com/SebChw/Actually-Robust-Training",
      "source_files": ["rules/domain/ml/ml-training-preflight-checks.md"],
      "absorbed_at": "2026-03-26",
      "last_checked": "2026-03-26T10:30:00Z",
      "status": "needs_attention",
      "warning": "Repository not updated in ~2 years",
      "metadata": {
        "owner": "SebChw",
        "repo": "Actually-Robust-Training",
        "stars": 44,
        "last_push": "2024-04-13T12:30:32Z"
      }
    }
  ]
}
```

---

## 检查模式

| 模式 | 触发条件 | 检查范围 | 用途 |
|------|----------|----------|------|
| **增量** | 默认模式 | `last_checked > 7天` | 日常检查 |
| **全量** | "检查所有"、"全量检查" | 所有参考 | 定期维护 |
| **单文件** | "检查 xxx.md 的参考" | 指定文件 | 精准检查 |

---

## 决策框架

```
收到指令
    │
    ├─ 确定检查模式
    │       ├─ 默认 → 增量检查
    │       ├─ "所有"/"全量" → 全量检查
    │       └─ 指定文件 → 单文件检查
    │
    ├─ Phase 0: 创建目录结构
    │
    ├─ Phase 1: 扫描提取参考
    │
    ├─ Phase 2: 时效性检查
    │       │
    │       ├─ GitHub → API 检查 archived/pushed_at
    │       ├─ 文章 → HTTP 检查 + 元数据提取
    │       └─ Twitter → 跳过
    │
    ├─ Phase 3: 生成报告
    │
    ├─ Phase 4: 更新文档（元数据）
    │       │
    │       ├─ fresh/timeless → 自动更新
    │       ├─ needs_attention → 自动更新 + 报告
    │       └─ outdated → 报告 + 等待确认
    │
    └─ Phase 5: 更新索引
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| GitHub API 限流 (403) | 等待 1 分钟重试，或切换到 WebSearch |
| 网络超时 | 跳过该项，标记 `unknown`，继续检查 |
| 私有仓库 (404) | 标记 `unknown`，记录"私有仓库无法验证" |
| 文章 404/410 | 标记 `outdated`，建议移除 |
| 无法提取发布日期 | 仅检查可访问性，不判断时效性 |

---

## 检查清单

### 执行前

- [ ] 创建 `~/.claude/references/` 目录结构
- [ ] 确定检查范围（增量/全量/单文件）
- [ ] 检查网络连接

### 执行后

- [ ] 报告已生成到 `~/.claude/references/reports/`
- [ ] 索引已更新到 `~/.claude/references/index.json`
- [ ] 文档时效性元数据已同步
- [ ] 重大变更已请求用户确认

---

## 与其他技能的协作

- **eat** - 吸收新知识后可运行 freshness 确保参考新鲜
- **locate** - 更新索引时同步更新代码地图
- **freeze/thaw** - 归档过时参考到冷存储

---

## 开始执行

等待用户指令，默认执行增量检查。
