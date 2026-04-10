# Multi-Model Agent: Claude Code Skill vs LangGraph/LiteLLM MVP

本文档记录 `skills/multi-model-agent/SKILL.md` 到最小迁移代码骨架的映射关系。

## 迁移目标

本次迁移只保留 **模型路由决策层**：

- 任务分析
- 模型能力矩阵
- 路由规则
- fallback 决策
- 轻量成本快照

本次 **不** 迁移：

- `.env` 写入
- `litellm-config.yaml` 落盘
- 启动脚本
- 真实网络调用
- Claude Code 进程接线

## 目录映射

| CC Skill 概念 | 迁移后位置 | 说明 |
|--------------|-----------|------|
| 模型能力矩阵 | `state.py` | `ModelProfile` + `create_default_model_profiles()` |
| 路由规则 | `state.py` | `RoutingRule` + `create_default_routing_rules()` |
| 任务分析 | `nodes.py` | `analyze_task_node()` |
| 模型选择 | `nodes.py` | `select_model_node()` |
| fallback | `graph.py` + `nodes.py` | `route_after_selection()` + `apply_fallback_node()` |
| 成本分析 | `nodes.py` | `summarize_node()` 内生成 `CostSnapshot` |
| LiteLLM 适配层 | `tools.py` | `LiteLLMAdapter` + `get_litellm_adapter()` |
| model info / spend / health | `tools.py` | adapter snapshots |
| 新环境依赖 | `../requirements.txt` | 最小 Python 依赖清单 |
| 新环境接入说明 | `../README.md` | 安装步骤 + config auto-discovery |
| 执行流程 | `graph.py` | `analyze -> select -> fallback/finish -> summarize` |

## 流程对照

### Claude Code Skill

```text
任务类型 → 路由规则 → 最优模型 → 执行 → 聚合
```

### LangGraph MVP

```text
START
  -> analyze_task
  -> select_model
      -> summarize
      -> apply_fallback -> summarize
  -> END
```

## 状态映射

### CC Skill 中的隐式状态

- 当前任务类型
- 复杂度判断
- 推荐模型
- fallback 列表
- 成本考虑

### 迁移后的显式状态

```python
class MultiModelState(TypedDict):
    task_request: str
    model_profiles: List[ModelProfile]
    routing_rules: List[RoutingRule]
    task_analysis: Optional[TaskAnalysis]
    routing_decision: Optional[RoutingDecision]
    cost_snapshot: Optional[CostSnapshot]
    monitoring_snapshot: Optional[MonitoringSnapshot]
```

## 关键保留语义

### 1. Best-for-Task

保留方式：

- `TaskAnalysis.task_type`
- `RoutingRule.task_types`
- `select_model_node()` 按任务类型选模型

### 2. Cost-Aware

保留方式：

- `TaskAnalysis.complexity`
- `CostSnapshot.cost_tier`
- `summarize_node()` 输出预算说明

### 3. Graceful Fallback

保留方式：

- `RoutingRule.fallback_models`
- `get_default_fallback_chain()`
- `apply_fallback_node()`

### 4. Transparent Proxy

保留方式：

- `tools.py` 提供 LiteLLM config / model info / spend log adapter
- adapter 会自动发现 LiteLLM config 与 endpoint 环境变量
- 但 MVP 只提供本地 stub，不接真实服务

## 为什么不迁部署层

原 skill 同时包含两类内容：

1. **决策层**：哪些任务该用哪个模型
2. **部署层**：如何启动 LiteLLM、如何配置 `.env`、如何让 Claude Code 走代理

MVP 只迁第一类，原因是：

- 决策层可复用于其他 graph / agent runtime
- 部署层高度依赖本地环境和密钥管理
- 若一开始就迁部署层，会把“框架迁移”扩大成“环境重建”

## 与现有 migrated 样例的对齐

### 对齐点

- 使用 `state.py` / `graph.py` / `nodes.py` / `tools.py` / `__init__.py` 五件套
- 由 `graph.py` 负责组装 `StateGraph`
- 节点函数返回 `Dict[str, Any]` 的 state patch
- `__init__.py` 统一导出公开入口

### 有意不同

- 未引入 `verification.py`
  - 原因：本对象不是 verification 子图
- 未引入真实 CLI tool wrapper
  - 原因：本对象核心是 routing policy，不是 shell/CLI 集成

## 后续扩展方向

如果后续确认要继续扩展，可按以下顺序推进：

1. 为 `tools.py` 接入真实 LiteLLM HTTP client
2. 将 `health_check()` / `fetch_model_info()` / `fetch_spend_logs()` 从 stub 替换为真实实现
3. 为 `compile_multi_model_graph_with_checkpoint()` 增加人工审批 interrupt
4. 与 `orchestrate` 集成，给 implementer / reviewer / researcher 节点动态分配模型
