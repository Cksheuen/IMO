# CC-to-Framework Migration Skill 对抗性审查报告

## 审查日期
2026-04-07

## 执行人
Codex Adversarial Reviewer

---

## 发现的问题（按严重程度排序）

### 🔴 Critical: 评分标准存在漏洞

**问题**: 当前评分系统可以被"刷分"

| 场景 | 实际得分 | 问题 |
|------|---------|------|
| 一个依赖 MCP 但有循环逻辑的配置 | complexity(+2) + cc_integration(-2) = 0 | 正负相抵，无法正确判断 |
| 一个简单声明式配置但有"需要独立部署"标签 | production_readiness(+2) + complexity(-1) = 1 | 仅凭标签就能得分 |

**建议**:
```yaml
# 引入维度互斥规则
complexity:
  - 有状态机定义 (+3)
  - 有循环逻辑 (+2)
  - 纯声明式配置 → 强制 score = max(score, 1)，不能算高价值

# 添加硬性排除条件
exclusion_rules:
  - if cc_integration <= -2 and complexity < 3:
      max_score = 2  # 深度依赖 CC 的最高只能中价值
  - if complexity == -1:  # 纯声明式
      max_score = 2
```

---

### 🔴 Critical: 技术映射表有错误

**问题**: `subagent → Agent / Runnable / Node` 不准确

| CC 概念 | 当前映射 | 正确映射 |
|---------|---------|---------|
| subagent | Agent / Runnable / Node | **应区分**: `Agent(subagent_type)` → LangGraph Node，`subagent prompt` → Runnable |
| rule | 代码约束 / Callback | **应区分**: 行为规则 → Callback，状态模式 → StateGraph 节点设计 |
| verification-gate | 条件边 / Interrupt | **不够精确** → 应为 `interrupt_before` + `Command(resume=...)` 模式 |

**建议**: 细化映射表，区分不同场景

---

### 🟡 Medium: 遗漏重要评估维度

**缺失维度**:

1. **依赖隔离度**
   - 是否依赖 CC 特定环境变量（如 SESSION_ID、TRANSCRIPT_PATH）
   - 是否依赖 CC 特定文件结构（如 ~/.claude/tasks/）
   - 建议：依赖越多，迁移成本越高（-1 到 -3）

2. **工具调用模式**
   - 纯 LLM 工具（如 WebSearch）→ 易迁移 (+2)
   - CC 原生工具（如 Bash、Read、Edit）→ 难迁移 (-2)
   - MCP 工具 → 需适配层 (-1)

3. **状态持久化需求**
   - 无状态 → Chain 即可
   - 会话内状态 → State + Memory
   - 跨会话状态 → Checkpointer + Database

---

### 🟡 Medium: 触发条件过于宽泛

**问题**: `用户想要将 CC agent 部署为独立服务` 这个条件太宽泛

**场景分析**:
- 用户只是想分享一个 skill 给同事 → 不需要迁移
- 用户想要批量调用某个能力 → 可能只需要 API 封装
- 用户想要多租户隔离 → 才真正需要 LangGraph Platform

**建议**:
```yaml
触发条件 (更精确):
  - 用户明确说"迁移到 LangChain/LangGraph"
  - 用户要求生产级可观测性（LangSmith 追踪）
  - 用户需要跨会话状态持久化
  - 用户需要多租户隔离的独立服务
```

---

### 🟢 Low: 扫描范围不一致

**问题**: 测试中 with_skill 扫描了 95 个 skills，without_skill 只扫描了 20 个

**根因**: Skill 定义了精确的扫描路径，baseline 需要自己摸索

**影响**: 不影响功能正确性，但测试对比不公平

**建议**: 不需要修复，这恰恰证明了 skill 的价值

---

## 改进建议

### 1. 评分标准重设计

```yaml
迁移价值评分 v2:
  base_score: 0
  
  complexity:  # 权重: 40%
    - 状态机定义: +3
    - 循环/重试逻辑: +2
    - 条件分支: +1
    - 纯声明式: cap_at(2)  # 强制上限
  
  production_needs:  # 权重: 35%
    - 需要可观测性: +2
    - 需要多模型: +2
    - 需要独立部署: +2
    - CC 内部使用: -2
  
  cc_dependency:  # 权重: 25%
    - 纯 LLM 工具: +2
    - MCP 工具: 0
    - CC 原生工具: -2
    - CC 文件结构依赖: -3
  
  exclusion:
    - if cc_dependency <= -3: max_score = 2
    - if complexity == 纯声明式: max_score = 2

  thresholds:
    high_value: >= 5
    medium_value: 2-4
    low_value: <= 1
```

### 2. 技术映射细化

```python
# CC → LangGraph 精确映射
CC_TO_LANGGRAPH = {
    "subagent": {
        "Agent(type='implementer')": "graph.add_node('implement', implement_node)",
        "Agent(isolation='worktree')": "需要外部实现隔离机制",
        "subagent prompt": "Runnable / Tool",
    },
    "verification_gate": {
        "Stop hook": "interrupt_before + Command(resume=...)",
        "feature-list.json": "State(TypedDict) + Checkpointer",
        "delta_context": "state['delta_context']",
    },
    "orchestrate": {
        "TaskCreate": "StateGraph 初始化",
        "并发 Agent": "asyncio.gather 或并行节点",
        "结果聚合": "reduce 节点",
    }
}
```

### 3. 添加迁移成本评估

```yaml
迁移成本等级:
  low:
    - 纯 LLM 工具调用
    - 无状态
    - 预计: 1-2 天
  
  medium:
    - 有 MCP 工具依赖
    - 会话内状态
    - 预计: 3-5 天
  
  high:
    - 深度 CC 集成（文件操作、终端）
    - 跨会话状态
    - 预计: 1-2 周
```

---

## 关键问题：这个 Skill 本身是否应该迁移到 LangGraph？

### 分析

| 维度 | 评分 | 说明 |
|------|------|------|
| complexity | +3 | 有明确的多步骤流程（6 steps），有分支判断 |
| production_needs | +2 | 可能需要可观测性（追踪扫描进度） |
| cc_dependency | -1 | 依赖 Glob/Grep（CC 原生）但可替换 |
| **总分** | **4** | 中价值，可选迁移 |

### 建议

**不推荐迁移**，原因：
1. 深度依赖 CC 文件系统访问能力
2. 作为 CC 内部工具使用，无需独立部署
3. 迁移后需要额外实现文件扫描逻辑

**但可以考虑**：
- 将评分算法抽取为独立 Python 模块，供 LangGraph 复用
- 将报告生成逻辑模板化

---

## 最终结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 评分标准 | ⚠️ 需改进 | 存在刷分漏洞，需引入互斥规则 |
| 技术映射 | ⚠️ 需细化 | 部分映射不够精确 |
| 触发条件 | ⚠️ 过宽 | 可能误触发 |
| 遗漏维度 | ⚠️ 有遗漏 | 缺少依赖隔离度、工具调用模式 |
| 整体 | ✅ 可用 | 核心功能正确，建议迭代改进 |

**推荐**: 当前版本可发布，但应在 v2 中修复评分漏洞和细化技术映射。

---

## v2 修复状态（2026-04-07）

| 问题 | 状态 | 修复内容 |
|------|------|---------|
| 评分漏洞 | ✅ 已修复 | 引入 exclusion_rules、维度权重、纯声明式上限 |
| 技术映射错误 | ✅ 已修复 | subagent 区分 type/isolation/prompt，verification_gate 使用 interrupt_before + Command |
| 触发条件过宽 | ✅ 已修复 | 明确"不应触发"场景，增加精确条件 |
| 遗漏维度 | ✅ 已修复 | 新增 cc_dependency 维度、迁移成本评估 |
| 迁移成本缺失 | ✅ 已修复 | 新增 Low/Medium/High 三级成本评估 |

---

## 参考资料

- [Mastering LangGraph Checkpointing: Best Practices for 2025](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025)
- [LangChain vs LangGraph: Compare Features & Use Cases](https://www.truefoundry.com/blog/langchain-vs-langgraph)
- [Persistence and Checkpointing - Advanced LangGraph Workflow](https://oboe.com/learn/advanced-langgraph-workflow-orchestration-6nqnn8/persistence-and-checkpointing-2)
- [LangChain 1.0 vs LangGraph 1.0: Which One to Use in 2026](https://www.clickittech.com/ai/langchain-1-0-vs-langgraph-1-0/)
