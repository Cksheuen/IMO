# UI / 逻辑解耦后的测试调用链经验

## 背景

在 Pingu 项目中，前端已完成一轮 `pages -> hooks/page-model -> lib API -> Tauri command` 解耦。

最初把测试链直接落成了 Rust 纯逻辑测试，随后发现这不足以覆盖真实问题：

- 实际发起调用的是前端
- 前端 API 的参数 shape 与后端结构体并不完全等同
- store 刷新、状态消费、降级逻辑都在前端

因此“只测 Rust”并不能代表“功能已测到调用链”。

## 最终收敛

把测试层收敛为：

`TS test -> src/lib/* API / store -> tauriInvoke adapter -> Rust test-driver -> AppConfig / runtime`

这样保留了：

- 前端命令名
- 前端参数结构
- 前端状态刷新逻辑
- 后端真实能力与 contract

同时又避免了：

- UI 自动化的高成本
- 纯后端测试遗漏调用链问题

## 关键设计

### 1. 单独抽 `tauriInvoke` 适配层

不要在每个 API 文件里直接绑死 `@tauri-apps/api/core`。

理由：

- 测试时可以注入替代实现
- 不需要改页面或 store 测试入口

### 2. 不手工 mock 每个 API

如果直接在 TS 里 mock：

- `importNode()`
- `setActiveGroup()`
- `connect()`

那么测到的只是“测试作者想象中的后端”，不是系统真实调用链。

更好的做法是：

- 保持同样的 command 名
- 通过 Rust test-driver 接住这些调用

### 3. test-driver 必须兼容前端真实输入

实际踩到的问题：

- 前端 `addRule()` 传的是 `Omit<Rule, "id">`
- Rust `Rule` 结构要求 `id`

如果 test-driver 直接按 Rust 严格结构反序列化，就会误报。

结论：

**test-driver 必须对齐前端真实 contract，而不是偷懒复用更严格的内部结构假设。**

### 4. 测试状态必须隔离

实际采用：

- 测试为每次运行创建临时目录
- 同时覆盖 `HOME` 和 `XDG_CONFIG_HOME`

原因：

- 否则 `dirs::config_dir()` 可能落到不可写或真实用户目录
- 会污染本机配置和日志

### 5. 断言要覆盖 store 消费结果

只断言 `invoke` 成功不够。

还要断言：

- `useConnectionStore.refreshAll()` 后的状态
- `getStatus()` 返回的运行态
- `getLogs()` / `clearLogs()` 的结果

## 结论

在 UI / 逻辑解耦已经完成的前提下，功能测试最稳的主层不是 UI，也不是纯后端，而是：

**前端 API / store 调用链测试。**

## 可复用结论

- 解耦是测试分层的前提，不是终点
- 一旦前端是实际调用者，至少要补一层 TS 调用链测试
- backend test-driver 是 bridge / command 型项目里很实用的测试接口
- TS 功能链测试 + 后端纯逻辑测试 + 少量 UI 关键路径，是更稳的组合
