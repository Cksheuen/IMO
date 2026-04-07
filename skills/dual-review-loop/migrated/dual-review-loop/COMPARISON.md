# Dual Review Loop - LangGraph Migration Comparison

本文档记录 CC + Codex 双重审查循环从 Claude Code 技能迁移到 LangGraph 框架的映射关系。

## 概览

| 维度 | Claude Code (SKILL.md) | LangGraph (迁移后) |
|------|------------------------|-------------------|
| **执行引擎** | CC Harness + Agent 工具调用 | StateGraph + Nodes |
| **状态管理** | dual-review-report.json | DualReviewState (TypedDict) |
| **循环控制** | Shell script + max_rounds 判断 | 条件边 + State 字段 |
| **工具调用** | Bash 命令 + Agent subagent_type | Tool 封装 + RunnableLambda |
| **错误处理** | 报告中记录 | State.errors 累加 |

---

## Step-by-Step 映射

### Step 0: 初始化审查报告

**CC 实现**:
```bash
# 创建 dual-review-report.json
{
  "created_at": "<timestamp>",
  "max_rounds": 3,
  "scope": "auto",
  "current_round": 0,
  "status": "in_progress",
  "rounds": []
}
```

**LangGraph 实现**:
```python
# state.py
initial_state = create_initial_state(
    max_rounds=3,
    scope="auto",
    base=None,
    skip_rescue=False
)
# 返回 DualReviewState TypedDict
```

**映射关系**:
| CC 字段 | LangGraph State 字段 | 类型 |
|---------|---------------------|------|
| `created_at` | `created_at` | str |
| `max_rounds` | `max_rounds` | int |
| `scope` | `scope` | str |
| `base` | `base` | Optional[str] |
| `skip_rescue` | `skip_rescue` | bool |
| `current_round` | `current_round` | int |
| `status` | `status` | str |
| `rounds[]` | `rounds` | List[RoundResult] |

---

### Step 1: Codex Review

**CC 实现**:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review --wait [--scope <scope>] [--base <base>]
```

解析输出：
```yaml
verdict: approve | needs-attention
findings:
  - severity: critical | high | medium | low
    title: "..."
    file: "path"
    line_start: N
    line_end: N
    recommendation: "..."
```

**LangGraph 实现**:
```python
# tools.py
class CodexReviewTool:
    def invoke(self, scope: str, base: Optional[str]) -> CodexReviewOutput:
        # 调用 Codex CLI
        # 解析输出
        return CodexReviewOutput(verdict=..., findings=..., ...)

# nodes.py
async def codex_review_node(state: DualReviewState) -> Dict[str, Any]:
    review_tool = get_codex_review_tool()
    result = review_tool.invoke(scope=state["scope"], base=state.get("base"))
    return {"current_codex_review": result}
```

**映射关系**:
| CC 概念 | LangGraph 实现 |
|---------|---------------|
| Bash 命令 | `CodexReviewTool.invoke()` |
| 输出解析 | `_parse_review_output()` 方法 |
| 结果存储 | `State.current_codex_review` |

---

### Step 2: 判断是否通过

**CC 实现**:
```
verdict == "approve" 且无 critical/high findings？
    ├─ 是 → 记录本轮结果 → 输出最终报告 → 结束
    └─ 否 → 继续 Step 3
```

**LangGraph 实现**:
```python
# state.py
def is_verdict_approved(state: DualReviewState) -> bool:
    review = state.get("current_codex_review")
    if review.get("verdict") != "approve":
        return False
    return not has_critical_or_high_findings(state)

# graph.py
def route_after_verdict(state: DualReviewState) -> Literal["passed", "needs_attention"]:
    if state.get("status") == "passed":
        return "passed"
    return "needs_attention"

graph.add_conditional_edges(
    "evaluate_verdict",
    route_after_verdict,
    {"passed": "generate_report", "needs_attention": "codex_rescue"}
)
```

**映射关系**:
| CC 概念 | LangGraph 实现 |
|---------|---------------|
| 条件判断 | `is_verdict_approved()` / `has_critical_or_high_findings()` |
| 分支跳转 | 条件边 `route_after_verdict()` |
| 状态更新 | `mark_as_passed()` |

---

### Step 3: Codex Rescue 诊断

**CC 实现**:
```
/codex:rescue --wait 针对以下 review findings 进行深度诊断...
```

条件：`--skip-rescue` 未设置 且 存在 critical/high findings

**LangGraph 实现**:
```python
# nodes.py
async def codex_rescue_node(state: DualReviewState) -> Dict[str, Any]:
    if state.get("skip_rescue"):
        return {"current_codex_rescue": None}
    if not has_critical_or_high_findings(state):
        return {"current_codex_rescue": None}
    
    rescue_tool = get_codex_rescue_tool()
    result = rescue_tool.invoke(findings=review.get("findings", []))
    return {"current_codex_rescue": result}
```

**映射关系**:
| CC 概念 | LangGraph 实现 |
|---------|---------------|
| `/codex:rescue` 命令 | `CodexRescueTool.invoke()` |
| 条件跳过 | Node 内部判断 |
| 诊断输出 | `State.current_codex_rescue` |

---

### Step 4: CC Reviewer 审查

**CC 实现**:
```
Agent(subagent_type: "reviewer", prompt: "
审查以下 Codex review 发现和诊断结果...
任务要求：
1. 确认每个 finding 是否为真实问题（排除误报）
2. 对确认的问题按影响排序
3. 为每个需修复的问题生成 delta_context
")
```

**LangGraph 实现**:
```python
# nodes.py
async def cc_review_node(state: DualReviewState) -> Dict[str, Any]:
    # In production: 调用 reviewer agent
    # Demo: 模拟误报过滤
    findings = review.get("findings", [])
    confirmed_issues = []
    false_positives = []
    
    for finding in findings:
        if finding["severity"] in ("critical", "high"):
            confirmed_issues.append({
                **finding,
                "delta_context": {...}
            })
        else:
            # 误报判断逻辑
            ...
    
    return {"current_cc_review": {
        "confirmed_issues": len(confirmed_issues),
        "false_positives": len(false_positives),
        "issues": confirmed_issues
    }}
```

**映射关系**:
| CC 概念 | LangGraph 实现 |
|---------|---------------|
| `Agent(subagent_type: "reviewer")` | `cc_review_node` (可替换为真实 Agent 调用) |
| prompt 模板 | `format_reviewer_prompt()` 辅助函数 |
| delta_context | `CCReviewResult.issues[].delta_context` |

---

### Step 5: CC Implementer 修复

**CC 实现**:
```
Agent(subagent_type: "implementer", prompt: "
修复以下审查发现的问题...
约束：
- 只修复清单中列出的问题，不做额外改动
- 每个修复完成后 git commit
- 遵循 change-scope-guard 规范
")
```

**LangGraph 实现**:
```python
# nodes.py
async def cc_fix_node(state: DualReviewState) -> Dict[str, Any]:
    issues = cc_review.get("issues", [])
    
    # In production: 调用 implementer agents
    # Demo: 模拟修复
    
    return {"current_cc_fix": {
        "fixed": len(issues),
        "commits": [...],
        "files_changed": [...]
    }}
```

**映射关系**:
| CC 概念 | LangGraph 实现 |
|---------|---------------|
| `Agent(subagent_type: "implementer")` | `cc_fix_node` (可替换为真实 Agent 调用) |
| 并行修复 | 可在 node 内启动多个 subagents |
| worktree 隔离 | 可传入 worktree 配置 |

---

### Step 6: 记录本轮结果

**CC 实现**:
```json
{
  "round": 1,
  "codex_review": {...},
  "codex_rescue": {...},
  "cc_review": {...},
  "cc_fix": {...}
}
```

**LangGraph 实现**:
```python
# state.py
def finalize_round(state: DualReviewState) -> Dict[str, Any]:
    round_result = RoundResult(
        round=state["current_round"],
        codex_review=state["current_codex_review"],
        codex_rescue=state["current_codex_rescue"],
        cc_review=state["current_cc_review"],
        cc_fix=state["current_cc_fix"],
        timestamp=datetime.now().isoformat()
    )
    
    return {
        "rounds": state["rounds"] + [round_result],
        "current_round": state["current_round"] + 1,
        "current_codex_review": None,  # 清空当前轮数据
        ...
    }
```

---

### Step 7: 循环判断

**CC 实现**:
```
current_round < max_rounds？
    ├─ 是 → current_round++ → 回到 Step 1
    └─ 否 → 输出最终报告 → 标记 status = "max_rounds_reached" → 结束
```

**LangGraph 实现**:
```python
# state.py
def can_continue_loop(state: DualReviewState) -> bool:
    if state["status"] == "passed":
        return False
    if state["current_round"] >= state["max_rounds"]:
        return False
    return True

# graph.py
def route_after_check_continue(state: DualReviewState) -> Literal["continue", "end"]:
    if state.get("status") == "max_rounds_reached":
        return "end"
    if can_continue_loop(state):
        return "continue"
    return "end"

graph.add_conditional_edges(
    "check_continue",
    route_after_check_continue,
    {"continue": "codex_review", "end": "generate_report"}
)
```

**映射关系**:
| CC 概念 | LangGraph 实现 |
|---------|---------------|
| 循环判断 | `can_continue_loop()` + 条件边 |
| `current_round++` | `finalize_round()` 中更新 |
| 跳回 Step 1 | 条件边指向 `codex_review` node |

---

## 图结构可视化

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   START ──► codex_review ──► evaluate_verdict                   │
│                                   │                             │
│                   ┌───────────────┼───────────────┐             │
│                   │               │               │             │
│               (passed)      (needs_attention)     │             │
│                   │               │               │             │
│                   ▼               ▼               │             │
│            generate_report    codex_rescue        │             │
│                   │               │               │             │
│                   │               ▼               │             │
│                   │          cc_review            │             │
│                   │               │               │             │
│                   │               ▼               │             │
│                   │           cc_fix              │             │
│                   │               │               │             │
│                   │               ▼               │             │
│                   │       finalize_round          │             │
│                   │               │               │             │
│                   │               ▼               │             │
│                   │       check_continue ─────────┤             │
│                   │               │               │             │
│                   │       ┌───────┴───────┐       │             │
│                   │       │               │       │             │
│                   │   (continue)      (end)       │             │
│                   │       │               │       │             │
│                   │       ▼               ▼       │             │
│                   │   codex_review ──► generate_report         │
│                   │       │                       │             │
│                   └───────┴───────────────────────┘             │
│                                   │                             │
│                                   ▼                             │
│                                  END                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## feature-list.json 集成

**CC 实现**:
- 每轮结束后同步更新 feature-list.json
- critical/high 问题 → `passes: false`
- 修复后 → `passes: null` (待验证)
- 通过 → `passes: true`

**LangGraph 实现**:
```python
# graph.py
def sync_with_feature_list(state: DualReviewState, feature_list_path: str):
    if has_critical_or_high_findings(state):
        # Mark related features as failed
        for feature in feature_list["features"]:
            feature["passes"] = False
    
    elif fix and fix.get("fixed", 0) > 0:
        # Reset for next round
        for feature in feature_list["features"]:
            if feature.get("passes") is False:
                feature["passes"] = None
    
    elif state.get("status") == "passed":
        # All passed
        for feature in feature_list["features"]:
            feature["passes"] = True
```

---

## 最终报告格式

**CC 实现**: Markdown 格式报告

**LangGraph 实现**:
```python
# state.py
def generate_summary_report(state: DualReviewState) -> str:
    """Generate the final report in markdown format."""
    # 返回完整的 markdown 报告
```

---

## 错误处理映射

| CC 错误场景 | LangGraph 处理 |
|------------|----------------|
| Codex 未安装/未认证 | `CodexReviewTool` 返回 `error` 字段 |
| Codex review 超时 | `TimeoutExpired` 捕获 → `error` 字段 |
| Codex rescue 失败 | 降级处理，继续 CC review |
| Implementer 引入新问题 | 下轮 review 会捕获 |
| 达到最大轮次 | `mark_as_max_rounds_reached()` |

---

## 关键设计决策

### 1. State vs 文件持久化

**CC**: 使用 `dual-review-report.json` 作为持久化状态
**LangGraph**: 使用 `DualReviewState` TypedDict + 可选 checkpointer

优势：
- State 是类型安全的
- Checkpointer 支持跨会话恢复
- 无需手动文件 I/O

### 2. 条件边 vs 跳转逻辑

**CC**: Shell script 条件判断 + goto 风格
**LangGraph**: 显式条件边 `add_conditional_edges()`

优势：
- 图结构可视化
- 无隐藏控制流
- 更易测试

### 3. 工具封装

**CC**: 直接 Bash 命令调用
**LangGraph**: Tool 类封装

优势：
- 可 mock 测试
- 错误处理统一
- 支持异步执行

### 4. Agent 调用

**CC**: `Agent(subagent_type: "reviewer/implementer")`
**LangGraph**: Node 内可调用任意 Agent 框架

当前迁移使用模拟实现，生产环境可替换为：
- LangChain Agent
- Claude API
- 自定义 Agent 实现

---

## 使用示例

### 基本使用

```python
from dual_review_loop import run_dual_review_loop

# 运行双重审查循环
result = await run_dual_review_loop(
    max_rounds=3,
    scope="auto",
    skip_rescue=False
)

print(f"Status: {result['status']}")
print(f"Rounds: {result['current_round']}/{result['max_rounds']}")
```

### 带中断点

```python
from dual_review_loop import (
    create_dual_review_graph_with_interrupt,
    create_initial_state,
    resume_after_fix
)

# 创建带中断的图
graph = create_dual_review_graph_with_interrupt()

# 初始状态
state = create_initial_state(max_rounds=3)

# 运行到中断点（cc_fix 之前）
result = await graph.ainvoke(state, config={"configurable": {"thread_id": "123"}})

# 外部审批后恢复
result = resume_after_fix(graph, "123", approved=True)
```

### 与 verification-gate 集成

```python
from dual_review_loop import sync_with_feature_list

# 每轮结束后同步
sync_with_feature_list(state, ".claude/tasks/current/feature-list.json")
```

---

## 后续优化

1. **真实 Agent 集成**: 将模拟的 CC reviewer/implementer 替换为真实 Agent 调用
2. **并行修复**: 支持多个 implementer 并行修复独立问题
3. **增量状态**: 支持从任意轮次恢复
4. **日志集成**: 与 CC 的 logging 系统集成
