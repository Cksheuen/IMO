# Orchestrate CC 配置 vs LangGraph 迁移对照

> 迁移时间：2026-04-07
> 源文件：`~/.claude/skills/orchestrate/SKILL.md`
> 目标：`migrated/orchestrate/`

## 核心映射表

| CC 概念 | LangGraph 精确映射 | 说明 |
|---------|---------------------|------|
| **Feature List** | `State(TypedDict)` + `Checkpointer` | 状态持久化 |
| **Verification Gate** | `interrupt_before` + `Command(resume=...)` | 中断恢复模式 |
| **Delta Context** | `state['delta_context']` | 状态字段 |
| **Fixer Loop** | 条件边 + 循环回边 | `verify → fixer → execute` |
| **Subagent** | 并行节点 / `asyncio.gather` | 并行执行 |
| **Rules Pack** | 硬编码在节点函数中 | 可选：提取为 Callback |
| **PRD** | `state['prd']` 或外部存储 | 状态字段 |
| **Worktree 隔离** | 需外部实现 | 非 LangGraph 内置 |
| **Agent 类型选择** | 节点配置不同 LLM | `model` 参数 |

## 功能对照

### Step 0: 上下文收集

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| Glob/Grep 搜索相关文件 | `collect_context_node` 异步函数 |
| 读取相似实现模式 | 可调用 LLM 分析 |
| 提取项目约束 | 读取配置文件 |
| 检查 notes/ 教训 | 可选：向量检索 |

**迁移代码**：
```python
async def collect_context_node(state: OrchestrateState) -> Dict[str, Any]:
    # 在生产中，使用工具搜索文件
    context_updates = {
        "prd": {
            **state["prd"],
            "from_context": ["相关文件已自动检测"],
        }
    }
    return context_updates
```

### Step 1: 创建结构化 PRD

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| Bash 脚本创建任务目录 | Python 代码初始化 State |
| `prd.md` 文件 | `state['prd']` 字段 |
| `feature-list.json` | `state['features']` 列表 |

**迁移代码**：
```python
def create_initial_state(task_description: str, task_id: str = None) -> OrchestrateState:
    return OrchestrateState(
        task_id=task_id or f"task-{datetime.now().isoformat()}",
        prd=PRD(
            from_user=[task_description],
            # ... 其他字段
        ),
        features=[],
        # ... 其他字段
    )
```

### Step 2: 任务分解

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| LLM 分析任务 | `decompose_node` 节点 |
| Markdown 表格输出 | `state['subtasks']` 列表 |
| 文件所有权矩阵 | 每个子任务的 `files_to_modify` 字段 |

**迁移代码**：
```python
async def decompose_node(state: OrchestrateState) -> Dict[str, Any]:
    # 生产中调用 LLM
    subtasks = [
        create_subtask(
            subtask_id=1,
            description=f"Implement: {state['task_description']}",
            agent_type="implementer",
            files_to_modify=["(auto-detected)"],
            dependencies=[]
        )
    ]
    return {"subtasks": subtasks}
```

### Step 3: 模式选择

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| 声明式决策框架 | 条件边函数 |
| 子任务数量判断 | `should_continue_execution()` |

**迁移代码**：
```python
def should_continue_execution(state: OrchestrateState) -> Literal["continue", "done"]:
    current_index = state["current_subtask_index"]
    subtasks = state["subtasks"]
    
    if current_index < len(subtasks):
        return "continue"
    return "done"
```

### Step 5: 并行执行

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| 同一消息中多个 Agent 调用 | 并行节点 / `asyncio.gather` |
| `isolation: "worktree"` | 需外部实现隔离机制 |
| 独立 prompt 注入 | 节点函数参数 |

**迁移代码**：
```python
# 方式 1：并行节点
graph.add_conditional_edges(
    "decompose",
    lambda s: "parallel" if len(s["subtasks"]) > 1 else "single",
    {"parallel": "parallel_executor", "single": "execute_subtask"}
)

# 方式 2：asyncio.gather（在节点内部）
async def parallel_execute(state):
    results = await asyncio.gather(*[
        execute_single_subtask(s)
        for s in state["subtasks"]
        if is_subtask_ready(state, s)
    ])
    return {"results": results}
```

### Step 6: 结果聚合

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| 收集 agent 返回的报告 | `aggregate_node` 函数 |
| 检查完成度和冲突 | 遍历 `state['subtasks']` |
| 更新 PRD | 更新 `state['prd']` |

**迁移代码**：
```python
async def aggregate_node(state: OrchestrateState) -> Dict[str, Any]:
    completed = [s for s in state["subtasks"] if s.get("status") == "complete"]
    blocked = [s for s in state["subtasks"] if s.get("status") == "blocked"]
    
    return {
        "completed_subtasks": completed,
        "blocked_subtasks": blocked,
    }
```

### Step 6.3: Fixer Loop

| CC 实现 | LangGraph 实现 |
|---------|----------------|
| `verification-gate.sh` | `interrupt_before` + 条件边 |
| `delta_context` 输出 | `state['delta_context']` 字段 |
| `max_attempts` 保护 | `VerificationGate` 类 |

**迁移代码**：
```python
# 图定义
graph.add_conditional_edges(
    "verify",
    should_run_fixer_loop,
    {"fix": "fixer", "end": END}
)
graph.add_edge("fixer", "execute_subtask")

# VerificationGate 类
class VerificationGate:
    def check(self, state: OrchestrateState) -> Dict[str, Any]:
        pending = [f for f in state["features"] if f.get("passes") is None]
        if pending:
            return {"block": True, "action": "spawn_reviewer"}
        # ... 其他检查
```

## 工作流对比

### CC 工作流

```
用户任务
    │
    ├─ Step 0: 上下文收集
    ├─ Step 1: 创建 PRD (Bash + Markdown)
    ├─ Step 2: 任务分解 (Markdown 表格)
    ├─ Step 3: 模式选择 (决策框架)
    ├─ Step 4: 构建 prompt (Markdown 模板)
    ├─ Step 5: 并行执行 (Agent tool + worktree)
    ├─ Step 6: 结果聚合 (Markdown 报告)
    │       ├─ 6.4 Fixer Loop
    │       │       └─ reviewer → delta_context → implementer
    └─ Step 7: 综合输出 (Markdown)
```

### LangGraph 工作流

```
用户任务
    │
    ├─ collect_context_node (异步函数)
    ├─ decompose_node (LLM 调用)
    │       └─ 条件边: 用户确认？
    ├─ execute_subtask_node (循环)
    │       └─ 条件边: 更多子任务？
    ├─ aggregate_node (列表处理)
    ├─ verify_node (检查)
    │       └─ 条件边: 需要修复？
    │               ├─ 是 → fixer_node
    │               │       └─ 回到 execute_subtask
    │               └─ 否 → END
    └─ (可选) interrupt_before="verify"
            │
            └─ 外部 Command(resume=...)
```

## 状态持久化对比

| 方面 | CC | LangGraph |
|------|-----|-----------|
| **存储位置** | `~/.claude/tasks/current/` | MemorySaver / 可配置 |
| **格式** | JSON 文件 | State TypedDict |
| **跨会话恢复** | 手动读取 JSON | Checkpointer 自动 |
| **并发安全** | 无保证 | LangGraph 内置 |

## 验证门控对比

| 方面 | CC | LangGraph |
|------|-----|-----------|
| **实现方式** | Stop hook (Bash) | `interrupt_before` |
| **阻塞条件** | 检查 JSON 状态 | 条件边函数 |
| **恢复方式** | 重新运行 session | `Command(resume=...)` |
| **外部控制** | 向 stderr 输出指令 | 直接函数调用 |

## 优缺点对比

### CC 配置优势

| 优势 | 说明 |
|------|------|
| **快速迭代** | 改 Markdown 即生效，无需重编译 |
| **原生集成** | 无缝使用 CC 工具（Bash/Read/Edit/MCP） |
| **灵活性强** | 声明式配置，易于理解和修改 |
| **无需部署** | 在 CC 内部直接运行 |

### LangGraph 迁移优势

| 优势 | 说明 |
|------|------|
| **生产部署** | 可作为独立服务对外提供 |
| **可观测性** | LangSmith 追踪、监控、评估 |
| **状态持久化** | 内置 Checkpointer，跨会话恢复 |
| **类型安全** | TypedDict + mypy 检查 |
| **并发安全** | 内置并发控制 |

## 迁移决策建议

### 保留 CC 配置的场景

- 日常开发中的任务编排
- 需要 CC 原生工具（MCP、文件操作）
- 快速迭代实验
- 个人效率工具

### 迁移到 LangGraph 的场景

- 作为生产服务对外提供
- 需要完整可观测性（LangSmith）
- 跨会话状态持久化
- 多租户隔离的独立服务
- 需要类型安全和测试覆盖

## 不兼容项

| CC 特性 | LangGraph 处理方式 | 迁移成本 |
|---------|---------------------|---------|
| `isolation: "worktree"` | 需外部实现 | High |
| MCP 工具调用 | 需适配层 | Medium |
| CC 原生工具 | 需重新实现 | High |
| `~/.claude/tasks/` 路径 | 可配置存储位置 | Low |

## 后续优化建议

1. **提取 Rules Pack**：将硬编码的规则提取为 LangChain Callback
2. **实现 Worktree 隔离层**：在 LangGraph 外部实现文件隔离
3. **MCP 工具适配**：创建 MCP → LangChain Tool 的适配层
4. **LangSmith 集成**：配置追踪和评估

## 文件清单

| 文件 | 内容 |
|------|------|
| `state.py` | State 定义、TypedDict、辅助函数 |
| `nodes.py` | 节点函数实现 |
| `graph.py` | StateGraph 定义、编译、运行函数 |
| `verification.py` | VerificationGate、Fixer Loop、中断恢复 |
| `example.py` | 使用示例、单元测试 |

## 使用示例

```python
from migrated.orchestrate import run_orchestration, run_verification_with_interrupt

# 基本使用
final_state = await run_orchestration(
    task_description="Implement authentication",
    checkpoint=True
)

# 中断恢复模式
result = await run_verification_with_interrupt(graph, initial_state)
# ... 外部审批 ...
final = await resume_with_approval(graph, thread_id, approved=True)
```
