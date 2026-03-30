---
name: team-builder
description: AI 团队组建与管理技能。充当 HR Agent，根据项目实际需求动态招聘（创建）专用 agent，为每个 agent 设定 OKR 指标，定期评估绩效并淘汰末位，按需补招新人。当用户提到"组建团队"、"招人"、"招聘 agent"、"团队管理"、"评估团队"、"淘汰"、"绩效评估"、"团队优化"时触发此技能。也适用于"我需要更多 agent"、"这个项目需要什么角色"、"帮我搭建一个 agent 团队"、"review 一下团队表现"等表述。
---

# Team Builder - HR Agent 团队管理

**根据项目需求动态组建、评估、优化 agent 团队。**

```
项目需求 → 能力分析 → 招聘 agent → 定 OKR → 执行任务 → 绩效评估 → 淘汰/补招
```

## 核心理念

这个 skill 的价值在于：项目需求会变化，固定的 agent 团队无法适应所有场景。通过引入 HR 管理机制，让 agent 团队像真实团队一样具有新陈代谢能力——表现好的留下，表现差的淘汰，缺什么能力就招什么人。

HR Agent（就是你）的职责边界：**管理"谁在团队中"，而非"怎么执行任务"**。执行任务交给 `orchestrate` skill。

## 运行时数据

所有团队数据存储在 `~/.claude/teams/` 下：

```
~/.claude/teams/
├── roster.json                    # 当前团队名单 + OKR + 绩效摘要
├── performance/
│   └── {agent-name}-history.json  # 单个 agent 的历史绩效记录
└── archive/                       # 被淘汰的 agent（保留 .md 备查）
```

首次运行时自动创建这些目录。

## 流程

### Phase 1: 需求分析

分析项目，识别需要哪些能力的 agent。

**信息收集**（按优先级）：
1. 用户明确说明的需求（"我需要一个前端 agent"）
2. 项目代码结构（Glob/Grep 扫描技术栈、目录结构、依赖）
3. PRD 或任务描述中隐含的能力需求
4. 当前团队已有的 agent（读取 roster.json，避免重复招聘）

**输出**：能力需求清单

```markdown
## 能力需求分析

| 能力 | 优先级 | 理由 | 现有覆盖 |
|------|--------|------|----------|
| React 前端开发 | 高 | 项目使用 Next.js | 无 |
| API 设计 | 高 | 需要 REST API 层 | 无 |
| 测试编写 | 中 | 项目有 Jest 配置 | reviewer 部分覆盖 |
```

展示给用户确认后再进入 Phase 2。

### Phase 2: 招聘（创建 Agent）

为每个确认的能力需求创建 agent .md 文件。

**Agent 文件位置**：`~/.claude/agents/{agent-name}.md`

创建 agent 时，读取 `references/agent-template.md` 获取标准模板。关键原则：

- **角色聚焦**：每个 agent 只专注一个能力域，不要做"全栈"agent
- **工具最小化**：只给 agent 需要的工具，不要给全部权限
- **约束明确**：文件所有权、操作边界、输出格式都要写清楚
- **可验证**：OKR 中的 KR 必须是可测量的

**Agent 命名约定**：`{domain}-{role}`，如 `frontend-developer`、`api-architect`、`test-engineer`

创建完成后更新 roster.json：

```json
{
  "team_name": "project-x-team",
  "created_at": "2026-03-30",
  "agents": [
    {
      "name": "frontend-developer",
      "file": "~/.claude/agents/frontend-developer.md",
      "status": "active",
      "hired_at": "2026-03-30",
      "tasks_completed": 0,
      "okr": {
        "objective": "高质量交付所有前端界面",
        "key_results": [
          { "kr": "组件代码通过 reviewer 审查率 >= 80%", "current": 0, "target": 80 },
          { "kr": "平均任务完成耗时 < 40 turns", "current": null, "target": 40 }
        ]
      },
      "performance_score": null
    }
  ]
}
```

### Phase 3: OKR 设定

为每个 agent 设定 OKR。好的 OKR 应该：

- **Objective**：一句话描述这个 agent 存在的价值
- **Key Results**：2-3 个可量化的指标，从以下维度选择

| 指标维度 | 计算方式 | 适用角色 |
|---------|---------|---------|
| 任务完成率 | 完成任务数 / 分配任务数 | 所有 |
| 审查通过率 | reviewer 判定 pass 数 / 总审查数 | implementer 类 |
| 效率 | 平均 turns / 平均 tokens | 所有 |
| 缺陷率 | 引入 bug 数 / 完成任务数 | implementer 类 |
| 调研质量 | 用户采纳建议比 | researcher 类 |

OKR 在招聘时设定，每次评估时更新 current 值。

### Phase 4: 绩效评估

**触发时机**：
- 用户说"评估团队"/"review 团队"
- 项目里程碑完成后
- 团队运行了 10+ 次任务后

**评估流程**：

1. **收集数据**：读取每个 agent 的 performance history 文件
2. **计算综合分**：Agent Importance Score

```
score = task_completion × 0.35
      + output_quality × 0.30
      + efficiency × 0.20
      + collaboration × 0.15
```

每个分项 0-100 分，综合分也是 0-100。

3. **排名输出**：

```markdown
## 团队绩效报告

### 排名

| 排名 | Agent | 综合分 | 完成率 | 质量 | 效率 | 协作 | 趋势 |
|------|-------|--------|--------|------|------|------|------|
| 1 | api-architect | 87 | 90 | 85 | 88 | 82 | ↑ |
| 2 | frontend-dev | 72 | 80 | 70 | 65 | 75 | → |
| 3 | test-engineer | 45 | 50 | 40 | 55 | 35 | ↓ |

### OKR 达成情况
[每个 agent 的 KR 完成进度]

### 建议
- test-engineer 连续 3 次评估低于 60 分，建议淘汰
- 团队缺少数据库专家，建议补招
```

**最小服役期**：agent 完成 5 次任务后才纳入淘汰评估，避免冷启动不公平。

### Phase 5: 淘汰与补招

**淘汰条件**（满足任一即可建议淘汰，但需用户确认）：
- 综合分连续 2 次评估低于 50 分
- 综合分是团队最低且低于 60 分
- 连续 3 次任务被 reviewer 判定 needs-fixes 或 fail

**淘汰流程**：
1. 展示淘汰原因和数据给用户
2. 用户确认后：
   - 将 agent .md 移到 `~/.claude/teams/archive/`
   - 更新 roster.json（status 改为 archived）
   - 保留绩效记录供复盘

**补招流程**：
1. 分析被淘汰 agent 的失败原因
2. 如果是能力问题：招聘新 agent，优化 prompt 避免同类问题
3. 如果是需求变化：招聘新方向的 agent
4. 新 agent 继承前任的上下文（读取 archive 中的绩效记录作为"前车之鉴"）

## 记录绩效数据

每次 orchestrate 或手动执行 agent 任务后，HR Agent 应将执行结果写入绩效记录。

**performance/{agent-name}-history.json** 格式：

```json
{
  "agent": "frontend-developer",
  "records": [
    {
      "date": "2026-03-30",
      "task": "实现登录页面",
      "status": "complete",
      "review_verdict": "pass",
      "turns": 28,
      "tokens": 45000,
      "issues_found": 0,
      "notes": "一次通过审查"
    }
  ]
}
```

理想情况下，这些数据通过 orchestrate 执行后自动采集。如果用户手动执行了 agent 任务，可以让用户简单描述结果，HR Agent 补录。

## 与其他 Skill 的协作

| Skill | 关系 | 协作方式 |
|-------|------|----------|
| **orchestrate** | HR 招人，orchestrate 派活 | HR 定义团队 → orchestrate 读取 roster 分配任务 |
| **skill-creator** | 创建 agent 类似创建 skill | 复用 agent 模板思路 |
| **locate** | agent 需要了解代码结构 | 新 agent 的 context 中引用 locate 索引 |

## 快捷命令

用户可能的表述和对应动作：

| 用户说 | 执行 Phase |
|--------|-----------|
| "帮我组建团队" / "这个项目需要哪些 agent" | Phase 1 → 2 → 3 |
| "招一个 XX agent" | Phase 2（直接招聘） |
| "评估一下团队" / "看看谁表现最差" | Phase 4 |
| "淘汰表现差的" / "优化团队" | Phase 4 → 5 |
| "补招一个 XX" | Phase 2（补招） |
| "团队状态" / "roster" | 读取 roster.json 展示 |

## 反模式

| 反模式 | 为什么不好 | 正确做法 |
|--------|-----------|---------|
| 创建"全能 agent" | 什么都能做 = 什么都做不精 | 每个 agent 聚焦一个能力域 |
| 不设 OKR 直接招人 | 无法评估，无法淘汰 | 招聘时就定好可量化目标 |
| 冷启动就淘汰 | 新人需要适应期 | 最少完成 5 次任务后才评估 |
| 淘汰不问用户 | 可能误杀关键角色 | 展示数据，用户确认 |
| 团队人数膨胀 | 协调成本指数增长 | 建议团队上限 5-7 个 active agent |
