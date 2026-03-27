# 主动委派决策框架

> 来源：brainstorm 调研（JetBrains Research、dev.to、Claude Code Docs）| 吸收时间：2026-03-26

## 核心原则

**预防优于补救：在上下文膨胀发生前主动委派**

| 对比维度 | 事后处理 | 主动委派 |
|---------|---------|---------|
| **时机** | 上下文已膨胀后 | 任务开始前评估 |
| **范围** | 跨会话恢复 | 会话内预防 |
| **成本** | 高（需 Handoff/Reset） | 低（仅委派决策） |

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
```

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

### 遗留问题
- 问题: 描述
```

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
- [ ] 是否收集了标准化汇报？
- [ ] 是否更新了任务状态文件？

## 参考

- [JetBrains Research - Smarter Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [dev.to - Why One AI Agent Isn't Enough](https://dev.to/octomind_dev/why-one-ai-agent-isnt-enough-subagent-delegation-and-context-drift-195o)
- [Claude Code Sub-Agents Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices)
