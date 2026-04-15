---
paths:
  - "src/**/*.{ts,tsx,js,jsx}"
  - "app/**/*.{ts,tsx,js,jsx}"
  - "components/**/*.{ts,tsx}"
  - "pages/**/*.{ts,tsx}"
  - "hooks/**/*.{ts,tsx}"
  - "store/**/*.{ts,tsx}"
---

# 前端 UI / 逻辑边界规范

> 来源：对 “容器（数据/行为）与展示（UI）解耦” 在个人项目中部分生效问题的收敛优化 | 吸收时间：2026-04-13

## 核心问题

原有表述只有方向，没有执行门槛：

- 没有明确个人项目里的分层映射
- 没有说明哪些逻辑允许留在页面里
- 没有说明何时必须从页面抽到 store / hook / service / adapter
- 没有覆盖桌面壳、浏览器 API、本地 bridge、后端接口等不同运行时
- 没有定义“小项目 -> 中期项目 -> 完整分层”的演进路径

结果是 Agent 容易做到“有一点分层就算解耦”，但页面仍持续变胖。

## 核心原则

**页面负责呈现，状态层负责编排，服务 / adapter 层负责对外调用，运行时 / 后端负责能力与事实。**

补充约束：

- `service / adapter / bridge / command handler` 是边界层，不是核心业务逻辑落点
- 核心状态变更、校验、派生与 contract 拼装应收口到可直接引用、可直接测试的纯模块
- UI 解耦不仅要求“页面不直连外部调用”，也要求“边界层不吞掉领域逻辑”

## 触发条件

当满足以下任一条件时，必须应用本规范：

- 修改 `src/pages/**`、`src/components/**`
- 修改 `src/hooks/**`、store、view model、controller
- 修改 `src/lib/api.ts`、service、adapter、bridge 之类的调用入口
- 页面需要展示运行时状态、触发异步动作、访问系统能力、调用接口或 bridge

## 通用分层映射

| 层 | 典型位置 | 职责 | 不应承担 |
|----|----------|------|----------|
| **View** | `pages/`、`components/` | 渲染、事件分发、轻量显示格式化 | 直接请求、跨命令编排、运行时快照拼装 |
| **ViewModel / State** | `hooks/`、store、controller | 聚合 UI 所需状态、触发刷新、封装交互流程 | 直接操作 DOM 细节之外的系统能力 |
| **Service / Adapter** | `api.ts`、`services/`、`adapters/`、`bridge/` | 唯一的外部调用入口，统一 contract 与错误边界 | 页面展示逻辑、视觉判断 |
| **Runtime / Backend** | 本地 runtime、bridge handler、后端 command / API | 系统能力、运行时事实、持久化、配置生成 | 前端展示策略、页面文案判断 |

补充说明：

- 桌面应用中的 Tauri / Electron `invoke handler`、bridge command、controller endpoint，默认都归入 **Service / Adapter / Boundary** 角色，而不是领域实现本体。
- 若某段逻辑离开 command handler 后仍然成立、仍需要复用或仍值得单测，则它不应继续留在 handler 内。

## 生命周期策略

**所有项目都从小项目开始，但不能永远按小项目规则写。**

本规范采用三阶段演进，而不是一刀切：

| 阶段 | 适用状态 | 目标 | 允许的简化 | 必须保留的边界 |
|------|----------|------|------------|----------------|
| **Stage 1: Bootstrap** | 单页面 / 单功能起步期 | 快速闭环、避免过早架构化 | 页面可暂时兼任轻量容器 | 不允许页面直接做外部调用；必须经 `service / adapter` |
| **Stage 2: Growth** | 进入中期，交互和状态增多 | 从“能跑”过渡到“可维护” | 可保留少量页面级编排 | 可复用流程必须抽到 `hook / store / controller` |
| **Stage 3: Structured** | 多页面 / 多流程 / 多状态源 | 完整分层、降低回归成本 | 不再依赖页面承载流程 | 页面只消费 contract，不再拼装关键状态 |

## 升级触发器

出现以下任一情况时，必须从当前阶段升级，而不是继续沿用更轻的写法：

- 同类交互流程在第二个页面或组件重复出现
- 单页面文件超过约 `200` 行且仍在增长
- 页面同时管理 `2+` 个异步流程
- 页面同时持有远端状态、运行时状态、配置态中的任意两类以上
- 某个流程已经需要单独测试、复用或被频繁修改
- 页面已经开始理解 retry / reconnect / rollback / optimistic update 之类状态机

## 阶段要求

### Stage 1: Bootstrap

适用于：

- 功能刚起步
- 页面数量少
- 交互链路短

允许：

- 页面兼任轻量容器
- 页面中保留少量一次性状态整形

但仍必须满足：

- 所有外部调用都经 `service / adapter`
- 页面不得直接请求接口、调 bridge、访问系统能力
- 一旦流程开始复用，就不能继续留在页面

### Stage 2: Growth

适用于：

- 项目开始出现第二个相似页面
- 状态切换变多
- 同一交互开始在多个地方共享

必须新增：

- `hook / store / controller` 作为交互编排层
- 页面不再直接管理完整异步流程
- 关键状态字段开始通过明确 contract 提供

允许保留：

- 页面级本地 UI 态
- 与视觉绑定很强、不可复用的轻量格式化

### Stage 3: Structured

适用于：

- 页面、流程、状态源都已明显增长
- 开始出现跨页面联动和回归风险

必须满足：

- 页面只负责渲染、事件分发、轻量格式化
- 复用交互全部进入 `hook / store / controller`
- 关键运行时状态不再由页面自己拼装
- `runtime / backend / service` 直接返回前端消费字段

## 执行规范

### 1. 页面组件默认只做三件事

- 读取已经准备好的状态
- 触发事件回调
- 做轻量显示格式化（如 `formatTime`、空态文案 fallback）

### 2. 页面中出现以下情况时，必须上移逻辑

- 出现直接请求、bridge 调用、系统能力调用
- 一个页面同时管理 `2+` 个异步流程
- 一个页面同时持有“远端状态 + 运行时状态 + 配置态”的拼装逻辑
- 一个页面开始理解 `connect / disconnect / reload / retry` 这类完整流程
- 一个页面为了展示字段而自己跨多个数据源做映射

优先迁移顺序：

1. 外部调用 -> `service / adapter`
2. 交互编排 -> `store / hook / controller`
3. 运行时快照聚合 -> `runtime / backend` 返回 contract
4. 页面只消费最终字段

### 3. 对外 contract 要面向前端消费，而不是面向内部实现

当 UI 需要“当前生效状态 / 当前选中对象 / 当前连接状态”时：

- 不要让页面自己猜测或拼装
- 优先让 `service` 或 `runtime` 直接返回前端可消费字段
- 页面读取最终字段，优于自己拿多个 ID 再推导

### 3.5. Bridge / Command 边界也要满足“纯模块可测”

当项目存在桌面壳、本地 bridge、命令式 handler、controller 时：

- handler 只负责取输入、调纯模块、落盘 / 发请求 / 调系统能力、返回结果
- 领域状态变更、合法性校验、默认值补齐、派生字段拼装，优先抽到纯模块
- contract 组装若不依赖真实外设 / 进程 / 网络，应抽为可直接单测的函数
- 只有真正的 side effect 保留在 handler / runtime adapter 中

判断门槛：

- 如果一段逻辑可以在不启动 UI、不挂 bridge、不起进程的情况下验证，它应该存在于可直接引用的模块，而不是 handler 里
- 如果测试某个核心行为必须先启动 UI 或完整 runtime，说明分层仍未完成

### 4. 允许的轻量例外

以下情况**允许**留在页面，不必为了“纯粹分层”过度拆分：

- 本地 UI 态：弹窗开关、hover、复制成功提示
- 纯显示格式化：时间、尺寸、文案 fallback
- 单个简单按钮触发单个 action，且流程不扩散

但这些轻量例外只适用于 **Stage 1 / Stage 2**。

一旦页面开始持有“可复用的交互流程”或“跨层状态整形”，就必须抽离，不能再以“小项目”为理由保留。

## 判断门槛

```text
这是前端页面改动？
    │
    ├─ 项目是否已触发升级条件？
    │       → 是，进入更高阶段，不再沿用更轻写法
    │
    ├─ 页面里直接请求 / bridge 调用？
    │       → 违规，移到 service / adapter
    │
    ├─ 页面里编排 connect / reload / retry 等流程？
    │       → 移到 store / hook / controller
    │
    ├─ 页面自己拼装运行时 contract？
    │       → 优先移到 runtime / backend / service
    │
    ├─ 只是本地 UI 态或轻量格式化？
    │       → 可留在页面
    │
    └─ 不确定？
            → 先问：这个逻辑离开当前页面后，是否仍可被复用或测试？
               若是 → 不应留在页面
```

## 验收清单

- [ ] 页面 / 展示组件中没有直接对外调用
- [ ] `service / adapter` 是唯一对外调用入口
- [ ] 页面展示的关键运行时字段来自明确 contract，而不是页面自行猜测
- [ ] `store / hook / controller` 承担交互编排，而不是页面组件承担
- [ ] `runtime / backend` 或 `service` 返回的是 UI 需要的最终字段，而不是迫使前端回推内部状态
- [ ] 当前实现方式与项目所处阶段匹配，而不是继续套用过低阶段的豁免
- [ ] bridge / command handler 中没有混入可独立存在的核心状态变更与 contract 拼装逻辑
- [ ] 关键领域行为可以在不启动 UI 的情况下直接按模块引用测试

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 页面直接请求接口 / 调 bridge | UI 与外部能力强耦合 | 经 `service / adapter` 暴露 typed API |
| 页面自己拿多个 ID 去拼“当前生效状态” | 页面开始理解运行时内部状态 | service / runtime 直接返回前端所需字段 |
| 页面里同时写连接、重试、刷新、错误恢复流程 | 页面既是容器又是运行时编排器 | 抽到 store / hook / controller |
| 因为项目小，就把所有逻辑都留在页面 | 规模会沿页面自然膨胀 | 允许小例外，但设置拆分门槛 |
| 已经进入中期，还沿用 Bootstrap 阶段写法 | 轻量化变成长期债务 | 触发升级后立即切到更高阶段 |
| Tauri / bridge command 一边取 state 一边写核心业务逻辑 | 边界层变成隐性 service 层，无法纯测 | command 只做 adapter，逻辑移到纯模块 |
| 关键行为只有端到端 UI 测试能覆盖 | 测试成本高，回归定位慢 | 抽出可直接引用的纯模块单测，UI 只保交互闭环 |

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/domain/shared/testable-architecture.md` | 本规范把“UI 层要薄”具体落到个人项目前端 |
| `rules/pattern/code-as-interface.md` | 本规范要求返回明确前端 contract |
| `rules/pattern/change-impact-review.md` | 拆层后仍需验证关键交互链路 |
| `rules/pattern/cross-layer-preflight.md` | 改 UI 展示前先确认 contract 是否足够 |
