# CC 配置迁移分析报告

**扫描时间**: 2026-04-07
**扫描范围**: `~/.claude/` 目录下的 skills、rules、agents

## 扫描概览

| 类别 | 数量 | 说明 |
|------|------|------|
| **Skills** | 18 | 用户自定义技能（不含 plugins） |
| **Rules** | 37 | 规范文件（core/pattern/technique/tool/domain/knowledge） |
| **Agents** | 12 | Agent 定义文件 |

---

## 迁移价值评估

### 高价值迁移候选（推荐迁移）

| 名称 | 类型 | 评分 | 迁移理由 | 框架推荐 |
|------|------|------|---------|---------|
| **orchestrate** | skill | **9** | 复杂多 agent 编排、状态管理、循环验证修复、feature-list 状态跟踪 | **LangGraph** |
| **self-verification-mechanism** | rule | **8** | 循环验证修复、delta_context handoff、迭代上限保护 | **LangGraph** |
| **long-running-agent-techniques** | rule | **8** | 双层 Harness 架构、feature-list 状态、跨会话 checkpoint | **LangGraph** |
| **dual-review-loop** | skill | **7** | CC+Codex 双模型循环、迭代审查修复 | **LangGraph** |
| **generator-evaluator-pattern** | rule | **7** | Generator/Evaluator 分离、反馈循环 | **LangChain** |

### 中价值迁移候选（可选迁移）

| 名称 | 类型 | 评分 | 说明 |
|------|------|------|------|
| **multi-model-agent** | skill | **5** | 多模型路由配置，但 LiteLLM 已是独立服务，迁移收益有限 |
| **brainstorm** | skill | **4** | 调研流程，主要是 WebSearch + 结构化输出，LangChain Tool 可覆盖 |
| **eat** | skill | **4** | 知识吸收工作流，可转为 LangChain Chain，但依赖 CC 文件操作 |
| **implementer** | agent | **4** | 代码实现 agent，可转为 LangChain Agent，但依赖 CC 原生工具 |
| **reviewer** | agent | **4** | 代码审查 agent，可转为 LangChain Agent，但依赖 CC 原生工具 |
| **researcher** | agent | **3** | 调研 agent，纯 WebSearch + Read，迁移简单但收益不高 |

### 低价值迁移候选（建议保留 CC 配置）

| 名称 | 类型 | 评分 | 保留理由 |
|------|------|------|---------|
| **freeze/thaw** | skill | **1** | 依赖 CC 文件系统操作，迁移后功能反而受限 |
| **locate** | skill | **1** | 依赖 CC 代码库搜索能力，迁移无意义 |
| **freshness** | skill | **1** | 依赖 CC 文件操作 + WebFetch，迁移收益低 |
| **design** | skill | **2** | 依赖 Pencil MCP，深度 CC 集成 |
| **pdf/pptx/docx** | skill | **2** | 文档处理技能，依赖外部 MCP，迁移收益低 |
| **voice** | skill | **1** | 纯 CC 内部功能，无独立部署需求 |
| **shit** | skill | **1** | 元技能，操作 CC 配置文件，迁移无意义 |
| **team-builder** | skill | **2** | HR agent 概念演示，实验性 |
| **pkg-dive** | skill | **2** | npm 包探索，依赖 CC 文件操作 |
| **promote-notes** | skill | **2** | 操作 CC notes 目录，深度 CC 集成 |

#### Rules 低价值保留

| 名称 | 保留理由 |
|------|---------|
| **core/** | 全局行为约束，不适合框架化 |
| **context-injection** | CC 配置加载机制，与框架无关 |
| **task-centric-workflow** | 任务组织规范，声明式定义 |
| **proactive-delegation** | 委派决策框架，适合 CC 配置 |
| **git-worktree-parallelism** | CC worktree 操作 |
| **browser-auth-reuse** | CC MCP 工具使用规范 |
| **skills-cli-discovery** | CC skills 管理 |
| **llm-friendly-format** | 文档格式规范，与框架无关 |
| **requirements-confirmation** | 需求确认流程，声明式更清晰 |
| **change-scope-guard** | 代码审查规范，适合 CC 配置 |
| **living-spec** | 双向同步机制，但实现依赖 CC 文件操作 |
| **code-as-interface** | 设计原则，不需要框架化 |
| **animation-driven-design** | 游戏开发领域知识，不需要框架化 |
| **cross-layer-preflight** | 开发流程规范 |
| **change-impact-review** | 代码审查规范 |
| **execution-continuity** | 行为约束 |
| **vim-exit-commands** | 速查知识，不需要框架化 |
| **auto-created-feature-list-noise** | CC 特有问题处理 |
| **promotion-loop-background-execution** | CC hook 机制 |

---

## 详细迁移分析

### 1. orchestrate skill（评分: 9）

**迁移价值**: 极高

**特征匹配**:
- ✅ 复杂状态管理（feature-list.json 状态跟踪）
- ✅ 循环/重试逻辑（Fixer Loop、delta_context handoff）
- ✅ 多 Agent 编排（implementer/researcher/reviewer）
- ✅ 条件分支（验证通过/失败的不同路径）
- ✅ Checkpoint 机制（feature-list 持久化）

**LangGraph 映射**:

| CC 概念 | LangGraph 对应 |
|---------|----------------|
| feature-list.json | `State` + `Checkpointer` |
| 子任务分解 | `StateGraph` nodes |
| 并行执行 | `graph.add_node` + fan-out |
| Fixer Loop | `add_conditional_edges` + 循环 |
| delta_context | State field 传递 |
| max_attempts | 条件边判断 |

**迁移建议**:
```python
# LangGraph 示例架构
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

class OrchestrateState(TypedDict):
    features: list[dict]
    current_feature: dict | None
    attempt_count: int
    delta_context: dict | None

graph = StateGraph(OrchestrateState)

# Nodes
graph.add_node("decompose", decompose_task)
graph.add_node("implement", implement_feature)
graph.add_node("verify", verify_feature)

# Edges with loop
graph.add_conditional_edges("verify", should_continue, {
    "fix": "implement",  # delta_context handoff
    "next": "pick_next",
    "end": END
})

# Checkpointer for persistence
checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)
```

---

### 2. self-verification-mechanism（评分: 8）

**迁移价值**: 高

**特征匹配**:
- ✅ 循环验证修复
- ✅ 状态跟踪（passes/attempt_count/max_attempts）
- ✅ Delta context handoff
- ✅ 迭代上限保护

**LangGraph 映射**:

| CC 概念 | LangGraph 对应 |
|---------|----------------|
| feature-list.json | State |
| verification-gate.sh | 条件边 + interrupt |
| delta_context | State field |
| max_attempts | 条件边计数判断 |

**迁移建议**:
```python
class VerificationState(TypedDict):
    features: list[dict]
    current_feature_id: str
    attempt_count: int

def verification_gate(state: VerificationState) -> str:
    feature = get_current_feature(state)
    if feature["passes"] is True:
        return "next"
    if feature["attempt_count"] >= feature["max_attempts"]:
        return "escalate"  # 人工干预
    if feature["passes"] is False:
        return "fix"  # delta_context 已填充
    return "verify"  # passes is None

graph.add_conditional_edges("gate", verification_gate, {
    "next": "pick_next",
    "fix": "implementer",
    "verify": "reviewer",
    "escalate": END
})
```

---

### 3. long-running-agent-techniques（评分: 8）

**迁移价值**: 高

**特征匹配**:
- ✅ 双层 Agent Harness（Initializer + Coding Agent）
- ✅ Feature List 状态管理
- ✅ Context Anxiety 处理（Handoff 机制）
- ✅ 跨会话 checkpoint

**迁移建议**:
- Initializer Agent → 单次运行的 Chain
- Coding Agent → 带 checkpoint 的 StateGraph 循环
- Handoff → LangGraph checkpoint 恢复

---

### 4. dual-review-loop（评分: 7）

**迁移价值**: 中高

**特征匹配**:
- ✅ 循环迭代（CC 实现 → Codex review → 修复）
- ✅ 状态跟踪（rounds、findings）
- ✅ 多模型协作（Claude + Codex）

**LangGraph 映射**:

| CC 概念 | LangGraph 对应 |
|---------|----------------|
| dual-review-report.json | State |
| Codex review | External API call node |
| CC reviewer | Agent node |
| CC implementer | Agent node |
| max_rounds | 条件边计数 |

**迁移建议**:
```python
class DualReviewState(TypedDict):
    current_round: int
    max_rounds: int
    findings: list[dict]
    status: str

def should_continue_review(state: DualReviewState) -> str:
    if state["status"] == "approved":
        return "end"
    if state["current_round"] >= state["max_rounds"]:
        return "end"
    return "fix"

graph.add_conditional_edges("codex_review", should_continue_review, {
    "fix": "implementer",
    "end": END
})
```

---

### 5. generator-evaluator-pattern（评分: 7）

**迁移价值**: 中高

**特征匹配**:
- ✅ Generator/Evaluator 分离
- ✅ 反馈循环（3-5 轮上限）
- ✅ 独立工具验证

**LangChain 映射**:

| CC 概念 | LangChain 对应 |
|---------|----------------|
| Generator | LLM + Tools |
| Evaluator | 独立 LLM + Evaluation Chain |
| 反馈循环 | LangGraph 循环 或 while loop |

---

## 迁移计划建议

### Phase 1: 高优先级（立即迁移）

```
优先级顺序：
1. orchestrate → LangGraph StateGraph（核心编排引擎）
2. self-verification-mechanism → 整合到 orchestrate 的验证循环
3. long-running-agent-techniques → 整合为 Harness 模式
```

**交付物**:
- `orchestrate_langgraph.py` - 完整的 StateGraph 实现
- `feature_state.py` - State 定义和 checkpointer
- `verification_loop.py` - 验证修复循环
- `README.md` - 使用说明

### Phase 2: 中优先级（可选迁移）

```
4. dual-review-loop → 独立 LangGraph workflow
5. generator-evaluator-pattern → LangChain Chain
```

### Phase 3: 低优先级（保留 CC 配置）

所有低价值候选保留为 CC 配置，不建议迁移。

---

## 技术映射表

| CC 概念 | LangChain/LangGraph 对应 |
|---------|-------------------------|
| subagent | `Agent` / `Runnable` |
| skill | `Tool` / `Chain` / `StateGraph` |
| rule | 代码约束 / Callback |
| orchestrate | `StateGraph` |
| feature-list.json | `State` + `Checkpointer` |
| verification-gate | 条件边 / `interrupt` |
| delta_context | State field |
| max_attempts | 条件边计数判断 |
| implementer agent | LangGraph node (LLM + Tools) |
| reviewer agent | LangGraph node (独立 LLM) |
| researcher agent | LangGraph node (WebSearch) |

---

## 迁移风险评估

| 风险 | 说明 | 缓解措施 |
|------|------|---------|
| **CC 原生能力依赖** | implementer/reviewer 依赖 CC 文件操作、Bash、MCP | 使用 LangChain Tools 重新实现文件操作 |
| **Context 继承** | CC subagent 自动继承主 session 上下文 | LangGraph State 显式传递所有上下文 |
| **Worktree 隔离** | CC 原生支持 git worktree 隔离 | 使用独立工作目录或容器隔离 |
| **迭代调试** | CC 配置改了即生效，框架代码需要重新部署 | 使用 LangGraph Studio 进行可视化调试 |

---

## 结论

**推荐迁移**:
1. `orchestrate` skill → **LangGraph StateGraph**（核心价值）
2. `self-verification-mechanism` rule → 整合到 LangGraph
3. `long-running-agent-techniques` rule → Harness 模式

**建议保留 CC 配置**:
- 所有依赖 CC 原生能力（文件操作、MCP、worktree）的技能
- 声明式规范类 rules
- 领域知识类 rules

**迁移收益**:
- 可独立部署为服务
- 生产级可观测性（LangSmith）
- 多模型支持不绑定 Claude
- 状态持久化和恢复
- 可视化调试（LangGraph Studio）
