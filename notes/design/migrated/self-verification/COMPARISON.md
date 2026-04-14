# Self-Verification Mechanism: Claude Code vs LangGraph 对照

本文档记录 Claude Code 的 Self-Verification Mechanism 到 LangGraph 的迁移对照。

## 概念映射

| Claude Code 概念 | LangGraph 概念 | 说明 |
|-----------------|---------------|------|
| Feature List JSON | `State(TypedDict)` | 类型化的状态定义 |
| Verification Gate | `interrupt_before` + 条件边 | 暂停执行并等待外部输入 |
| Stop Hook | `interrupt_before` | 在特定节点前暂停 |
| Fixer Loop | 条件边 + 循环回边 | `implementer -> gate_check` |
| delta_context | State 字段 | 存储在 `Feature.delta_context` |
| max_attempts | State 字段 + 条件检查 | `Feature.max_attempts` + `attempt_count >= max_attempts` |
| Gate Decision | 条件边函数返回值 | 路由到不同节点 |

## 架构对照

### Claude Code: Stop Event Pipeline

```
Stop hook 触发
    │
    ├─ stop_hook_active = true → 允许退出
    ├─ 无 feature-list.json → 允许退出
    ├─ status = "completed" → 允许退出
    ├─ pending = 0 → 允许退出
    ├─ 有 feature 超过 max_attempts → 允许退出
    ├─ 有 passes = false → spawn implementer
    └─ 有 passes = null → spawn reviewer
```

### LangGraph: StateGraph

```
START ──► gate_check ──► [route_after_gate]
                │              │
                │              ├─ exit_completed ──► mark_completed ──► END
                │              ├─ exit_max_attempts ──► mark_blocked ──► END
                │              ├─ trigger_reviewer ──► reviewer ──► [route_after_reviewer]
                │              │                                    ├─ gate_check (循环)
                │              │                                    └─ mark_completed
                │              │
                │              └─ trigger_fixer ──► implementer ──► gate_check (循环)
                │
                ▼
          [interrupt_before]
```

## 关键实现差异

### 1. Feature List 状态管理

**Claude Code:**

```json
{
  "features": [
    {
      "id": "F001",
      "passes": null,
      "attempt_count": 0,
      "delta_context": null
    }
  ]
}
```

**LangGraph:**

```python
class Feature(TypedDict):
    id: str
    passes: Optional[bool]
    attempt_count: int
    delta_context: Optional[DeltaContext]
```

### 2. Verification Gate 实现

**Claude Code:**

```bash
# Stop hook (verification-gate.sh)
if [ "$stop_hook_active" = "true" ]; then
  exit 0  # 允许退出
fi

if [ "$pending" -eq 0 ]; then
  exit 0  # 允许退出
fi

if [ "$has_failed" = "true" ]; then
  echo "VERIFICATION_FAILED"
  exit 2  # 阻止退出
fi
```

**LangGraph:**

```python
def gate_check(state: VerificationGateState) -> dict:
    if state.get("stop_hook_active", False):
        return {"gate_decision": "exit_completed"}

    if not pending_features and not failed_features:
        return {"gate_decision": "exit_completed"}

    if failed_features:
        return {"gate_decision": "trigger_fixer"}

    if pending_features:
        return {"gate_decision": "trigger_reviewer"}
```

### 3. Fixer Loop

**Claude Code:**

```
reviewer 发现问题
    │
    ├─ 填充 delta_context
    │
    └─ verification-gate 检测
          │
          └─ 输出 VERIFICATION_FAILED
                │
                └─ 主 agent 读取 delta_context
                      │
                      └─ spawn implementer
                            │
                            └─ 完成后重置 passes = null
                                  │
                                  └─ 触发 reviewer 再次验证
```

**LangGraph:**

```python
# 条件边
builder.add_conditional_edges(
    "implementer",
    route_after_implementer,
    {"gate_check": "gate_check"},  # 循环回 gate_check
)

# implementer 节点重置状态
def implementer(state: VerificationGateState) -> dict:
    updated_f = {
        **feature,
        "passes": None,  # 重置为待验证
    }
    return {"feature_list": {...}}
```

### 4. Interrupt + Resume 模式

**Claude Code:**

```
Stop hook 触发 → 检测 pending features → 阻止退出 → 主 agent spawn reviewer
```

**LangGraph:**

```python
# 编译时设置 interrupt_before
self.graph = builder.compile(
    checkpointer=self.checkpointer,
    interrupt_before=["reviewer", "implementer"],
)

# 恢复执行
def resume_with_input(self, thread_id, node_name, input_data):
    from langgraph.types import Command
    result = self.graph.invoke(
        Command(resume=input_data),
        config,
    )
    return result
```

## 迭代保护机制

### Claude Code

- `attempt_count >= max_attempts` 时标记 feature 为需要人工干预
- Stop hook 检测并允许退出

### LangGraph

- `max_iterations` 全局迭代上限
- `Feature.max_attempts` 单 feature 上限
- `route_after_gate` 条件边检测超限

## 状态持久化

### Claude Code

- Feature List 存储在 `feature-list.json` 文件
- Bash 脚本读写 JSON

### LangGraph

- State 存储在 MemorySaver 或自定义 checkpointer
- 支持 thread_id 隔离多个任务

## 外部集成

### Claude Code

- 主 agent 在 Stop hook 阻止退出后手动 spawn subagent
- reviewer.md 定义 reviewer agent 行为

### LangGraph

- `interrupt_before` 自动暂停
- 外部系统通过 `Command(resume=...)` 注入结果
- 可与任何 LLM/工具集成

## 优势对比

### Claude Code 优势

1. **简单直接** - Bash 脚本 + JSON 文件
2. **人类可读** - feature-list.json 可直接查看编辑
3. **与 CC 生态集成** - Stop hook、subagent 原生支持

### LangGraph 优势

1. **类型安全** - TypedDict 编译时检查
2. **可视化** - 可生成 graph 图
3. **可扩展** - 易于添加新节点和边
4. **持久化** - 内置 checkpointer 支持
5. **可组合** - 可作为子图嵌入更大系统

## 迁移建议

1. **保留语义** - 保持 Gate Decision、delta_context 等核心概念
2. **利用 LangGraph 特性** - interrupt_before、Command(resume=...)
3. **渐进迁移** - 可先用 LangGraph 实现 Gate，再逐步迁移 Reviewer/Implementer
4. **保持接口兼容** - 外部系统仍可通过 thread_id + resume 模式交互

## 文件对照

| 原 Claude Code 文件 | LangGraph 对应 |
|-------------------|---------------|
| `feature-list.json` | `state.py: FeatureList` |
| `verification-gate.sh` | `nodes.py: gate_check()` |
| `reviewer.md` | `nodes.py: reviewer()` + 外部 LLM |
| (主 agent 逻辑) | `graph.py: VerificationGate.run()` |
| delta_context schema | `state.py: DeltaContext` |

## 参考

- 原 Claude Code 规范: `~/.claude/rules/pattern/self-verification-mechanism.md`
- LangGraph 文档: https://langchain-ai.github.io/langgraph/
