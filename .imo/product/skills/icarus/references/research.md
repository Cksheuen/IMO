# 当前实现范围

Icarus 已从本机实验迁入独立 workspace。核心默认携带选区评论与本机 Agent 通道；代码说明和 React island 已拆到一 mod 一目录，支持 ZIP、npm 包、按需选择与页面不重载的装卸。

真实 React mod 仍需要宿主传入 React、createRoot 和实际组件；当前不是完整迁移 David 的组件库、富文本编辑器、API 字段联动或设计资料面板。这些能力可以继续实现独立 mod，必须满足副作用清理、来源声明与实际浏览器验证。

CLI 的 enable 成功只代表本机计划已更新；页面状态和功能验证才证明实际挂载。当前包及具体 npm 名称在仓库内准备发布，本次没有执行远端上传。详细开发与使用边界见 [mods.md](mods.md) 与 [feature-contract.md](feature-contract.md)。
