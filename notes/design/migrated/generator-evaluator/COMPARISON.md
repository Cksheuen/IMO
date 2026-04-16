# Generator-Evaluator Pattern: Claude Code vs LangGraph 对照

本文档记录 `generator-evaluator-pattern.md` 到 LangGraph 的最小迁移对照。

## 概念映射

| Claude Code 概念 | LangGraph 概念 | 说明 |
|-----------------|---------------|------|
| Generator | `generator` 节点 | 负责生成草稿 |
| Evaluator | `evaluator` 节点 | 只看输出和验收标准，不看内部思考 |
| 反馈循环 | 条件边 + 回边 | `evaluator -> apply_feedback -> generator` |
| 通过/失败判断 | `evaluation_result.status` | `passed / needs_revision / failed` |
| 最多 3-5 轮 | `review_round` + `max_rounds` | 状态里显式建模 |
| 验收标准 | `acceptance_criteria` | 进入图状态，供 evaluator 决策 |

## 架构对照

### Claude Code: 文档式规范

```text
Generator 输出
    │
    ▼
Evaluator 评估
    ├─ 通过 → 完成
    └─ 未通过 → 给出具体反馈 → Generator 修复 → 循环
```

### LangGraph: StateGraph

```text
START ──► generator ──► evaluator ──► [route_after_evaluator]
                                      │
                                      ├─ passed ──► mark_passed ──► END
                                      ├─ failed ──► mark_failed ──► END
                                      └─ needs_revision ──► apply_feedback ──► generator
```

## 关键实现差异

### 1. 文档约束变为显式状态

**Claude Code:**

- “Evaluator 不能看到 Generator 的内部思考过程”
- “最多循环 3-5 轮”
- “反馈必须具体可操作”

**LangGraph:**

- `GeneratorEvaluatorState` 显式保存 `review_round`、`max_rounds`
- `EvaluationFeedback` 结构化保存 `issues` 和 `actionable_changes`
- evaluator 只读取 `draft_output` 和 `acceptance_criteria`

### 2. 反馈闭环可执行化

**Claude Code:** 文档要求 agent 自觉执行闭环。

**LangGraph:** 条件边强制闭环路径，只要状态是 `needs_revision`，就一定回到 `generator`。

### 3. 可与更复杂图复用

该子图适合作为以下流程的基础构件：

- `orchestrate` 中需要品味判断的子任务
- `self-verification` 里的 reviewer / fixer 回路
- `long-running-agent-techniques` 里的阶段性质量门

## 当前边界

本迁移骨架只覆盖控制流，不覆盖：

- 真实 LLM 调用
- 真实评审 rubric
- 外部测试工具
- 人工中断审批

这些能力应在更高层 runtime 中按需接入。
