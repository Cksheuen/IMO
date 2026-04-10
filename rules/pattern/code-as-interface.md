# Code-as-Interface Pattern

> 来源：[Sawyer Hood @sawyerhood](https://x.com/sawyerhood/status/2036842374933180660) | 吸收时间：2026-03-26

## 触发条件

当设计 Agent 与外部系统交互的接口时：
- 需要控制复杂系统（浏览器、文件系统、API）
- 追求更少的交互轮次和更低的成本
- 需要可组合、可复用的操作

## 核心原则

**代码生成优先是“接口编排策略”，不是“权限放大策略”。**

让 Agent 生成脚本来编排多步操作，通常比离散工具逐轮调用更高效；但这只在**受限执行边界**内成立。

## 执行规范

### 设计决策框架

```
需要 Agent 控制外部系统？
    ├─ 操作简单、离散、低组合度 → 普通工具调用
    └─ 操作复杂、可组合、需要减少 turns → 受限代码执行 substrate
            ├─ 有 allowlist + 父进程仲裁 + stdout-only 回流 + 资源上限 → 可用
            └─ 缺少上述边界 → 不可用（退回普通工具调用）
```

### 边界区分（必须明确）

| 模式 | 运行方式 | 能力边界 | 回流给模型的数据 |
|------|----------|----------|------------------|
| 普通 shell / tool 调用 | Agent 逐次直接调用工具 | 由当前会话工具权限决定 | 每次调用结果直接进入上下文 |
| 受限代码执行 substrate | Agent 写脚本，子进程运行，工具经父进程 RPC 仲裁 | allowlist tools + 参数拦截 + 资源限制 | 脚本最终 stdout（及受控错误） |
| 无限脚本权限（反模式） | 脚本直接访问任意系统能力 | 无边界 | 不可控，禁止 |

### Hermes `execute_code` 关键 contract（事实对齐）

以下是 Hermes 原始实现强调的最小边界，不得被简化成“脚本随便跑”：

- 工具不是全开：脚本仅能调用 allowlist（如 `web_search`、`read_file`、`patch`、`terminal` 等），并且与当前 session enabled tools 取交集。
- 调用不直连：脚本通过 `hermes_tools.py` stub 发起 RPC，由父进程统一仲裁并分发。
- 参数有拦截：如 `terminal` 的后台执行相关参数会被剥离，避免脚本绕过调度边界。
- 上下文回流受控：中间工具结果不直接灌入模型上下文，主要回流脚本 stdout（并有截断/脱敏）。
- 资源有硬上限：至少包含 timeout、max tool calls、stdout/stderr 大小上限，以及子进程环境变量过滤。

### 本地状态声明（避免误导）

- 当前 `.claude` 本地体系**尚未落地** Hermes 式受限代码执行 runtime。
- 目前主要能力仍是普通 shell/tool 调用、worktree 隔离与规则约束。
- 因此本规则中的受限代码执行属于**未来实现方向**，不是“已具备能力”。

### 未来实现验收门槛（最小集）

若后续实现本地 `execute_code` 能力，至少同时满足：

- allowlist tools（默认拒绝，按会话能力收敛）
- 父进程仲裁/RPC（脚本不能绕过统一调度）
- stdout-only 回流（中间结果不直接污染上下文）
- 资源上限（超时、调用次数、输出大小、环境变量暴露边界）

## 基准认知（保留）

在复杂多步任务中，代码生成可显著降低 turns 和上下文噪音；前提是执行边界完整，而不是放开脚本权限。

## 实践示例

### 代码生成模式

```javascript
// Agent 生成的完整脚本
const page = await browser.getPage("main");
await page.goto("https://example.com");
const items = await page.locator(".item").all();
for (const item of items) {
  if ((await item.textContent()).includes("important")) {
    await item.click();
    break;
  }
}
```

### 对比：工具调用模式

```
Turn 1: goto("...")
Turn 2: query_selector_all(".item")
Turn 3-N: get_text(itemN) ...（更多轮次）
```

## 检查清单

- [ ] 当前任务是否真的需要“脚本编排”而不是普通工具调用？
- [ ] 若使用代码执行，是否有 allowlist + 父进程仲裁 + stdout-only + 资源上限？
- [ ] 是否避免把“代码生成 > 工具调用”误读为“可无限执行脚本”？
- [ ] 文档是否清楚标注“本地已实现”与“未来方向”的边界？

## 相关规范

- [[generator-evaluator-pattern]] - 多 Agent 架构
- [[context-injection]] - 上下文注入

## 相关工具

- **dev-browser**: `npm i -g dev-browser && dev-browser install`
- **Playwright MCP**: Claude Code 内置浏览器控制

## 参考

- [dev-browser GitHub](https://github.com/SawyerHood/dev-browser)
- [dev-browser-eval](https://github.com/SawyerHood/dev-browser-eval)
