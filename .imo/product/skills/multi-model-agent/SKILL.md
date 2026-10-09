---
name: multi-model-agent
description: 已选择有界委派时的 Herdr 执行入口，管理明确的模型路由、预算、生命周期与回收；是否委派先按任务收益和当前授权判断，不要求多模型需求。
---

# Multi-Model Agent

执行路由遵守 `delegated-coding-relay-safety`：先按当前授权、独立边界与总成本
选择直接执行或委派。没有强制委派要求的短闭环或强耦合修改可由主会话完成；
纯问答、计划、必要的有界检查和治理规范维护也留在主会话。
默认使用 Herdr 创建和控制 worker，不调用常规 subagent/spawn 工具替代；只有
当前用户明确指定其他入口或更高优先级宿主要求时才覆盖并记录原因。
本机已选 Herdr/Claude 路由可直接使用，结合 `orchestrate` 管理拆分、依赖与后继；下述通用选型流程仅用于新增路由
设计或用户明确要求其它路由。

## 适用

- 已选择委派一个有界实现、机械修改、验证或其他已授权执行项；一个任务即可触发，不要求多模型。
- Herdr worker 的启动、继续、阻塞处理、回收或后继派发；结合 `orchestrate` 协调。

以下条件只用于决定是否需要额外的模型路由设计，不是使用 Herdr 的前置条件：

- 不同子任务对推理、速度、视觉、代码或长上下文能力要求明显不同；
- 有明确成本/延迟目标并能观测路由收益；
- 需要 provider 冗余或特定数据边界；
- 用户已选择模型 gateway 或要求评估它。

通用路由设计不适用于只想“更智能”或无法管理凭证的场景。小任务复用已选
Herdr 路由和现有 worker，不为它重新设计多模型方案；主会话已有完整上下文时，
重新判断交接是否确有收益，显式委派要求仍优先。

## 本机已选路由：Herdr / Claude

Herdr subagent 的模型必须由当前任务或用户明确选择，不设置跨任务的隐式
默认。具体操作以 [执行规范](references/herdr-claude.md) 为准：全局复用
`codex-use`，每个 Codex 对话一个 workspace，每个 worker 独立 tab，启动显式传
`--permission-mode auto`。主会话负责方案、review、回收和继续派发；Herdr
coordinator 必须把每个生命周期变化回传给主会话。

Herdr 不可用或没有可验证的回传通道时报告原因并有界恢复；允许的主会话接管按
`orchestrate` 的路由/预算协议执行，先收回写集。不能静默切换普通 subagent 或
其他模型；路由选择与实际执行入口分别留证。

## 新增或明确改选模型路由时的工作流

1. 建立单模型基线：质量、延迟、成本、失败类型和任务规模。
2. 按任务能力而非品牌拆分 routing classes，例如：
   `fast-low-risk`、`deep-reasoning`、`code-change`、`multimodal`、`review`。
3. 为每类声明输入敏感度、允许 provider、超时、预算和 fallback。
4. 先启用最少路由规则；未命中时回到明确的默认模型。
5. 记录低基数观测：route id、provider/model id、latency、cost bucket、outcome、
   retry/fallback reason；不记录 raw prompt 或 credentials。
6. 用代表性任务比较基线，只有质量或成本收益稳定时才保留路由。

## 路由原则

- 显式任务标签优先于关键词猜测；
- 质量门槛优先于最低价格；
- fallback 必须有最大次数和总预算；
- provider 不可用时清晰降级，不静默换到不满足数据政策的模型；
- 并行调用只用于真正独立或需要多评审视角的任务；
- 模型名称、价格和 API 配置属于易变信息，实施前查官方当前文档。

## Provider contract

至少声明：

```text
provider id
endpoint/config source
credential boundary
allowed data class
timeout and retry budget
fallback order
cost/latency limits
observability fields
disable switch
```

凭证只来自运行环境或批准的 secret store，不写入 skill、repo 配置示例或日志。

## 与编排的边界

Orchestration 决定任务依赖、并行、聚合和 return channel；本技能只决定已确认执行项
的模型路由。不要因存在多模型就创建更多 agents，也不要让路由层吞掉生命周期事件。

已有迁移实现与对照材料按需读取本目录 `migrated/` 和
`litellm-proxy-config.md`；后者仅作本地参考，使用前必须核对当前 provider 文档。

## 验证

- 路由规则有确定性单测；
- provider 缺失、超时、限流和预算耗尽有聚焦 smoke；
- fallback 不突破数据与成本边界；
- 可用指标证明相对单模型基线的收益；
- 关闭路由后仍能走清晰的单模型路径。

## 禁止

- 硬编码 credentials；
- 把具体模型排行榜或价格长期写进规则；
- 无限 retry 或循环 fallback；
- 用多模型掩盖模糊任务拆分；
- 没有观测和退出条件就上线动态路由。
