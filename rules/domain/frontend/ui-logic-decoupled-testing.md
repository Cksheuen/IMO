---
name: ui-logic-decoupled-testing
description: 当前端已经完成 UI / 逻辑解耦时，功能测试应优先走前端 API / store 调用链，再按需桥接后端能力，而不是退回纯后端测试或直接上 UI 自动化。
triggers:
  - 为已解耦前端编写功能测试
  - 需要决定测试应落在 UI、前端 API、store 还是后端纯逻辑层
  - 用户要求“不要测 UI，但要保留真实调用链”
  - 需要把测试链落成可执行测试代码
---

# UI / 逻辑解耦后的测试编写规范

> 来源：Pingu 项目将功能测试链落成 `TS -> 前端 API / store -> invoke adapter -> Rust test-driver` 调用链后的收敛 | 吸收时间：2026-04-13

## 核心问题

完成 UI / 逻辑解耦后，测试最容易走向两个极端：

- 只测后端纯逻辑，失去真实前端调用链
- 直接上 UI 自动化，成本高且定位慢

真正需要的是：

**不测 UI 细节，但保留前端到后端的真实功能调用链。**

## 核心原则

**功能测试优先落在前端 API / store 层，通过可替换的 bridge / invoke adapter 按需调用后端能力。**

这类测试的目标是验证：

- 前端是否按真实 contract 调用后端
- 前端状态编排是否正确消费返回值
- 后端是否按前端期望处理配置、状态和错误

而不是验证：

- hover / 布局 / 样式 / 像素
- 仅后端纯逻辑的局部正确性

## 适用前提

当满足以下条件时，优先应用本规范：

- 页面层已经较薄
- `src/lib/*`、service、adapter、store、page model 已经存在
- 前端调用通过统一 bridge / API 入口进入后端
- 希望测试功能闭环，但不希望维护昂贵 UI 自动化

## 推荐测试层级

### Layer 1: 后端纯逻辑测试

用途：

- 验证 `AppConfig`、runtime selection、contract builder 等纯模块

价值：

- 快
- 定位准

限制：

- 不覆盖前端真实调用链

### Layer 2: 前端 API / store 调用链测试

这是本规范的主战场。

路径应类似：

`TS test -> 前端 lib API / store -> invoke adapter -> backend test-driver -> runtime / domain`

验证重点：

- 命令名是否对
- 参数 shape 是否对
- 返回 contract 是否被前端正确消费
- store 刷新和状态聚合是否符合预期

### Layer 3: UI 自动化

只保关键交互闭环，不应承担全部功能覆盖。

## 执行规范

### 1. 不要直接从 UI 组件开始写功能测试

如果目标不是测视觉交互：

- 不从 `pages/`、`components/` 开始
- 优先从 `src/lib/*` 或 store 层开始

### 2. 为外部调用入口提供可替换 adapter

例如：

- `tauriInvoke()`
- `bridgeInvoke()`
- `apiClient()`

要求：

- 生产环境走真实能力
- 测试环境可注入替身

### 3. 测试替身应模拟“真实后端接口”，不是随手 mock 返回值

优先方案：

- 后端 test-driver / fake server
- 保持相同 command 名、参数结构、返回结构

不推荐：

- 直接在 TS 测试里把每个 API 函数都手工 stub 成固定 JSON

因为那会绕开真实调用链。

### 4. 测试链要映射到“前端 API 动作序列”

以测试链中的每个原子步骤为单位：

- 节点导入 -> `importNode()`
- 活动节点切换 -> `setActiveNode()`
- 规则组切换 -> `setActiveGroup()`
- 连接状态检查 -> `getStatus()` / store refresh

长链测试本质上是这些 API 调用的有序组合。

### 5. 后端 test-driver 必须兼容前端真实契约

如果前端传的是：

- `Omit<Rule, "id">`
- 可选字段
- 前端侧默认值

那么 test-driver 也必须兼容同样输入，而不是偷偷要求更严格 shape。

否则测试测到的是“测试桥自己的偏差”，不是系统问题。

### 6. 测试运行态必须隔离

例如：

- 临时配置目录
- 临时日志目录
- 每条测试独立 runtime state

禁止共享真实用户配置目录。

### 7. 断言要覆盖“状态消费”，不只覆盖“命令成功”

至少断言：

- 前端 API 返回值
- store 状态刷新结果
- 后端日志 / 状态 contract
- 错误路径的返回与恢复

## 推荐产物

一个完整方案通常包含：

- 后端纯逻辑测试
- 前端调用链功能测试
- 少量 UI 关键路径测试

其中“前端调用链功能测试”应成为主覆盖层。

## 决策框架

```text
要测试的是功能，不是视觉？
    │
    ├─ 否 → 去 UI 测试
    │
    └─ 是 → 项目是否已完成 UI / 逻辑解耦？
            │
            ├─ 否 → 先解耦，再谈稳定测试层
            │
            └─ 是 → 是否需要保留真实前端调用链？
                    │
                    ├─ 是 → TS test -> API/store -> adapter -> backend test-driver
                    │
                    └─ 否 → 可退化为后端纯逻辑测试
```

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 只写 Rust 纯逻辑测试，声称已完成功能测试 | 前端调用链未被覆盖 | 至少补一层 TS API / store 调用链测试 |
| 直接从 UI 组件开始测功能 | 成本高、脆弱、定位慢 | 从前端 API / store 层切入 |
| 在 TS 测试里直接 mock 每个 API 返回值 | 绕开真实调用链 | 用统一 invoke adapter + backend test-driver |
| test-driver 的参数 contract 比真实后端更严格 | 测试桥偏差导致误报 | 兼容前端真实输入 shape |
| 测试写进真实用户配置目录 | 污染本机状态 | 用临时目录隔离 |

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/domain/frontend/ui-logic-boundary.md` | 该规则定义“如何解耦”；本规则定义“解耦后如何测” |
| `rules/domain/shared/testable-architecture.md` | 本规则把可测试架构进一步收敛到“前端 API 调用链测试”实践 |
| `rules/pattern/change-impact-review.md` | 引入调用链测试后，更适合做关键路径回归 |
