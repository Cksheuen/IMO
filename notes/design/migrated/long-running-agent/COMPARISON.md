# Long-Running Agent Techniques: Claude Code vs LangGraph 对照

本文档记录 `long-running-agent-techniques.md` 到 LangGraph 的最小迁移对照。

## 概念映射

| Claude Code 概念 | LangGraph 概念 | 说明 |
|-----------------|---------------|------|
| Initializer Agent | `initializer` 节点 | 首次展开 task，生成 `feature_list` 和 `init_script` |
| Coding Agent Loop | `pick_feature -> implement_feature -> verify_feature -> update_progress` | 每次只做一个 feature |
| `feature_list.json` | `feature_list: List[FeatureItem]` | 显式状态字段 |
| `progress file` | `progress_log: List[ProgressEvent]` | 跨 session 进度事件 |
| `init.sh` | `init_script` | 启动环境的命令字符串 |
| `handoff.md` | `handoff: HandoffPayload` | Context reset 的紧凑载荷 |
| Context Anxiety | `context_anxiety` | 由迭代阈值触发 |

## 架构对照

### Claude Code: 双层 Harness

```text
Initializer Agent
    ├─ feature_list.json
    ├─ init.sh
    └─ progress file

Coding Agent Loop
    ├─ restore state
    ├─ run init.sh
    ├─ pick one feature
    ├─ implement
    ├─ verify
    ├─ update progress
    └─ all pass ? end : continue
```

### LangGraph: StateGraph

```text
START
  └─ initializer
      └─ restore_context
          └─ environment_check
              └─ pick_feature
                  ├─ no feature ─► mark_completed ─► END
                  └─ implement_feature
                      └─ verify_feature
                          └─ update_progress
                              ├─ all pass ─► mark_completed ─► END
                              ├─ anxiety ─► create_handoff ─► END
                              └─ continue ─► pick_feature
```

## 关键实现差异

### 1. 文件型 artifact 变为状态字段

**Claude Code:** `feature_list.json`、`progress file`、`handoff.md` 是磁盘文件。  
**LangGraph:** 它们被映射为 `feature_list`、`progress_log`、`handoff`。

### 2. “每次只做一个 feature” 由图结构强制

**Claude Code:** 依赖 agent 遵守流程。  
**LangGraph:** `pick_feature` 每次只选一个 feature，后续路径固定走单次实现和单次验证。

### 3. Context reset 可显式建模

**Claude Code:** 通过生成 handoff 文档后换 session。  
**LangGraph:** 在 `update_progress` 后根据 `context_anxiety` 条件边进入 `create_handoff`。

## 当前边界

本迁移骨架只覆盖控制流，不覆盖：

- 真实浏览器自动化
- 真实 git commit / init.sh 执行
- 真实 progress file 持久化格式
- 多 feature 的复杂优先级调度

这些能力需要在更高层 executor 中对接。
