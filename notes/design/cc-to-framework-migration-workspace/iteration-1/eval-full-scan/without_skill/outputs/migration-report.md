# CC 配置迁移分析报告

## 扫描概览

- 扫描时间：2026-04-07
- Skills 总数：20
- Rules 总数：37
- Agents 总数：12
- Hooks 总数：7

---

## 迁移价值评估

### 高价值迁移候选（推荐迁移）

| 名称 | 类型 | 评分 | 迁移理由 | 框架推荐 |
|------|------|------|---------|---------|
| orchestrate | skill | 9 | 复杂多 agent 编排、有状态流转、并行执行、依赖管理 | LangGraph |
| self-verification-mechanism | rule | 8 | 循环验证修复、状态管理（feature-list）、迭代上限保护 | LangGraph |
| verification-gate | hook | 8 | Stop hook 门控、状态检查、条件阻塞 | LangGraph Interrupt |
| dual-review-loop | skill | 7 | 多轮迭代审查、Codex + CC 双模型协作、循环修复 | LangGraph |
| multi-model-agent | skill | 7 | 多模型路由、LiteLLM 集成、成本优化 | LangChain + LiteLLM |
| generator-evaluator-pattern | rule | 7 | Generator + Evaluator 分离、反馈循环、评估标准 | LangGraph |
| long-running-agent-techniques | rule | 7 | Harness 设计、Initializer + Coding Agent、Feature List | LangGraph |
| feature-list.json | data | 6 | 结构化状态跟踪、checkpoint 候选 | LangGraph State |

### 中价值迁移候选（可选迁移）

| 名称 | 类型 | 评分 | 说明 |
|------|------|------|------|
| brainstorm | skill | 5 | 调研流程、知识库检索，但依赖 CC 文件操作 |
| eat | skill | 5 | 知识吸收流程，但深度依赖 CC 文件系统 |
| task-bootstrap | hook | 5 | 任务目录创建，可转为 LangGraph 初始化节点 |
| scale-gate | hook | 5 | 规模评估门控，可转为条件边 |
| living-spec | rule | 4 | 双向同步 spec，可转为状态管理模式 |

### 低价值迁移候选（建议保留 CC 配置）

| 名称 | 类型 | 评分 | 保留理由 |
|------|------|------|---------|
| browser-auth-reuse | rule | 2 | 深度依赖 Chrome DevTools MCP |
| agent-browser | rule | 2 | 依赖 CC 浏览器自动化工具 |
| feishu-lark-mcp | rule | 2 | 依赖 MCP Server 集成 |
| code-as-interface | rule | 3 | 通用原则，无需框架化 |
| animation-driven-design | rule | 1 | 领域知识，声明式即可 |
| vim-exit-commands | rule | 1 | 知识速查，无需代码 |
| requirements-confirmation | rule | 3 | 交互式确认流程，适合 CC 环境 |
| execution-continuity | rule | 3 | CC 工作流约束，非通用逻辑 |
| change-scope-guard | rule | 3 | CC 改动边界约束，非通用逻辑 |

---

## 详细分析

### 1. orchestrate skill（高价值 - 推荐 LangGraph）

**当前实现**：
- 声明式任务分解
- 并行/串行 Agent 调度
- worktree 隔离
- 结果聚合与验证

**迁移价值**：
- LangGraph 原生支持 StateGraph、并行节点、条件边
- 可获得 checkpoint 持久化、可视化、LangSmith 追踪
- 更强的生产部署能力

**迁移映射**：

```python
# CC orchestrate → LangGraph StateGraph
from langgraph.graph import StateGraph, END
from typing import TypedDict

class TaskState(TypedDict):
    prd: dict
    subtasks: list
    results: list
    current_index: int

def decompose_node(state: TaskState) -> TaskState:
    # Step 2: 任务分解
    ...

def execute_subtask_node(state: TaskState) -> TaskState:
    # Step 5: 执行子任务
    ...

def aggregate_node(state: TaskState) -> TaskState:
    # Step 6: 结果聚合
    ...

graph = StateGraph(TaskState)
graph.add_node("decompose", decompose_node)
graph.add_node("execute", execute_subtask_node)
graph.add_node("aggregate", aggregate_node)
graph.add_edge("decompose", "execute")
graph.add_edge("execute", "aggregate")
```

### 2. self-verification-mechanism（高价值 - 推荐 LangGraph）

**当前实现**：
- Feature List 状态管理
- Verification Gate Stop hook
- Reviewer + Implementer 循环
- Delta Context 传递
- 迭代上限保护

**迁移价值**：
- LangGraph 循环图原生支持 verification → fix → verify 循环
- Checkpoint 可持久化 feature-list 状态
- Interrupt 可实现验证门控

**迁移映射**：

```python
# CC verification-gate → LangGraph 条件边 + Interrupt
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt

class VerificationState(TypedDict):
    features: list[dict]
    pending: int
    attempt_counts: dict[str, int]

def implement_node(state: VerificationState) -> VerificationState:
    # 实现逻辑
    ...

def verify_node(state: VerificationState) -> VerificationState:
    # 验证逻辑
    ...

def should_fix(state: VerificationState) -> str:
    if state["pending"] == 0:
        return "end"
    for f in state["features"]:
        if f["passes"] is False and f["attempt_count"] < f["max_attempts"]:
            return "fix"
    return "blocked"

graph = StateGraph(VerificationState)
graph.add_node("implement", implement_node)
graph.add_node("verify", verify_node)
graph.add_conditional_edges("verify", should_fix, {
    "fix": "implement",
    "end": END,
    "blocked": END
})

# Checkpoint 持久化
checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)
```

### 3. dual-review-loop（高价值 - 推荐 LangGraph）

**当前实现**：
- CC + Codex 双模型协作
- 多轮迭代审查
- Review → Fix → Verify 循环
- 报告生成

**迁移价值**：
- LangGraph 原生支持循环
- 可集成 LangSmith 追踪每轮审查
- 模型无关，可支持任意 LLM

**迁移映射**：

```python
# CC dual-review-loop → LangGraph 循环图
class DualReviewState(TypedDict):
    current_round: int
    max_rounds: int
    codex_findings: list
    cc_confirmed_issues: list
    fixed_count: int
    report: dict

def codex_review_node(state: DualReviewState) -> DualReviewState:
    # Step 1: Codex Review
    ...

def cc_filter_node(state: DualReviewState) -> DualReviewState:
    # Step 4: CC Reviewer 过滤误报
    ...

def cc_fix_node(state: DualReviewState) -> DualReviewState:
    # Step 5: CC Implementer 修复
    ...

def should_continue(state: DualReviewState) -> str:
    if state["codex_findings"] is None or len(state["cc_confirmed_issues"]) == 0:
        return "pass"
    if state["current_round"] >= state["max_rounds"]:
        return "max_rounds"
    return "continue"

graph = StateGraph(DualReviewState)
graph.add_node("codex_review", codex_review_node)
graph.add_node("cc_filter", cc_filter_node)
graph.add_node("cc_fix", cc_fix_node)
graph.add_edge("codex_review", "cc_filter")
graph.add_edge("cc_filter", "cc_fix")
graph.add_conditional_edges("cc_fix", should_continue, {
    "continue": "codex_review",
    "pass": END,
    "max_rounds": END
})
```

### 4. multi-model-agent（高价值 - 推荐 LangChain + LiteLLM）

**当前实现**：
- LiteLLM Proxy 配置
- 模型路由规则
- 成本优化策略
- Agent frontmatter 模型配置

**迁移价值**：
- LangChain 原生多模型支持
- LiteLLM 集成成熟
- 模型路由可作为 LangGraph 节点

**迁移映射**：

```python
# CC multi-model-agent → LangChain + LiteLLM
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel

# LiteLLM 代理模式
models = {
    "opus": ChatOpenAI(model="claude-opus-4-6", base_url="http://localhost:4000"),
    "sonnet": ChatOpenAI(model="claude-sonnet-4-6", base_url="http://localhost:4000"),
    "codex": ChatOpenAI(model="codex-5-4", base_url="http://localhost:4000"),
}

def route_by_task_type(task_type: str) -> BaseChatModel:
    routing = {
        "implementation": models["codex"],
        "research": models["sonnet"],
        "architecture": models["opus"],
    }
    return routing.get(task_type, models["sonnet"])
```

### 5. generator-evaluator-pattern（中价值 - 可选 LangGraph）

**当前实现**：
- Generator + Evaluator 分离
- 反馈循环
- 评估标准模板

**迁移价值**：
- LangGraph 节点天然分离
- 条件边实现反馈循环
- 但 CC 的 agent isolation 也足够

**迁移映射**：

```python
# CC generator-evaluator → LangGraph 双节点循环
def generator_node(state: dict) -> dict:
    # 生成输出
    ...

def evaluator_node(state: dict) -> dict:
    # 评估输出
    ...

def should_regenerate(state: dict) -> str:
    if state["evaluation"]["passed"]:
        return "done"
    if state["iteration"] >= state["max_iterations"]:
        return "max_iterations"
    return "regenerate"

graph = StateGraph(State)
graph.add_node("generator", generator_node)
graph.add_node("evaluator", evaluator_node)
graph.add_edge("generator", "evaluator")
graph.add_conditional_edges("evaluator", should_regenerate, {
    "regenerate": "generator",
    "done": END,
    "max_iterations": END
})
```

---

## Hooks 迁移分析

### 可迁移 Hooks

| Hook | CC 实现 | LangGraph 对应 |
|------|---------|---------------|
| verification-gate.sh | Stop hook 阻塞 | Interrupt + 条件边 |
| scale-gate.sh | PreToolUse 门控 | 条件边 + 路由节点 |
| task-bootstrap.sh | 自动创建任务目录 | 初始化节点 |

### 不可迁移 Hooks

| Hook | 原因 |
|------|------|
| context-monitor.sh | 依赖 CC 上下文管理 |
| pre-edit-gate.sh | 依赖 CC Edit 工具 |
| pre-agent-gate.sh | 依赖 CC Agent 调用 |
| pre-write-gate.sh | 依赖 CC Write 工具 |

---

## Agents 迁移分析

### 可复用 Agents

| Agent | CC 配置 | LangChain 对应 |
|-------|---------|---------------|
| implementer | 实现代码 | LangGraph 节点 / LangChain Tool |
| reviewer | 代码审查 | LangGraph 节点 / LangChain Tool |
| researcher | 调研搜索 | LangGraph 节点 / LangChain Tool |

### 建议

- Agents 的 frontmatter 配置（model、isolation、maxTurns）可转为 LangGraph 节点配置
- `isolation: worktree` 在 LangGraph 中不适用，需要其他隔离机制

---

## 迁移计划建议

### Phase 1: 高优先级（核心编排与验证）

1. **orchestrate → LangGraph StateGraph**
   - 任务分解节点
   - 并行执行节点
   - 结果聚合节点
   - checkpoint 持久化

2. **self-verification → LangGraph 循环图**
   - Implement → Verify 循环
   - 条件边判断
   - 迭代上限保护

3. **verification-gate → LangGraph Interrupt**
   - 状态检查
   - 阻塞/放行逻辑

### Phase 2: 中优先级（多模型与审查）

4. **multi-model-agent → LangChain + LiteLLM**
   - 模型路由
   - 成本追踪

5. **dual-review-loop → LangGraph 循环图**
   - Codex/CC 双模型节点
   - 迭代审查循环

6. **generator-evaluator → LangGraph 双节点**
   - Generator 节点
   - Evaluator 节点

### Phase 3: 可选（知识管理）

7. **brainstorm → LangGraph 状态图**
   - 调研节点
   - 知识沉淀节点

---

## 技术映射表

| CC 概念 | LangChain/LangGraph 对应 |
|---------|-------------------------|
| subagent | Agent / Runnable / Node |
| skill | Tool / Chain |
| rule | 代码约束 / Callback |
| hook | Interrupt / 条件边 |
| orchestrate | StateGraph |
| feature-list.json | State / Checkpoint |
| verification-gate | 条件边 / Interrupt |
| Agent frontmatter | Node 配置 / LLM 选择 |
| worktree isolation | 需外部实现 |
| MCP tools | 需外部工具适配 |

---

## 不建议迁移的内容

### 保留 CC 配置的理由

1. **深度 CC 集成**：依赖 MCP、文件操作、终端等 CC 原生能力
2. **声明式配置优势**：Markdown 格式更易读易改
3. **快速迭代需求**：改配置即生效，无需重新部署
4. **个人效率工具**：只在 CC 内部使用，无需独立部署
5. **知识类内容**：vim-exit-commands 等速查知识无需代码化

### 具体保留清单

- 所有 `rules/knowledge/` 目录内容
- 所有 `rules/tool/` 目录内容（MCP 相关）
- 所有 `rules/domain/` 目录内容（领域知识）
- `skills/eat/` - 知识吸收，深度依赖 CC 文件系统
- `skills/brainstorm/` - 调研流程，依赖 CC 工具
- `skills/locate/` - 代码索引，依赖 CC 环境变量

---

## 结论

**推荐迁移的核心组件**：

1. **orchestrate** - 多 agent 编排引擎
2. **self-verification-mechanism** - 验证修复循环
3. **verification-gate** - 状态门控
4. **dual-review-loop** - 双重审查循环
5. **multi-model-agent** - 多模型路由

这些组件有共同特点：
- 复杂状态管理
- 循环/条件分支逻辑
- 需要生产可观测性
- 适合独立部署

**不推荐迁移的内容**：
- 深度依赖 CC 原生能力的工具类配置
- 纯知识/声明式配置
- 快速迭代的个人效率工具

迁移后可获得：
- 更强的生产部署能力
- LangSmith 可观测性
- 模型无关性
- 更丰富的生态集成
