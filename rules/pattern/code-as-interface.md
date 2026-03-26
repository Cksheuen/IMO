# Code-as-Interface Pattern

> 来源：[Sawyer Hood @sawyerhood](https://x.com/sawyerhood/status/2036842374933180660) | 吸收时间：2026-03-26

## 触发条件

当设计 Agent 与外部系统交互的接口时，应用此规范：
- 需要控制复杂系统（浏览器、文件系统、API）
- 追求更少的交互轮次和更低的成本
- 需要可组合、可复用的操作

## 核心原则

**代码生成 > 工具调用**

让 Agent 生成可执行的代码脚本，比调用离散的工具函数更高效。

## 执行规范

### 设计决策框架

```
需要 Agent 控制外部系统？
    │
    ├─ 操作简单、离散 → 工具调用 (MCP)
    │
    └─ 操作复杂、可组合 → 代码生成
        │
        ├─ 安全性要求高 → 沙箱执行 (WASM/VM)
        │
        └─ 安全性要求低 → 直接执行
```

### 实现要点

1. **代码生成接口**
   - 提供完整的 API 文档让 Agent 理解
   - 支持脚本语言的完整语义（循环、条件、函数）
   - 允许 Agent 组合多个操作

2. **沙箱隔离**
   - 使用 QuickJS WASM / VM 隔离执行环境
   - 限制文件系统访问（如只允许特定目录）
   - 禁止主机级别的危险操作

3. **持久化上下文**
   - 支持跨多次脚本执行保持状态
   - 例如：导航一次页面，多次脚本交互

### 基准数据

| 方法 | 时间 | 成本 | Turns | 成功率 |
|------|------|------|-------|--------|
| Dev Browser (代码) | 3m 53s | $0.88 | 29 | 100% |
| Playwright MCP (工具) | 4m 31s | $1.45 | 51 | 100% |
| Playwright Skill | 8m 07s | $1.45 | 38 | 67% |
| Chrome Extension | 12m 54s | $2.81 | 80 | 100% |

**关键发现**：
- 代码生成比工具调用减少 **44% turns**
- 代码生成比工具调用降低 **39% 成本**

## 实践示例

### Dev Browser 设计

```javascript
// Agent 生成的脚本（完整语义）
const page = await browser.getPage("main");
await page.goto("https://example.com");

// 循环、条件都可以使用
const items = await page.locator(".item").all();
for (const item of items) {
  const text = await item.textContent();
  if (text.includes("important")) {
    await item.click();
    break;
  }
}
```

### 对比：工具调用方式

```
# MCP 方式需要多轮交互
Turn 1: goto("https://example.com")
Turn 2: query_selector_all(".item")
Turn 3: get_text(item1)
Turn 4: get_text(item2)
...（更多轮次）
```

## 检查清单

- [ ] 是否提供了完整的代码 API 文档？
- [ ] 是否有沙箱隔离机制？
- [ ] 是否支持跨执行保持状态？
- [ ] 是否有清晰的错误处理？

## 相关规范

- [[generator-evaluator-pattern]] - 多 Agent 架构
- [[context-injection]] - 上下文注入

## 相关工具

- **dev-browser**: `npm i -g dev-browser && dev-browser install` - 浏览器自动化 CLI（可直接安装使用）
- **Playwright MCP**: Claude Code 内置的浏览器控制方案（工具调用模式）

## 参考

- [dev-browser GitHub](https://github.com/SawyerHood/dev-browser)
- [dev-browser-eval](https://github.com/SawyerHood/dev-browser-eval) - 基准测试方法
