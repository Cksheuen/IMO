# Promotion Scan Execution Bridge

- Status: proposed
- Date: 2026-03-27
- Trigger: 需要把自动晋升从“发现信号”推进到“可执行的完整评估链”

## 问题

当前已经有 `promotion-scan.py` 在 `Stop` / `SubagentStop` 上执行轻量扫描，但它目前只负责发现候选 note。

如果没有一个稳定的执行桥：

- 自动扫描只能输出提示
- `promote-notes` 仍需要重新扫描
- 自动触发链路会停在“知道要做”，但没继续做完

## 目标

- 让 `promotion-scan.py` 输出结构化结果
- 让 `promote-notes` 可以直接消费这些结果
- 把“扫描候选”与“执行晋升评估”连接成稳定接口

## 桥接协议

`promotion-scan.py` 输出：

```json
{
  "decision": "allow",
  "reason": "...",
  "promotionScan": {
    "hasCandidates": true,
    "candidates": [
      {
        "path": "notes/lessons/xxx.md",
        "signal": "candidate-rule"
      }
    ]
  }
}
```

`promote-notes` 在自动调用时应遵循：

1. 若输入中已有 `promotionScan.candidates`，直接以这些候选为入口
2. 仅在候选为空时才回退到全量扫描
3. 每个候选按原有晋升流程做资格判断、去向决策、去重检查

当前最小落地协议已经收敛为：

1. `promotion-scan.py` 发现候选并写入 `promotion-queue.json`
2. `promotion-dispatch.py claim` 将 `pending/failed` 候选标记为 `processing`
3. 主 agent / orchestrator 根据 `claim` 输出派发 `promote-notes` subagent
4. subagent 写出 `promotion-result.json`
5. subagent 调用 `promotion-apply-result.py`，内部转发到 `promotion-dispatch.py apply`
6. 若 subagent 异常退出，则主链路调用 `promotion-dispatch.py fail` 恢复 queue

其中 queue 是主 agent 与 subagent 之间的事实源。

最小 `claim` 输出示例：

```json
{
  "promotionDispatch": {
    "subagentType": "promote-notes",
    "queuePath": "promotion-queue.json",
    "hasCandidates": true,
    "candidates": [
      {
        "path": "notes/lessons/xxx.md",
        "signal": "candidate-rule",
        "status": "processing"
      }
    ],
    "prompt": "..."
  }
}
```

最小 `promotion-result.json` 示例：

```json
{
  "promotionDispatchResult": {
    "status": "completed",
    "processed": [
      {
        "path": "notes/lessons/xxx.md",
        "outcome": "promoted-rule",
        "target": "rules",
        "targetPath": "rules/..."
      }
    ],
    "deferred": [],
    "failed": []
  }
}
```

## 分层职责

- `promotion-scan.py`：快扫描，只负责发现候选和给出结构化信号
- 主 agent：维护 queue、守门、决定是否必须继续 Promotion Loop
- `promote-notes` subagent：慢判断，负责真正决定晋升去向并更新资产

## 执行隔离

完整晋升动作默认不在主 agent 中直接执行，而是交给独立 subagent。

原因：

- 晋升评估需要读取多个 note / rule / skill / memory
- 可能修改多处知识资产
- 容易污染用户当前主任务的上下文

因此推荐链路是：

1. hook 扫描发现候选
2. 主 agent 写入 queue，并在结束前做 gate
3. 若必须继续晋升，主 agent 派发 `promote-notes` subagent
4. subagent 完成评估、更新资产、清理或更新 queue

## 结论

这条桥接层的意义，不是增加新概念，而是防止自动晋升链路停在“提示”阶段。

它把：

- 自动扫描
- 候选传递
- 完整评估

串成一条可持续扩展的执行链。
