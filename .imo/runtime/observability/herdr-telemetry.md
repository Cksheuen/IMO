# Herdr 使用埋点与效果检查设计

状态：设计已定义；采集接线和真实主会话唤醒仍需实现、验证。本文件不能作为运行能力已生效的证明。

本设计只覆盖 IMO → Herdr → coordinator → 主会话的使用链。复用本目录的事件格式和本地存储，不增加代理网关依赖，也不恢复旧 Claude↔Codex 自动桥。

## 1. 要回答的问题

| 问题 | 必须同时检查的证据 |
| --- | --- |
| 简单任务为什么没有委派？ | 主会话登记的可委派任务、路由决定、未委派原因、实际启动回执 |
| 是否实际用了 Herdr，而非常规 subagent？ | 路由决定、实际启动入口及回执、用户/宿主覆盖依据；不能凭角色名称判断 |
| 状态变了，主会话为什么没收到？ | Herdr 原始事件、inbox 持久化、通知尝试、主会话消费回执，逐段关联 |
| 收到后为什么没处理？ | 消费回执、读取输出、介入动作开始/结束及结果 |
| 处理后为什么没继续？ | 依赖和 ownership 满足的 ready 任务、后继派发及启动回执 |
| 是否仍需要用户催促？ | 宿主触发来源、用户催促事件，以及催促前是否已有自动介入 |

`working`、`idle`、`done`、`blocked`、`unknown`、`process_exit` 都进入链路；无 diff、无文件、异常退出、等待决定的样本不得过滤。生命周期处理成功与任务验收成功分别统计。

## 2. 事件格式与关联

沿用 [event.schema.json](event.schema.json)，不添加当前 writer 会丢弃的自定义字段：

| 字段 | Herdr 约定 |
| --- | --- |
| `event_type` / `plane` | 固定 `orchestrate_worker_event` / `orchestrate` |
| `check_label` | 固定 `herdr-observability/v1`，用来区分指标口径；口径改变必须升级版本 |
| `source` | `live`、`fixture` 或 `replay`；只有 `live` 进入实际效果统计 |
| `trace_id` | 一次主会话协调运行的随机 ID；跨回合恢复沿用，新的独立运行重新生成 |
| `span_id` / `parent_span_id` | 下述 run → task → dispatch → occurrence 关联，不用 pane 名代替 |
| `id` | 一条物理事件的唯一 ID；读入重复行按此去重 |
| `created_at` | 该事件实际记录时间，UTC；不可回填成前一环节的时间 |
| `component` | `herdr_parent`、`herdr_launcher`、`herdr_watcher`、`herdr_notifier`、`herdr_auditor`，按实际执行者填写 |
| `operation` / `phase` | 下表操作名及 `start`、`progress`、`end`、`skip` |
| `status` / `reason` | 有限状态和原因码；禁止塞入日志或 JSON 字符串绕过 schema |
| `count` | 表中指定的尝试序号或 heartbeat 序号，从 1 开始；其他操作省略 |
| `duration_ms` | 同一进程单调时钟测得的本操作耗时；无法测量则省略 |
| `outcome` | 本操作结果；`ok` 只表示本操作成功，绝不表示任务成功 |

关联层级：

- run span：本次协调运行；登记本地原生 task state、inbox、return channel 的引用。
- task span：原生计划中的一个有界任务，parent 为 run。路由和任务状态沿用该 ID；不另建任务管理系统。
- dispatch span：一次实际启动尝试，parent 为 task；失败后重新启动生成新 ID，即使复用 agent/pane。
- occurrence span：一次需要回传的生命周期事件或交互请求，parent 为 dispatch。观察、入箱、通知、消费、介入沿用同一个 ID。

运行记录在宿主现有协调状态中保存上述 ID 与 task、agent、workspace/tab/pane、主会话及 return channel 的映射；原始内容不复制进指标。inbox 用原生事件 ID/cursor 去重；无原生 ID 时保存 dispatch、递增序号和观察依据。每个新交互请求产生新 occurrence，即使状态仍为 `blocked`。重复读取同一状态不制造新 occurrence。

run 记录还应保留实际规则/采集实现 revision、Herdr/宿主版本、选定模型 ID 和通道类型，供前后效果分组；只留版本与类别，不留完整启动参数。缺少版本映射的历史样本标为 unknown，不猜测它使用了哪版修复。

重启监听器先从持久 cursor 恢复、补读，再观察当前状态；补读不生成新的 occurrence。首次快照用 `source_event_type=initial_snapshot`，原生变化用 `native_transition`，交互请求用 `interaction_request`，仅轮询发现用 `poll_observation`。首次观察到停顿或异常仍须介入，但不能声称已测到实际状态变化时间。

同一 occurrence 的重发使用递增 `count`；`herdr.notify` 与 `herdr.parent_received` 通过 occurrence + count 对应。逻辑消费和介入按 occurrence 幂等：重复投递可以重复确认，不能重复批准、回答或派发。诊断重试保留所有尝试；指标按逻辑对象计数，不能用重试次数扩大分母。

## 3. 采集位置与事件表

除 heartbeat 外，事件均在对应事实发生处记录，不能由一个发送器补写整条“成功链”。表中的名称均为 `operation`。

| 操作 | 采集者 / 时点 | span / 关键字段 |
| --- | --- | --- |
| `herdr.run` | parent，协调运行开始和结束 | run；start/end；end status=`completed/failed/cancelled/paused`，仍有未处理事件不得报 completed |
| `herdr.route_candidate` | parent，在路由决定前登记每个计划任务，含最终未使用 Herdr 的任务 | task → run；progress；status=`eligible/not_eligible`，reason 说明任务类别 |
| `herdr.route_decision` | parent，作出选择时，启动前 | task → run；end；status=`delegate/direct/blocked`；reason 必填 |
| `herdr.route_backend` | launcher/parent，按真实启动回执或宿主执行记录确认入口后 | task → run；end；status=`herdr/native_subagent/main/unknown`；例外 reason 必填；计划选择不能充当实际入口证据 |
| `herdr.return_channel` | notifier，握手实际发出后及收到宿主确认后 | run；start/end；status=`verified/no_return_channel`；只有真实确认才 verified |
| `herdr.dispatch` | launcher，执行启动前及 Herdr 返回后 | dispatch → task；start/end；end status=`acknowledged/rejected/unknown`；错误和超时亦记录 |
| `herdr.lifecycle_observed` | watcher，读到状态、交互请求或退出时 | occurrence → dispatch；progress；status=`working/idle/done/blocked/unknown/process_exit`；exit 带 `exit_code`（若可得） |
| `herdr.inbox_persisted` | watcher，inbox 提交成功后 | occurrence → dispatch；end；outcome=ok；未提交不得伪造成功事件 |
| `herdr.notify` | notifier，发送前与传输响应后，每次重发均记录 | occurrence → dispatch；start/end；count=发送序号；end status=`transport_accepted/rejected/unknown` |
| `herdr.parent_received` | parent，实际被唤醒并消费该 occurrence 时 | occurrence → dispatch；end；count=收到的发送序号；reason=`automatic/user_nudge/unknown`，来自宿主触发来源 |
| `herdr.output_read` | parent，回读 worker 当前输出或错误界面后 | occurrence → dispatch；end；status=`available/empty/unavailable`；空输出也继续介入 |
| `herdr.intervention` | parent，作出处理并实际执行前后 | occurrence → dispatch；start/end；status=`record_progress/review/answer/resume/recover/retry/wait_user/abort`；失败单独记录 outcome |
| `herdr.task_state` | parent，实际更新原生任务状态后 | task → run；end；status=`accepted/failed/cancelled/wait_user`；不由 worker 的 done 自动生成 accepted |
| `herdr.task_ready` | coordinator，依赖和写入锁均满足、允许派发时 | task → run；progress；后继仍通过该 task 下的 dispatch 关联 |
| `herdr.successor_decision` | parent，处理 ready 任务时 | task → run；end；status=`dispatch/defer/cancel`；reason 必填；defer 不等于已推进 |
| `herdr.human_nudge` | 宿主入口，识别到用户要求继续/检查该运行时 | run 或已知 task；progress；reason=`remind/check/continue`；不存原文 |
| `herdr.heartbeat` | watcher 与 notifier，各自每 15 秒一次；仅有活动 dispatch/待送事件时 | run；progress；count=各组件序号；pending_count=本组件待处理数 |
| `herdr.gap` | 独立 auditor，对账发现缺失环节/截止时间到期时 | 缺失对象的 span；end；outcome=timeout/error；reason 为缺口码 |

路由原因至少区分 `bounded_implementation`、`explanation_or_plan`、`bounded_read`、`policy_administration`、`user_direct`、`user_route_override`、`host_restriction`、`no_independent_task`、`no_return_channel`、`herdr_unavailable`。`eligible` 按任务性质判定；环境故障仍属于可委派但未成功的样本，不能改成 not_eligible 隐去失败。符合规范的用户/宿主覆盖单列，普通 subagent 的成功不得计为 Herdr 触发或启动成功；缺少实际后端证据标为 unknown。

缺口码至少包括 `route_missing`、`route_bypass`、`backend_mismatch`、`dispatch_unacknowledged`、`observation_gap`、`inbox_missing`、`notify_missing`、`parent_receipt_missing`、`intervention_missing`、`successor_stalled`、`watcher_lost`、`telemetry_incomplete`、`clock_untrusted`。未符合允许例外却跳过 Herdr 或换用普通 subagent，分别报 route_bypass/backend_mismatch。原始采集错误另用 `error_kind` 分类。auditor 的判断不可伪装成缺失的 parent 回执。

## 4. 持久化、计时与丢失处理

- 观测日志继续写入 `~/.imo/projects/<project-id>/runtime/observability/events/YYYY-MM-DD.jsonl`。整个 run 固定同一 project runtime；worker cwd 变化不改变写入归属。日志只用于观测，不能充当协调 inbox 或任务状态。
- 协调 inbox 使用至少一次投递：先持久化，再通知；传输接受后仍保留 pending，直到 parent 以 occurrence 确认消费。parent 的业务消费确认与 best-effort 指标写入分开；指标失败不能让已经执行的动作再次执行。
- 采集失败不能中断业务操作，但该运行的观测结果必须标为不完整。`IMO_DISABLE_EVENTS=1` 表示不可观测，不表示无故障。当前 emit CLI 的退出码不能证明落盘；验收应按事件 ID 或唯一关联键回读文件。
- 单机跨进程延迟按各事件 UTC 时间计算，同时检查时钟回拨/重启；出现负间隔或时钟异常标为 `clock_untrusted`，不截成 0。并发写入顺序不代表因果顺序，按关联和阶段还原。
- 原生状态发生时刻只能从 Herdr 可核验原始事件获得；当前 envelope 的 created_at 是记录时间。轮询只能给“上次未发现—本次发现”的时间区间；不得把 observed→received 冒充完整的状态发生→主会话收到延迟。
- 对账应由独立 audit 执行读取宿主任务记录、真实启动回执/宿主工具调用记录、Herdr cursor/状态证据、inbox、观测日志；提取关联 ID 和入口类别，不复制原文。完全未启动的 watcher 不可能自行报告丢失。没有独立输入时只报告“已记录事件内的覆盖率”，整体效果为未验证。
- 区分业务缺失与埋点缺失：inbox 已有真实消费确认而指标回执缺失，应报 `telemetry_incomplete`；inbox 持续未确认、宿主也未消费且已超时，才有依据判断漏收。用户催促后的接续单列为人工介入，不能覆盖催促前的自动推进失败。

## 5. 指标与判定口径

v1 初始检查预算（设计目标，不是现有性能保证）：路由决定/启动响应各 30 秒；观察后入箱 5 秒；入箱后通知 5 秒；入箱后主会话收到 30 秒；收到后开始介入 30 秒；ready 后后继启动确认 30 秒；heartbeat 间隔超过 45 秒告警。轮询兜底间隔不超过 5 秒，另报告观察盲区。耗时 review/测试只要求及时开始，结束预算由原生任务单独声明。

| 指标 | 分子 / 分母或时间范围 |
| --- | --- |
| 路由记录覆盖率 | 有 candidate 和 decision 的任务 / 宿主独立计划清单内任务；另列缺失数 |
| Herdr 触发率 / 启动成功率 | delegate 决定 / eligible 任务；acknowledged dispatch / 所有 dispatch 尝试；另列 eligible 最终启动覆盖率 |
| 实际 Herdr 后端使用率 | 有 Herdr 启动证据的委派任务 / 所有实际启动的委派任务；native_subagent、允许覆盖、无依据换路由和 unknown 分别列出；计划选择不计实际成功 |
| 生命周期采集覆盖率 | 有 observed 记录的 occurrence / Herdr 原始事件及交互请求；无法取得独立分母则不可计算 |
| 入箱覆盖率 | 成功持久化 occurrence / observed occurrence |
| 自动接收率 | 预算内、宿主来源确认为 automatic 且可关联通知的 received occurrence / 已持久化 occurrence；无通道和超时不剔除 |
| 介入及时率 | received 后预算内出现 intervention start 的 occurrence / 已收到 occurrence；另列 observed→intervention 端到端覆盖，避免漏收者消失 |
| 后继推进率 | ready 后预算内出现 dispatch acknowledged 的任务 / 所有 ready 任务；defer、cancel、失败均单列，不当作已推进 |
| 人工催促率 | 自动介入前发生 human_nudge 的运行 / 宿主触发来源完整的运行；来源未知另列，不以“没记录催促”证明自动化 |
| 任务验收率 | accepted 任务 / 已到验收期限的启动任务；与通知、介入指标分开 |

所有指标同时输出分子、分母、pending、late、unknown 和 p50/p95/max 延迟；比率分母只取观察窗口内且已到截止时间的样本，未到期样本显示 pending。迟到回执保留首次及时性失败，另计最终送达；不能事后抹掉漏推进。延迟分位数仅描述已收到样本，并同时显示超时数。分母为 0 显示 N/A。

按 `check_label`、`source`、生命周期状态和 run 中的实现版本分组，并单列无产物/异常/等待决定场景（依据原生任务与 inbox 证据，不将内容复制进指标）。fixture、replay 不进入 live 统计；调整阈值升级口径版本，不能混算前后数据。前后效果比较使用相同任务类别和观察时长，同时公布样本量。

判定分为三种：**已验证生效**（该窗口内独立清单对账完整、所检查场景均有真实接收和动作证据，预算内达到上表目标）、**未生效**（有明确漏收/未介入/未推进证据）、**未验证**（采集、触发来源或独立分母缺失）。只对已经覆盖的场景下结论；一次成功或零错误不能推广为整体正常。窗口目标默认每个应处理事件均及时处理，任何超时或缺口单列为未通过；不以平均延迟掩盖失败。

## 6. 检查入口与样例

当前可用命令（在该 run 所属项目执行）：

```bash
./imo metrics status
./imo metrics timeline --trace <trace-id> --json
./imo metrics failures --since 7d --json
```

这些命令只提供现有日志读取；当前尚无 Herdr 链路自动审计命令。`failures` 无结果不能证明没有缺失事件。后续 auditor 应实现：读取固定窗口的原生计划/inbox/日志 → 按 ID 去重、关联 task/dispatch/occurrence → 生成每个对象的应有阶段与截止时间 → 对账缺失/迟到/未知 → 输出上述指标及每条缺口的 trace、span、原因和下一调查位置。

下面仅为 schema 兼容的 fixture，不能计为主会话收到过事件：

```json
{
  "schema_version": 1,
  "id": "fixture-receipt-1",
  "created_at": "2026-09-24T01:00:03Z",
  "event_type": "orchestrate_worker_event",
  "trace_id": "fixture-run-1",
  "span_id": "fixture-occurrence-1",
  "parent_span_id": "fixture-dispatch-1",
  "plane": "orchestrate",
  "component": "herdr_parent",
  "operation": "herdr.parent_received",
  "phase": "end",
  "outcome": "ok",
  "privacy": "project_private",
  "check_label": "herdr-observability/v1",
  "source": "fixture",
  "count": 1,
  "reason": "automatic"
}
```

一次检查的报告至少包含：窗口/口径/数据来源、独立预期任务数、已登记任务数、eligible/实际启动数、各环节分母及缺口数、延迟、人工催促数、任务验收结果、缺口定位和未验证项。必须能回答“第几个 worker 的哪次变化，在哪个环节停住”。

## 7. 接入与验证清单

| 场景 | 必须观察到的结果 |
| --- | --- |
| 可委派简单任务与直接处理任务 | 两者都有 candidate/decision；直接处理原因可追溯 |
| 常规 subagent 替代 Herdr / 明确用户覆盖 | 实际入口可核验；未授权替代报 backend_mismatch，允许覆盖单列；两者都不计 Herdr 使用成功 |
| done 且没有任何产物 | 收到 → 回读 → 介入；不得因没有文件而丢弃样本 |
| idle / blocked、连续两次交互请求 | 每个新请求独立回传；主会话回答或明确 wait_user，不能无限挂起 |
| unknown / 非零退出 / pane 消失 | 主会话收到并恢复或报告失败；不能变成 accepted |
| 启动拒绝或启动超时 | dispatch 有失败/未知结果，进入统计和恢复；未开始的 worker 不等 done |
| 通知丢失、重复、乱序、监听器重启 | 缺失会暴露；补送保留关联；动作不重复；cursor 可恢复 |
| 主会话回合已结束 | 真实宿主回传唤醒并接续动作；只写后台日志必须判失败 |
| 有/无依赖的后继，以及写入锁 | ready 按原生依赖计算；及时启动可运行后继；无后继不构造虚假成功样本 |
| 用户先催促才收到 / 来源未知 | 标记 user_nudge / unknown，不计自动接收成功 |
| 禁用埋点、写入失败、watcher 未启动 | 独立审计报告不可观测或缺口，不能输出“0 失败，已生效” |

接入顺序：parent 的预期任务/路由登记 → launcher/watcher/inbox/notifier → 宿主实际消费回执与介入 → 后继调度 → 独立对账。每一步先用临时 runtime 验证格式和故障，再跑真实 Herdr 会话；不得把 fixture 写入生产统计。

完成标准分开记录：① 规范与 schema 相容；② 生产者已接线且事件可回读；③ 真实生命周期到主会话的链路通过；④ 真实后继推进与异常介入通过。当前文档交付只覆盖①，不能宣称②—④已完成。保留原始失败与迟到记录；埋点保持本地，不采集 prompt、完整 argv、源码、密钥或任意文件路径。
