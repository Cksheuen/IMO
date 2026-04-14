---
name: architecture-health
description: 架构健康度仪表盘。分析项目的架构适应度指标，评估当前所处阶段，输出超标指标和升级建议。当用户说"检查架构健康度"、"架构评估"、"architecture health"、"该不该重构"、"项目架构怎么样"时触发。
---

# Architecture Health - 架构健康度仪表盘

分析项目架构的适应度指标，判断当前所处演化阶段，给出量化的升级建议。

## 触发条件

满足以下任一条件时触发：

| 条件 | 示例 |
|------|------|
| 用户询问架构状态 | "项目架构怎么样"、"该不该重构" |
| 用户要求架构评估 | "检查架构健康度"、"architecture health" |
| 进入新项目初次评估 | 配合 `project-architecture-first` 使用 |
| 实现中感觉代码膨胀 | "这个文件太大了"、"要不要拆分" |

## 执行流程

### Step 1: 确定目标项目

```bash
# 默认使用当前工作目录
PROJECT_PATH="${1:-$(pwd)}"
```

若用户指定了项目路径，使用指定路径。否则使用当前 `cwd`。

### Step 2: 确定领域

根据项目特征自动判断，或接受用户指定：

| 特征 | 领域 |
|------|------|
| 包含 `src/pages/`、`src/components/`、`app/`（React/Next.js） | `frontend` |
| 包含 `routes/`、`handlers/`、`controllers/`、`api/` | `backend` |
| 其他 | `general` |

用户也可直接指定："用 backend 领域检查"。

### Step 3: 运行适应度检测

```bash
python3 ~/.claude/hooks/architecture-fitness.py --path "$PROJECT_PATH" --domain "$DOMAIN" --format json
```

### Step 4: 解读结果并格式化输出

读取 JSON 输出，生成用户可读的健康报告：

```markdown
## 架构健康度报告

**项目**: {project_path}
**检测领域**: {domain}
**评估阶段**: {current_stage_chinese}

### 指标概览

| 指标 | 值 | 阈值 | 状态 |
|------|---|------|------|
| 最大文件行数 | {value} | 200 | {pass/fail} |
| 最大函数数/文件 | {value} | 15 | {pass/fail} |
| 重复函数名 | {value} | 2 | {pass/fail} |
| ... | ... | ... | ... |

### 触发的升级信号 ({count})

{每个 triggered_upgrade 的详细说明}

### 建议

{recommendations 列表}

### 阶段判断

{根据 current_stage 给出的行动指导}
```

### Step 5: 阶段判断说明

根据检测结果的 `current_stage` 字段，给出对应的行动指导：

| current_stage | 中文 | 行动指导 |
|---------------|------|----------|
| `bootstrap` | 健康的起步期 | 当前架构适合项目规模，无需升级。继续按现有方式开发。 |
| `needs_growth` | 建议进入成长期 | 部分指标超标，建议做小范围架构调整（< 5 文件）。优先处理最严重的指标。 |
| `needs_structured` | 建议进入成熟期 | 多项指标严重超标，建议做架构分层升级。可能需要拆分为多次小手术。 |

### Step 6: 给出优先级排序

当有多个触发信号时，按以下优先级排序建议：

1. 文件行数超标（最直接的膨胀信号）
2. 重复代码模式（复用需求最迫切）
3. 函数数量超标（职责过多）
4. import 数量超标（依赖过宽）
5. 目录失衡（结构不均匀）
6. 领域特定问题（直接 API 调用、裸 SQL 等）

## 输出示例

```markdown
## 架构健康度报告

**项目**: /Users/me/my-app
**检测领域**: frontend
**评估阶段**: 建议进入成长期

### 指标概览

| 指标 | 值 | 阈值 | 状态 |
|------|---|------|------|
| 最大文件行数 | 245 | 200 | ⚠ 超标 |
| 最大函数数/文件 | 18 | 15 | ⚠ 超标 |
| 重复函数名 | 1 | 2 | ✓ 正常 |
| 最大 import 数/文件 | 8 | 10 | ✓ 正常 |

### 触发的升级信号 (2)

1. `src/pages/Dashboard.tsx` 245 行 > 200 行阈值
   → 建议：抽离可复用逻辑到 hook 或 service

2. `src/pages/Dashboard.tsx` 18 个函数 > 15 个阈值
   → 建议：按职责拆分为多个模块

### 建议

当前项目处于 **Bootstrap → Growth 过渡期**。建议：
1. 优先拆分 `Dashboard.tsx`，预计涉及 2-3 个文件
2. 抽出的逻辑优先放入项目已有的 `hooks/` 或 `lib/` 目录
3. 单次重构控制在 < 5 文件
```

## 与现有规则的配合

| 规则/技能 | 配合方式 |
|-----------|----------|
| `rules/core/architecture-evolution.md` | 本 skill 是该规范的可执行检测入口 |
| `rules/core/project-architecture-first.md` | 进入新项目时可先运行本 skill 获取基线 |
| `rules/domain/frontend/ui-logic-boundary.md` | frontend 领域的阈值来源 |
| `rules/domain/backend/architecture-stages.md` | backend 领域的阈值来源 |
| `rules/domain/shared/architecture-stages.md` | general 领域的阈值来源 |
| `skills/shit` | shit 关注治理资产结构精简；本 skill 关注项目代码架构 |

## 注意事项

- 本 skill 只做分析和建议，不自动修改代码
- 阈值不是铁律：接近但未超标时也值得关注
- 第三方库、生成的代码、vendor 目录会被自动跳过
- 对于 monorepo，建议对每个 package 单独运行

## 相关技能

- [[shit]] - 治理资产结构精简
- [[freeze]] - 冷热存储管理
- [[orchestrate]] - 当升级建议需要拆分多任务时使用
