# CC 配置迁移分析报告

> 生成时间：2026-04-07
> 扫描范围：`~/.claude/`

## 扫描概览

| 类型 | 数量 |
|------|------|
| **Skills** | 20 |
| **Rules** | 38 |
| **Agents** | 12 |

## 迁移价值评估

### 高价值迁移候选（推荐迁移）

| 名称 | 类型 | 评分 | 迁移成本 | 迁移理由 | 框架推荐 |
|------|------|------|---------|---------|---------|
| **orchestrate** | skill | 9 | High | 复杂多 agent 编排、状态流转、并行执行、PRD/feature-list 管理 | LangGraph |
| **self-verification-mechanism** | rule | 8 | High | 循环验证修复、feature list 状态机、checkpoint 需求 | LangGraph |
| **dual-review-loop** | skill | 7 | Medium | 循环迭代、外部 Codex 集成、状态跟踪 | LangGraph |
| **promote-notes** | skill | 6 | Medium | 状态评估、晋升决策、后台执行 | LangChain + Tool |

### 中价值迁移候选（可选迁移）

| 名称 | 类型 | 评分 | 迁移成本 | 说明 |
|------|------|------|---------|------|
| **implementer** | agent | 5 | Medium | 独立实现 agent，可用 LangChain Agent 替代 |
| **reviewer** | agent | 5 | Medium | 独立审查 agent，可用 LangChain Agent 替代 |
| **researcher** | agent | 4 | Low | 纯研究 agent，迁移简单 |
| **long-running-agent-techniques** | rule | 4 | Medium | Harness 设计模式，可指导 LangGraph 架构 |
| **generator-evaluator-pattern** | rule | 4 | Low | 评估模式，LangChain 原生支持 |

### 低价值迁移候选（建议保留 CC 配置）

| 名称 | 类型 | 评分 | 保留理由 |
|------|------|------|---------|
| **brainstorm** | skill | 2 | 深度依赖 CC 文件操作和用户交互 |
| **eat** | skill | 2 | 依赖 WebSearch/Fetch 和 CC 文件写入 |
| **design** | skill | 1 | 依赖 Pencil MCP、设计工具链 |
| **freeze/thaw** | skill | 1 | 操作 CC 配置文件结构 |
| **locate** | skill | 1 | 操作 CC memory 文件结构 |
| **git-worktree-parallelism** | rule | 2 | CC 原生 worktree 工具支持 |
| **browser-auth-reuse** | rule | 2 | 依赖 Chrome DevTools MCP |
| **feishu-lark-mcp** | rule | 2 | MCP 工具依赖 |
| **所有 domain rules** | rule | 1-2 | 纯声明式配置，无复杂逻辑 |
| **所有 technique rules** | rule | 1-3 | CC 原生能力深度依赖 |
| **所有 knowledge rules** | rule | 0 | 纯知识条目，无需迁移 |

## 详细分析

### 高价值候选详解

#### 1. orchestrate (skill) - 评分: 9

**迁移价值**：
- ✅ 有完整的状态机（Step 0-7 流程）
- ✅ 有循环/重试逻辑（Fixer Loop）
- ✅ 有并行执行（并发 Agent）
- ✅ 有 checkpoint 需求（feature-list.json）
- ✅ 适合独立部署为任务编排服务

**CC 依赖分析**：
- Agent tool 调用 → LangGraph 节点
- worktree isolation → 需外部实现
- feature-list.json → State + Checkpointer
- verification-gate → interrupt_before + Command

**迁移成本**：High
- 需要实现 worktree 隔离层
- 需要设计 StateGraph 拓扑
- 需要处理 subagent prompt 构建

#### 2. self-verification-mechanism (rule) - 评分: 8

**迁移价值**：
- ✅ 有完整状态机（passes/null/false）
- ✅ 有循环逻辑（Fixer Loop）
- ✅ 有 delta_context 传递机制
- ✅ 有迭代上限保护（max_attempts）
- ✅ 适合作为 LangGraph 子图

**CC 依赖分析**：
- feature-list.json → State(TypedDict)
- verification-gate → interrupt_before
- delta_context → state['delta_context']
- reviewer/implementer → 节点

**迁移成本**：High
- 需要精确映射 interrupt + resume 模式
- 需要设计状态序列化
- 需要实现外部恢复接口

#### 3. dual-review-loop (skill) - 评分: 7

**迁移价值**：
- ✅ 有循环迭代逻辑
- ✅ 有外部工具集成（Codex）
- ✅ 有状态跟踪（dual-review-report.json）
- ⚠️ 但依赖 Codex CLI 环境

**CC 依赖分析**：
- Codex CLI 调用 → external tool
- review 解析 → Tool output parsing
- 循环判断 → Conditional edges

**迁移成本**：Medium
- Codex 调用可封装为 Tool
- 循环逻辑用 LangGraph 条件边

#### 4. promote-notes (skill) - 评分: 6

**迁移价值**：
- ✅ 有状态评估逻辑
- ✅ 有晋升决策树
- ⚠️ 但深度依赖 CC 文件结构

**CC 依赖分析**：
- notes/ 扫描 → Glob tool
- rules/skills 更新 → Write tool
- 后台执行 → 可用 LangGraph 后台任务

**迁移成本**：Medium
- 文件操作可抽象为 Tool
- 决策逻辑可转为 Chain

### 中价值候选详解

#### implementer/reviewer/researcher agents

这些 agent 已经是独立角色，迁移为 LangChain Agent 相对简单：

```python
# CC agent
---
name: implementer
description: Implementation agent...
model: inherit
isolation: worktree
---

# LangChain 等价
from langchain.agents import Agent

implementer = Agent(
    name="implementer",
    model="inherit",
    tools=[Read, Write, Edit, Bash],
    system_prompt="You are a focused implementation agent..."
)
```

**迁移建议**：保留 CC 配置用于日常开发，可选迁移为 LangChain Agent 用于生产部署。

### 低价值候选原因

1. **MCP 工具依赖**：design、browser-auth-reuse、feishu-lark-mcp 等依赖 MCP server，迁移后需要额外适配层
2. **CC 文件结构依赖**：freeze/thaw、locate 等操作 `~/.claude/` 目录结构，迁移后失去意义
3. **纯声明式配置**：domain rules、technique rules 大多是指导性规则，无复杂逻辑
4. **深度 CC 集成**：brainstorm、eat 等依赖 CC 原生工具链（WebSearch、文件操作）

## 迁移计划建议

### Phase 1: 高优先级（推荐立即迁移）

- [ ] **self-verification-mechanism** → LangGraph StateGraph
  - 作为核心验证子图
  - 支持 interrupt + resume
  - 实现 delta_context 传递

- [ ] **orchestrate** → LangGraph 完整编排
  - 整合 verification 子图
  - 实现并行节点
  - 实现 worktree 隔离层

### Phase 2: 中优先级（可选迁移）

- [ ] **dual-review-loop** → LangGraph 循环图
  - Codex CLI 封装为 Tool
  - 条件边实现循环判断

- [ ] **implementer/reviewer/researcher** → LangChain Agents
  - 作为可复用 Agent 组件
  - 支持独立部署

### Phase 3: 观察期（暂不迁移）

- 所有低价值候选
- 保留 CC 配置用于日常开发
- 监控是否有新的迁移需求

## 技术映射表

| CC 概念 | LangChain/LangGraph 精确映射 |
|---------|------------------------------|
| `Agent(subagent_type='implementer')` | `graph.add_node('implement', implement_node)` |
| `Agent(isolation='worktree')` | 需外部实现隔离机制（非 LangGraph 内置） |
| `feature-list.json` | `State(TypedDict)` + `Checkpointer` |
| `verification-gate` | `interrupt_before` + `Command(resume=...)` |
| `delta_context` | `state['delta_context']` |
| `Fixer Loop` | 条件边 + 循环回边 |
| `max_attempts` | state['attempt_count'] + 条件判断 |
| `PRD` | 可选：LangSmith dataset / 外部存储 |
| `并行 Agent` | `asyncio.gather` 或并行节点 |
| `researcher (haiku)` | 不同模型配置 |
| `implementer (inherit)` | 继承父 graph 模型 |

## 反模式警告

| 反模式 | 正确做法 |
|--------|----------|
| 全部迁移 | 只迁移高价值部分 |
| 删除原 CC 配置 | 保留原配置作为对照 |
| 忽略 MCP 依赖 | 深度依赖 MCP 的保留 CC 配置 |
| 不生成对照文档 | 每个迁移项必须有 COMPARISON.md |
| 跳过验证 | reviewer 必须验证代码与原配置一致性 |

## 下一步

1. **确认迁移范围**：用户选择要迁移的配置
2. **调用 `/orchestrate`**：生成详细迁移任务
3. **并发执行迁移**：使用 agent teams 并行处理
4. **输出迁移产物**：代码 + 对照文档 + 测试

---

*此报告由 `/cc-to-framework-migration` skill 自动生成*
