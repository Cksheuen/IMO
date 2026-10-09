# Herdr → Claude 子代理执行规范

主会话负责目标、ownership、调度、回收、review 与验收；Herdr worker 负责有界执行。
Herdr 是执行和生命周期通道，不是完成判定或后继任务调度器。

## 路由与模型

- 是否委派由 `orchestrate` 按任务耦合、交接成本与当前授权决定。已选择的有界委派使用 Herdr，不要求多任务或多模型需求；显式委派要求仍优先。
- worker/implementer/reviewer/fixer 都是 Herdr 管理的执行角色；常规 subagent/spawn 工具不是默认或失败回退入口。当前用户明确指定或更高优先级宿主要求的例外必须留证，不能计为 Herdr 使用。
- Herdr worker 使用当前任务或用户明确指定的模型；当前任务的选择优先于历史默认。
- 启动参数、进程存在、`working`、`idle` 或 `done` 状态都只是生命周期证据，不能直接证明项目交付完成。
- 路由失败、worker 不可达或模型响应异常必须回传为结构化事件，不得静默换路由。

## 前置检查

1. 检查 `HERDR_ENV=1`、`command -v herdr claude`，并按需读取当前安装版本的帮助。
2. 全局只复用 `codex-use`；不存在时创建，已存在时复用，不接管用户的 `default` 或其他对话。
3. 当前任务必须先登记 coordinator、return channel、workspace、tab、pane、允许 cwd、ownership 和后继依赖。

## Session / workspace / tab

- 一个 Codex 对话对应一个 Herdr workspace；每个 worker 使用独立的命名 tab。
- 每条控制命令显式指定 `--session codex-use` 和上一步返回的 workspace/tab/pane ID，不猜 ID，不使用隐式焦点。
- 初始 workspace 使用 `workspace create --cwd <absolute-path> --label <task-thread> --no-focus`；后续 worker 使用 `tab create` 并消费返回的 `root_pane.pane_id`。

## 启动与下发

```bash
herdr --session codex-use agent start <work-agent> --kind claude --pane <pane-id> -- \
  --setting-sources user --permission-mode auto --model <selected-model>
```

- 启动返回后立即记录 `agent_id`、argv、workspace、tab、pane 和 `started` 事件。
- prompt 必须包含目标、允许/禁止写集、依赖、验收范围、禁止递归委派、return channel 和紧凑返回格式。
- busy worker 的追加消息必须关联原 task id；追加消息本身不代表新一轮已经开始。

## 持久监听与主会话唤醒

- worker 启动前必须先启动持久 coordinator。coordinator 维护 task state、successor queue 和 append-only lifecycle event inbox。
- coordinator 使用 Herdr 原生 `agent wait` 监听生命周期；不要用一次性的 `agent prompt --wait`、有界 shell 等待或后台日志冒充持续监听。
- 每个状态变化都必须先写入 event inbox，再通过已验证的 return channel 唤醒主会话。验证标准是“Herdr 状态变化 → coordinator 收到 → 主会话收到”。
- 如果当前宿主没有能唤醒主会话的 return channel，就不得把任务标记为 background；应保持当前协调回合，或明确返回 `no_return_channel` 阻塞。
- 监听器可以采集并转发状态，但不能吞掉事件、替主会话做验收或静默决定后继任务。

## 生命周期事件与介入

以下事件全部需要唤醒 coordinator，不能只监听 `done`：

| Herdr 状态 / 事件 | 主会话动作 |
| --- | --- |
| `working` | 记录进展，检查是否超出 ownership 或超时 |
| `idle` | 立即读取当前输出，判断是等待继续、自然停顿还是已经返回 |
| `done` | 立即读取最终可见输出并启动验收；不能等待产物出现 |
| `blocked` | 立即读取阻塞界面，决定回答、批准、收缩范围或报告阻塞 |
| `unknown` / process exit | 立即读取 pane 和错误证据，分类为恢复、重试或中止 |

`done`、`idle`、`blocked`、`unknown` 都是“需要主会话介入”的信号，不是最终项目状态。
diff、文件、测试和 final summary 是验收证据；它们缺失时仍必须唤醒主会话处理异常。

## 埋点与效果检查

按 [Herdr 埋点设计](../../../../runtime/observability/herdr-telemetry.md) 登记可委派任务与路由原因，并关联 dispatch、生命周期 occurrence、入箱、通知、主会话真实消费、介入和后继启动。未使用 Herdr 的可委派任务也进入触发率分母；未收到、无产物、异常和等待决定都必须可对账。

通知发送成功不等于主会话收到；消费回执只能在主会话实际消费时产生。`source=fixture/replay` 不得用于证明实际生效。检查时分别报告规范已定义、采集已接线、真实唤醒已验证、后继推进已验证；缺少真实回执或独立预期清单就标为未验证，不能凭零错误宣称正常。

## Review / 后继推进

每个 lifecycle event 都按以下顺序处理：

```text
收到事件 → 读取 worker 输出 → 更新 task state → review / 回答阻塞 / 恢复
→ 验收当前结果 → 仅在依赖满足时派发 successor
```

独立 successor 在前置 worker 进入可继续状态后立即派发；不得等待无关 worker，也不得把作者自报成功当成验收。

## 失败与回收

- `blocked` 先读取原因再决定动作；不得因为显示 `blocked` 就关闭 worker。
- `unknown`、进程退出或 return channel 丢失必须留下结构化失败事件和下一动作。
- 同一策略连续失败三次后重新规划；不无限重试。
- 达到预算、路由失效或需要主会话接管时，执行 `orchestrate` 的有界恢复与授权检查；停止相关 worker 并回收写集后再继续，不重开账本绕过限制。
- 只有当前对话创建且已经验收、没有待处理后继的 agent/tab/workspace 才能清理；保留 `codex-use`。
