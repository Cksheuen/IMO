---
paths:
  - "src/**/*"
  - "lib/**/*"
  - "app/**/*"
  - "server/**/*"
  - "api/**/*"
---

# 主动委派决策框架

> 来源：brainstorm 调研（JetBrains Research、dev.to、Claude Code Docs）| 吸收时间：2026-03-26

## 核心原则

**预防优于补救：在上下文膨胀发生前主动委派**

| 对比维度 | 事后处理 | 主动委派 |
|---------|---------|---------|
| **时机** | 上下文已膨胀后 | 任务开始前评估 |
| **范围** | 跨会话恢复 | 会话内预防 |
| **成本** | 高（需 Handoff/Reset） | 低（仅委派决策） |

## Delegation Capability Boundary（Hermes 对标，流程层）

> 当前只落地在 rule + skill + gate 约束层，**不代表已经具备 Hermes 完整 delegation runtime**（如完整 capability sandbox、受控执行基座、统一回流总线）。

### 核心补充

- **capability isolation ≠ worktree isolation**：worktree 只隔离文件工作区，不自动隔离工具权限、外部副作用、共享状态写入权限。
- **默认拒绝高副作用能力**：子 agent 默认不允许递归委派、不允许改共享治理资产、不允许执行外部不可逆动作。
- **默认 summary-only 回流**：子 agent 向父 agent 返回摘要与证据路径，而不是完整中间过程/长日志。
- **深度预算必须显式声明**：默认只允许 `parent -> child` 单层委派；需要更深层时必须显式授权并记录理由。

## 触发条件

当接收到任务后，**执行前**评估任务规模：

| 评估维度 | 高风险阈值 | 权重 |
|---------|-----------|------|
| **文件数量预估** | > 5 文件 | 高 |
| **代码行数预估** | > 500 行 | 高 |
| **领域数量** | > 2 领域（前端/后端/数据库/测试等） | 中 |
| **后续任务** | 有明确的后续任务 | 中 |

## 决策框架

```
评估任务规模
    │
    ├─ 高风险项 ≥ 2
    │       │
    │       ├─ 子任务独立 → 并行 Subagent
    │       │
    │       └─ 子任务有依赖 → 链式 Subagent
    │
    ├─ 高风险项 = 1
    │       │
    │       └─ 考虑委派（参考复杂度）
    │
    └─ 无高风险 → 直接执行
```

## 执行规范

### Step 1: 任务规模评估

在 Plan 阶段完成后，评估：
- 需要创建/修改多少文件？
- 预估代码量多少？
- 涉及哪些领域？
- 是否有后续任务？

### Step 2: 触发委派

若触发主动委派：

```yaml
委派配置:
  拆分策略:
    - 按领域拆分（前端/后端/数据库）
    - 按文件边界拆分（确保无共享文件冲突）

  Subagent 类型选择:
    - 研究任务 → subagent_type: "research"
    - 实现任务 → subagent_type: "implement"
    - 调试任务 → subagent_type: "debug"

  隔离策略:
    - > 3 个并行 Subagent → 考虑 git worktree

  能力边界（默认）:
    allow_recursive_delegation: false
    max_delegation_depth: 1
    shared_state_write: deny
    high_side_effect_actions: deny
    return_mode: summary_only
```

### Step 2.1: 绑定 capability contract（必做）

每个 subagent prompt 里必须包含边界字段，不得只写“请实现”：

- 允许写入范围（file ownership）
- 明确禁止项（递归 delegation、共享状态写入、高副作用动作）
- `max_delegation_depth`
- `return_mode: summary_only`

若子任务确实要突破默认边界，必须满足三条：
- 同一根因链路必须如此
- 在 prompt 中显式标注 override（例如 `[ALLOW_SHARED_STATE_WRITE]`）
- 在汇报中记录“为什么要扩边界”

### Step 3: 汇报聚合

Subagent 完成后，收集标准化汇报：

```markdown
## Subagent 汇报

### 完成项
- [x] 具体完成的功能/修复

### 关键决策
- 决策: 理由

### 文件变更
- file.ts: 变更摘要

### 证据路径
- task artifacts / test logs 路径

### 遗留问题
- 问题: 描述
```

汇报默认使用 **summary-only**：
- 返回结论、关键证据、风险、下一步
- 不回传完整中间日志或冗长推理过程

### Step 4: 综合输出

主 Agent 汇总所有 Subagent 汇报，输出给用户：
- 整体进度
- 关键决策汇总
- 遗留问题清单
- 下一步建议

## 与现有规则的关系

| 规则 | 关系 | 协作方式 |
|------|------|----------|
| [[long-running-agent-techniques]] | **互补** | 主动委派（会话内预防）+ Harness（跨会话恢复） |
| [[generator-evaluator-pattern]] | **增强** | 复杂任务可用 Subagent 做 Generator，主 Agent 做 Evaluator |
| [[context-injection]] | **关联** | 按需注入上下文 + 主动委派避免膨胀 |

## 检查清单

- [ ] 是否在执行前评估了任务规模？
- [ ] 是否触发了主动委派？
- [ ] 是否选择了正确的 Subagent 类型？
- [ ] 是否显式声明了 capability contract（而不仅是 worktree）？
- [ ] 是否限制了 delegation depth（默认 1）？
- [ ] 是否禁止了默认共享状态写入与高副作用动作？
- [ ] 子 agent 返回是否保持 summary-only（无中间过程污染）？
- [ ] 是否收集了标准化汇报？
- [ ] 是否更新了任务状态文件？

## 参考

- [JetBrains Research - Smarter Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [dev.to - Why One AI Agent Isn't Enough](https://dev.to/octomind_dev/why-one-ai-agent-isnt-enough-subagent-delegation-and-context-drift-195o)
- [Claude Code Sub-Agents Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices)
