# 绩效评估指标体系

## Agent Importance Score

综合评分公式：

```
score = task_completion × 0.35 + output_quality × 0.30 + efficiency × 0.20 + collaboration × 0.15
```

每个分项 0-100 分。

## 分项计算方式

### 1. Task Completion（任务完成率）- 权重 35%

```
score = (完成任务数 / 分配任务数) × 100
```

| 状态 | 计分 |
|------|------|
| complete | 1.0 |
| partial | 0.5 |
| blocked（自身原因）| 0.0 |
| blocked（外部原因）| 不计入 |

### 2. Output Quality（输出质量）- 权重 30%

基于 reviewer 评审结果：

| 审查结果 | 计分 |
|---------|------|
| pass（一次通过）| 100 |
| pass（修复后通过）| 70 |
| needs-fixes | 40 |
| fail | 0 |

```
score = 所有任务质量分的加权平均（近期权重更高）
```

时间衰减：最近 5 次任务权重为 [5, 4, 3, 2, 1]（最新的权重最高）。

### 3. Efficiency（效率）- 权重 20%

基于 turns 和 tokens 消耗：

```
turns_score = max(0, 100 - (avg_turns - target_turns) / target_turns × 50)
tokens_score = max(0, 100 - (avg_tokens - target_tokens) / target_tokens × 50)
score = turns_score × 0.6 + tokens_score × 0.4
```

target 值来自 agent 的 OKR 或团队平均值。

### 4. Collaboration（协作）- 权重 15%

| 指标 | 正向 | 负向 |
|------|------|------|
| 报告质量 | 报告格式完整、信息充分 | 报告缺失关键信息 |
| Blocker 处理 | 清晰描述 blocker 和建议 | 不报告 blocker 直接跳过 |
| 文件所有权 | 只改自己负责的文件 | 越界修改其他文件 |
| 决策记录 | 记录关键决策和理由 | 不记录，后续无法追溯 |

协作分通常由 HR Agent 在读取任务报告时主观评分（0-100），参考上述维度。

## 评估周期

| 类型 | 频率 | 动作 |
|------|------|------|
| 即时记录 | 每次任务后 | 写入 performance history |
| 周期评估 | 每 10 次任务或用户触发 | 计算综合分，更新 OKR |
| 淘汰评估 | 周期评估时 | 检查淘汰条件 |

## 淘汰阈值

| 条件 | 阈值 | 说明 |
|------|------|------|
| 绝对低分 | 综合分 < 50（连续 2 次） | 持续表现不佳 |
| 相对末位 | 团队最低且 < 60 | 团队内相对最差 |
| 审查失败 | 连续 3 次 needs-fixes/fail | 质量持续不达标 |
| 最小服役期 | 5 次任务 | 冷启动保护 |

## 数据可靠性

绩效数据来源优先级：

1. **orchestrate 自动采集**：最可靠，有完整的任务报告和 reviewer 评审
2. **手动执行后补录**：用户描述结果，HR Agent 记录
3. **推断**：从 git log 或文件变更推断（最不可靠，仅作参考）

当数据不足时（< 3 次任务），综合分标记为"待评估"，不纳入排名。
