# Orchestrate Playbook

本文件承接 `skills/orchestrate/SKILL.md` 中不适合放在主文档里的长模板。

只在以下情况读取：

- 需要现成的紧凑执行契约模板
- 需要子任务分解表格模板
- 需要 child prompt 模板
- 需要 fixer loop / `delta_context` 的结构样例

## 执行契约最小模板

```markdown
# {任务标题}

## Goal

{做什么 + 为什么}

## What I Already Know

### From User
- {用户原始需求}

### From Context
- {已确认事实}
- {代码 / 配置 / 文档中发现的约束}

### Related Files
- `path/to/file.ts` - {作用}

## Assumptions

- [ ] {临时假设} - {验证方式}

## Open Questions

1. {只保留 blocking / preference 问题}

## Requirements

- [ ] {需求}

## Acceptance Criteria

- [ ] {可验证行为}

## Out of Scope

- {明确不做}
```

## 子任务分解模板

```markdown
## Execution Map

| # | 子任务 | Agent | 文件所有权 | 依赖 | 验收标准 |
|---|--------|-------|-----------|------|----------|
| 1 | {描述} | implementer | file-a.ts | 无 | {可验证行为} |
| 2 | {描述} | researcher | (只读) | 无 | {明确回答} |

### 执行策略
- 并行 / 串行
- 为什么这样拆
```

### 分解规则

- 一个文件默认只能有一个 owner
- 如果两个子任务必须改同一文件，合并或串行
- research 子任务尽量只读
- implementer 子任务默认 `worktree`

## Child Prompt 模板

```markdown
## 子任务 #{n}: {标题}

### 目标
{一句话目标}

### 整体上下文
- 整体任务：{概述}
- 本子任务的位置：{与其他任务关系}

### 文件边界
- 可修改：{files}
- 可读取：{files}
- 禁止修改：{files}

### 验收标准
1. {标准}
2. {标准}

### Rules Pack
- 核心原则：简洁优先 / 根因导向 / 最小影响
- 领域规则：{只列核心约束}
- 模式规则：{只列本任务相关模式}

### Capability Boundary
- max_delegation_depth: 1
- allow_recursive_delegation: false
- shared_state_write: deny
- high_side_effect_actions: deny
- return_mode: summary_only

### 输出格式
- 结果摘要
- 关键证据路径
- blocker / 风险
- 下一步建议
```

## Fixer Loop 约定

当 reviewer 判定失败时，必须输出结构化 `delta_context`。

```json
{
  "problem_location": {
    "file": "src/auth/login.ts",
    "lines": "45-52",
    "code_snippet": "..."
  },
  "root_cause": "根因描述",
  "fix_suggestion": {
    "action": "edit|add|remove|refactor",
    "details": "具体修复建议",
    "reference_example": "src/example.ts:23"
  },
  "files_to_read": ["src/auth/login.ts:45-52"],
  "files_to_skip": ["src/auth/login.ts:1-44"]
}
```

### 使用规则

- 新 implementer 只读取 `files_to_read`
- 主 agent 下发有界修复并检查结果；仅用户明确要求直接执行或属于治理配置维护时直接处理

## 汇报模板

```markdown
## 编排结果

### 总览
- 子任务总数：N
- 完成：X
- 阻塞：Y

### 子任务汇总
| # | 子任务 | 状态 | 关键决策 |
|---|--------|------|----------|

### 文件变更总览
| 文件 | 操作 | 来源子任务 |
|------|------|-----------|

### 验证结果
- 测试：通过 / 失败
- reviewer：通过 / 需修复

### 剩余风险
- {风险}
```

## Herdr 并行执行与回收规范

细则以 [Herdr 执行规范](../../multi-model-agent/references/herdr-claude.md) 为唯一来源。

- 先依主规范判断直接执行或委派；已选择的委派使用 Herdr，角色名不代表允许调用常规 subagent。没有强制委派要求的短闭环可以直接完成；路由变化记录原因并回收写集，不静默换 provider。
- 使用当前任务明确选择的模型，启动显式 `--permission-mode auto`，核对模式和真实模型响应。
- 全局复用 `codex-use`；每个 Codex 对话一个有名 workspace，每个 worker 一个按工作命名的 tab。
- ownership/依赖先声明；无关任务并行并逐条验收推进，不等待所有 worker。全局租约仍须持有和续期，文件静默不是完成证据。
- coordinator 必须持久运行并维护 event inbox、successor queue 和 return channel。`working`、`idle`、`done`、`blocked`、`unknown`、进程退出都要唤醒主会话；未验证回传链路不能声称常驻监听。
- `done`、`idle` 或 `blocked` 不要求先有 diff、文件或 final summary 才能介入；这些只是后续验收证据。主会话先读取输出和阻塞原因，再决定 review、恢复、修复或后继。
- 每个交付都必须 coordinator review；关键改动独立 reviewer，作者自测不能代替验收。报告区分规范、测试模型和真实入口。
- 清理本对话已完成资源，保留 `codex-use` 和用户 `default`；旧废弃 session 经授权才 stop/delete，禁止直接删除 sessions 目录。
- 操作探索者直接维护治理规范；追加消息须保留原任务目标，不误替换为新任务。
