---
name: cc-to-framework-migration
description: Claude Code 配置到 LangChain/LangGraph 框架迁移技能。扫描 ~/.claude/ 下的 skills/rules/agents，识别适合迁移到 LangChain 框架的部分，生成迁移建议报告和代码框架。触发条件：用户说"迁移到框架"、"转成 LangChain"、"框架化"、"LangGraph 迁移"、"CC 配置迁移"或想要将现有的 CC 配置转为可独立部署的框架代码。
description_en: "Claude Code to LangChain/LangGraph migration skill. Scans skills, rules, and agents under ~/.claude, identifies parts suitable for a LangChain-based framework, and produces a migration report plus starter framework code."
---

# CC-to-Framework Migration - Claude Code 配置框架化迁移

**将 Claude Code 配置（skills/rules/agents）迁移到 LangChain/LangGraph 等框架，实现可独立部署的 Agent 系统。**

```
扫描配置 → 分析迁移价值 → 生成报告 → 任务分解 → 并发转换 → 输出代码
```

## 触发条件

满足任一即可激活：
- 用户明确说"迁移到 LangChain"、"迁移到 LangGraph"、"转成框架代码"
- 用户要求生产级可观测性（明确提及 LangSmith 追踪）
- 用户需要跨会话状态持久化（明确提及 checkpoint）
- 用户需要多租户隔离的独立服务
- 用户要求将 CC agent 部署为可独立运行的服务

**不应触发的场景**：
- 只是分享 skill 给同事（不需要迁移）
- 只想批量调用某能力（可能只需要 API 封装）
- 快速原型验证（CC 配置更灵活）

## 核心原则

| 原则 | 说明 |
|------|------|
| **价值导向** | 只迁移真正适合框架化的部分，保留适合 CC 配置的部分 |
| **输出对照** | 生成两套方案的对照文档，方便理解差异 |
| **就近存储** | 生成的代码尽量与原 md 文档放在同一路径 |
| **增量迁移** | 支持 partial 迁移，不需要一次性全部转换 |

## 迁移价值评估标准

### 高价值迁移候选

| 特征 | 说明 | 框架优势 |
|------|------|---------|
| **复杂状态管理** | 有明确的状态流转、checkpoint | LangGraph 原生支持 |
| **循环/重试逻辑** | 有 self-correction、retry loop | LangGraph 循环图 |
| **多模型需求** | 需要切换不同 LLM | LangChain 模型无关 |
| **生产可观测性** | 需要追踪、监控、评估 | LangSmith 集成 |
| **独立部署需求** | 需要作为服务对外提供 | LangGraph Platform |

### 低价值迁移候选（建议保留 CC 配置）

| 特征 | 说明 | CC 配置优势 |
|------|------|------------|
| **轻量编排** | 简单的 subagent 调用 | orchestrate skill 足够 |
| **深度 CC 集成** | 依赖 MCP、文件操作、终端 | CC 原生能力 |
| **快速迭代** | 频繁修改、实验性 | 改配置即生效 |
| **个人效率工具** | 只在 CC 内部使用 | 无需独立部署 |
| **声明式定义** | 纯配置、无复杂逻辑 | Markdown 更清晰 |

## 执行流程

### Step 1: 扫描 CC 配置

扫描 `~/.claude/` 目录，收集所有 skills、rules、agents：

```yaml
扫描范围:
  skills:
    path: ~/.claude/skills/
    pattern: "*/SKILL.md"

  rules:
    path: ~/.claude/rules/
    pattern: "**/*.md"

  agents:
    path: ~/.claude/agents/
    pattern: "*.md"

输出:
  - skills_list: [skill_name, path, description]
  - rules_list: [rule_name, path, type]
  - agents_list: [agent_name, path]
```

### Step 2: 分析迁移价值

对每个配置文件进行评分：

```yaml
评估维度 v2:
  complexity:  # 权重: 40%
    - 有状态机/流程图定义 (+3)
    - 有循环/重试逻辑 (+2)
    - 有条件分支 (+1)
    - 纯声明式配置: cap_at(2)  # 强制上限，不能算高价值

  production_readiness:  # 权重: 35%
    - 需要追踪/监控 (+2)
    - 需要多模型支持 (+2)
    - 需要独立部署 (+2)
    - 只在 CC 内部使用 (-2)

  cc_dependency:  # 权重: 25%（原 cc_integration 更名）
    - 纯 LLM 工具调用 (+2)  # 易迁移
    - MCP 工具 (0)          # 需适配层
    - CC 原生工具 (Bash/Read/Edit) (-2)  # 难迁移
    - CC 文件结构依赖 (~/.claude/tasks/) (-3)  # 最难迁移

  # 排除规则（硬性上限）
  exclusion_rules:
    - if cc_dependency <= -3: max_score = 2  # 深度依赖 CC 文件结构
    - if complexity == 纯声明式: max_score = 2  # 无复杂逻辑

  迁移建议:
    score >= 5: 高价值 - 推荐迁移
    score 2-4: 中价值 - 可选迁移
    score <= 1: 低价值 - 建议保留

  加权总分计算:
    weighted_score = complexity * 0.4 + production_readiness * 0.35 + cc_dependency * 0.25
    final_score = min(weighted_score, exclusion_cap)
```

### Step 3: 生成迁移报告

输出单文件 Markdown 报告：

```markdown
# CC 配置迁移分析报告

## 扫描概览
- 扫描时间：{timestamp}
- Skills 总数：{N}
- Rules 总数：{N}
- Agents 总数：{N}

## 迁移价值评估

### 高价值迁移候选（推荐迁移）

| 名称 | 类型 | 评分 | 迁移成本 | 迁移理由 | 框架推荐 |
|------|------|------|---------|---------|---------|
| orchestrate | skill | 8 | Medium | 复杂多 agent 编排 | LangGraph |
| self-verification | rule | 7 | High | 循环验证修复 | LangGraph |
| ... | ... | ... | ... | ... | ... |

### 中价值迁移候选（可选迁移）

| 名称 | 类型 | 评分 | 说明 |
|------|------|------|------|
| ... | ... | ... | ... |

### 低价值迁移候选（建议保留）

| 名称 | 类型 | 评分 | 保留理由 |
|------|------|------|---------|
| ... | ... | ... | ... |

## 迁移计划建议

### Phase 1: 高优先级
- [ ] {item1} → LangGraph
- [ ] {item2} → LangChain

### Phase 2: 中优先级
- [ ] ...

## 技术映射表（v2 细化版）

| CC 概念 | LangChain/LangGraph 精确映射 |
|---------|------------------------------|
| `Agent(subagent_type='implementer')` | `graph.add_node('implement', implement_node)` |
| `Agent(isolation='worktree')` | 需外部实现隔离机制（非 LangGraph 内置） |
| `subagent prompt` | `Runnable` / `Tool` |
| `skill` | `Tool` / `Chain` |
| `rule` - 行为规则 | `Callback` / Guard rails |
| `rule` - 状态模式 | `StateGraph` 节点设计 |
| `orchestrate` | `StateGraph` + 并行节点 + `reduce` 聚合 |
| `TaskCreate` | `StateGraph` 初始化 |
| `并发 Agent` | `asyncio.gather` 或并行节点 |
| `feature-list.json` | `State(TypedDict)` + `Checkpointer` |
| `verification-gate` | `interrupt_before` + `Command(resume=...)` |
| `delta_context` | `state['delta_context']` |
```

### Step 4: 调用 orchestrate 生成任务

确认迁移范围后，调用 `/orchestrate` 生成分解任务：

```yaml
orchestrate 配置:
  task: "将 {selected_items} 迁移到 LangChain/LangGraph"

  子任务拆分:
    - 每个高价值候选作为一个子任务
    - 每个子任务产出:
      - LangChain/LangGraph 代码
      - 对照文档
      - 使用示例

  agent 类型:
    - implementer: 编写框架代码
    - researcher: 查阅 LangChain 文档
    - reviewer: 验证代码正确性
```

### Step 5: 并发执行迁移

使用 agent teams 并发处理多个迁移任务：

```
┌─────────────────────────────────────────────────────────────┐
│                    迁移执行流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Step 4.1: 并发分析                                        │
│        │                                                    │
│        ├─ researcher: 查阅 LangChain/LangGraph 最佳实践      │
│        └─ researcher: 查阅原 CC 配置的完整逻辑               │
│                                                             │
│   Step 4.2: 并发实现                                        │
│        │                                                    │
│        ├─ implementer: 迁移 skill A → LangGraph             │
│        ├─ implementer: 迁移 rule B → LangChain              │
│        └─ implementer: 迁移 agent C → Agent                 │
│                                                             │
│   Step 4.3: 验证                                            │
│        │                                                    │
│        └─ reviewer: 对照验证代码与原配置的一致性             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Step 6: 输出迁移产物

每个迁移项输出以下文件：

```yaml
输出结构:
  原路径/{name}/:
    ├── SKILL.md              # 原 CC 配置（保留）
    ├── migrated/             # 迁移输出目录
    │   ├── {name}.py         # LangChain/LangGraph 代码
    │   ├── {name}_test.py    # 单元测试
    │   └── README.md         # 使用说明
    └── COMPARISON.md         # 对照文档
```

## 技术映射指南

### CC Skill → LangChain Tool/Chain

```python
# CC Skill (声明式)
---
name: my-skill
description: 做某事
---
# 执行步骤
1. Step A
2. Step B

# LangChain (代码式)
from langchain.tools import tool

@tool
def my_skill(input: str) -> str:
    """做某事"""
    # Step A
    result_a = do_step_a(input)
    # Step B
    return do_step_b(result_a)
```

### CC Orchestrate → LangGraph StateGraph

```python
# CC orchestrate (声明式编排)
## 子任务列表
| # | 子任务 | Agent 类型 | 依赖 |
|---|--------|-----------|------|
| 1 | 分析 | researcher | 无 |
| 2 | 实现 | implementer | #1 |
| 3 | 验证 | reviewer | #2 |

# LangGraph (状态图)
from langgraph.graph import StateGraph

graph = StateGraph(State)
graph.add_node("analyze", analyze_node)
graph.add_node("implement", implement_node)
graph.add_node("verify", verify_node)
graph.add_edge("analyze", "implement")
graph.add_edge("implement", "verify")
```

### CC Feature List → LangGraph State/Checkpoint

```python
# CC feature-list.json
{
  "features": [
    {"id": "F001", "passes": null, "attempt_count": 0}
  ]
}

# LangGraph State
from typing import TypedDict

class State(TypedDict):
    features: list[dict]
    current_attempt: int

# 配合 checkpoint 实现状态持久化
from langgraph.checkpoint.memory import MemorySaver
checkpointer = MemorySaver()
```

### CC Verification Gate → LangGraph Interrupt + Command

```python
# CC verification-gate.sh
if pending_features > 0:
    block_exit()

# LangGraph v2 精确映射：interrupt_before + Command(resume=...)
from langgraph.types import Command, interrupt
from langgraph.checkpoint.memory import MemorySaver

# 定义可中断节点
graph.add_node("verify", verify_node)

# 配置 interrupt_before 在验证前暂停
graph.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["verify"]  # 在 verify 节点前中断
)

# 外部控制恢复
def resume_verification(thread_id: str, approved: bool):
    if approved:
        return graph.invoke(
            Command(resume={"approved": True}),
            config={"configurable": {"thread_id": thread_id}}
        )
    else:
        return {"status": "blocked", "reason": "pending_features"}

# 或者使用条件边（不中断）
def should_continue(state: State) -> str:
    if state["pending_features"] > 0:
        return "fix"
    return "end"

graph.add_conditional_edges("verify", should_continue, {
    "fix": "implement",
    "end": END
})
```

## 迁移成本评估

在生成报告时，为每个迁移候选添加成本估算：

| 成本等级 | 特征 | 预计工作量 | 示例 |
|---------|------|-----------|------|
| **Low** | 纯 LLM 工具调用、无状态、无 CC 特殊依赖 | 1-2 天 | 简单 skill 转为 Tool |
| **Medium** | 有 MCP 工具依赖、会话内状态、简单编排 | 3-5 天 | orchestrate 转为 StateGraph |
| **High** | 深度 CC 集成（文件操作、终端）、跨会话状态 | 1-2 周 | verification-gate + feature-list |

### 成本评估维度

```yaml
cost_factors:
  dependency_isolation:
    - 不依赖 CC 特定环境变量 (+0)
    - 依赖 SESSION_ID/TRANSCRIPT_PATH (+1)
    - 依赖 ~/.claude/tasks/ 文件结构 (+2)

  tool_patterns:
    - 纯 LLM 工具 (WebSearch) (+0)
    - MCP 工具 (+1)
    - CC 原生工具 (Bash/Read/Edit) (+2)

  state_persistence:
    - 无状态 (+0)
    - 会话内状态 (+1)
    - 跨会话状态 (checkpoint) (+2)

  cost_score = dependency_isolation + tool_patterns + state_persistence

  cost_level:
    0-1: Low
    2-3: Medium
    4+: High
```

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 全部迁移 | 只迁移高价值部分 |
| 删除原 CC 配置 | 保留原配置作为对照 |
| 忽略 CC 原生能力 | 深度依赖 MCP 的保留 CC 配置 |
| 不生成对照文档 | 每个迁移项必须有 COMPARISON.md |
| 跳过验证 | reviewer 必须验证代码与原配置一致性 |

## 检查清单

### 扫描阶段
- [ ] 已扫描所有 skills？
- [ ] 已扫描所有 rules？
- [ ] 已扫描所有 agents？
- [ ] 已收集描述和结构信息？

### 评估阶段
- [ ] 每个配置都有评分？
- [ ] 高中低价值分类正确？
- [ ] 迁移建议有理有据？

### 迁移阶段
- [ ] 生成了 LangChain/LangGraph 代码？
- [ ] 生成了对照文档？
- [ ] 代码可运行？
- [ ] reviewer 验证通过？

## 相关规范

- [[orchestrate]] - 任务分解与并行执行
- [[multi-model-agent]] - 多模型协作配置
- [[long-running-agent-techniques]] - 长时运行 Agent 模式
- [[self-verification-mechanism]] - 自验证循环模式

## 参考

- [LangChain Documentation](https://python.langchain.com/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangSmith Observability](https://docs.smith.langchain.com/)
- [Claude Agent SDK vs LangChain Comparison](https://docs.langchain.com/oss/python/deepagents/comparison)
