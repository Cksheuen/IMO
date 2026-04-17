---
paths:
  - "src/**/*"
  - "lib/**/*"
  - "tasks/**/*"
  - "**/feature-list.json"
---

# Agent 自验证机制

> **来源**: harness 设计哲学 + long-running-agent-techniques
> **吸收时间**: 2026-03-31

## 核心洞察

实现完成不等于任务完成。Agent 应在交付前自动进入验证与修复循环，直到：

- 所有 feature 通过验证
- 或达到迭代上限并显式转入人工干预

## 问题诊断

| 问题 | 表现 |
|------|------|
| 过早宣布完成 | 看到局部进展就结束 |
| 无验证闭环 | 需要用户手工叫 reviewer |
| 无限迭代 | 验证失败后无上限重试 |

## 解决方案

### 核心机制

1. `feature-list.json` 承担结构化状态跟踪
2. reviewer 失败时必须输出 `delta_context`
3. implementer 根据 `delta_context` 进入 fixer loop
4. `max_attempts` 防止无限修复
5. 验证由 orchestrate / reviewer 流程主动触发，不再依赖 Stop hook 自动门控

### 正常流程

```text
实现完成
  -> reviewer 验证
  -> 更新 feature-list
  -> 全部通过则允许结束
```

### 失败流程

```text
reviewer 判定失败
  -> 输出 delta_context
  -> 主 agent 派发 implementer 修复
  -> passes 重置为 null
  -> reviewer 再次验证
```

> **注意**：`verification-gate.sh` 已从自动 Stop hook 中移除（2026-04-15），不再在每次 Stop 时自动阻止退出。验证循环由 orchestrate 的 Step 7 或手动 `/task-audit` 触发。

## 关键约束

- `passes=false` 时必须附带 `delta_context`
- 主 agent 负责调度，不直接手工修代码
- 新 implementer 只读 `files_to_read`
- `attempt_count` 必须递增
- 超过 `max_attempts` 后标记 `blocked` 或转人工处理

## Feature List 最小要求

每个 feature 至少要有：

- `id`
- `description`
- `acceptance_criteria`
- `verification_method`
- `passes`
- `attempt_count`
- `max_attempts`
- `notes`
- `delta_context`

## Delta Context 最小要求

至少包含：

- `problem_location`
- `root_cause`
- `fix_suggestion`
- `files_to_read`
- `files_to_skip`

不要只写“没通过”或“修一下这里”；必须给下一个 implementer 可直接消费的修复上下文。

## 与 orchestrate 的关系

- orchestrate 负责拆分任务并建立 `feature-list.json`
- reviewer 负责验证与回写状态
- verification gate 负责阻止未验证任务静默结束
- fixer loop 负责把失败结果重新送回 implementer

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 未创建 `feature-list.json` | 分解后立即创建 |
| reviewer 失败但不写 `delta_context` | 失败时必须输出结构化定位 |
| 主 agent 自己下场修代码 | 改为派发 implementer |
| implementer 重读全仓 | 按 `files_to_read` 收窄上下文 |
| 无上限重试 | 用 `max_attempts` 保护 |
| 跳过验证直接退出 | 在 orchestrate 流程中主动运行 reviewer |

## 文件位置

| 文件 | 路径 | 作用 |
|------|------|------|
| Feature List | 当前项目 `tasks/current/feature-list.json` | 状态跟踪 |
| Verification Gate | `~/.claude/scripts/verification-gate.sh` | 手动验证工具（已从自动 Stop hook 移除） |
| Reviewer Agent | `~/.claude/agents/reviewer.md` | 验证与回写 |
| Orchestrate Skill | `~/.claude/skills/orchestrate/SKILL.md` | 分解与调度 |

## 参考文件

- `notes/design/self-verification-protocol.md`：schema、jq 更新样例、完整 fixer loop
- `rules/pattern/generator-evaluator-pattern.md`
- `rules/technique/long-running-agent-techniques.md`
