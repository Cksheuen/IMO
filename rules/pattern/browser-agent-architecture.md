# Browser Agent Architecture Pattern

> 来源：[browser-use/browser-use](https://github.com/browser-use/browser-use) | 吸收时间：2026-03-26

## 触发条件

当设计 LLM 驱动的浏览器自动化系统时：
- 需要 Agent "理解"网页并自主操作
- 追求高鲁棒性（布局变化不影响功能）
- 需要多模态理解（DOM + 视觉）

## 核心原则

**三层解耦架构：理解 → 规划 → 执行**

| 层级 | 职责 | 输入 → 输出 |
|------|------|-------------|
| LLM Layer | 理解任务、规划步骤、生成动作 | 自然语言 → 结构化动作 |
| DOM/Vision Layer | 提取页面结构、索引元素 | Raw HTML → Selector Map |
| Browser Control Layer | 执行动作、管理会话 | 动作指令 → 页面状态 |

## 关键设计模式

### Element Indexing

**问题**：LLM 如何精确定位网页元素？

**方案**：为每个可交互元素分配唯一索引（backend node ID），LLM 输出 `click(index=12345)` 而非 CSS selector。

### DOM Serialization

**问题**：如何让 LLM 理解复杂 DOM？

**方案**：Raw HTML (100KB+) → LLM-Friendly Format (几 KB)，只保留可交互元素。

```html
<div id="header">
  <button [123]>Menu</button>
  <input [124] placeholder="Search">
</div>
```

### Hybrid Understanding

| 模式 | 适用场景 | 优势 |
|------|----------|------|
| DOM Only | 表单填写、链接点击 | 成本低 |
| DOM + Vision | 布局判断、视觉验证 | 准确性高 |

## 决策框架

```
任务类型？
    ├─ 纯文本操作 → DOM Only（成本低）
    └─ 视觉判断 → DOM + Vision（准确性高）
```

**索引策略**：Backend Node ID（动态页面）> XPath（静态页面）> CSS Selector（简单页面）

## Multi-Agent Parallel Isolation

**问题**：多个 Agent 并行操作浏览器时会互相抢占资源吗？

**答案**：会抢占，但有成熟的隔离方案。

### 隔离层级金字塔

```
┌────────────────────────────────────────────────────────────────┐
│  L3: 完全独立浏览器实例                                         │
│      内存占用高 (50-100MB/实例)，完全隔离，不同机器/容器          │
├────────────────────────────────────────────────────────────────┤
│  L2: Browser Context 隔离（推荐）                               │
│      内存占用低 (~1MB)，Cookies/Storage 独立，毫秒级启动         │
├────────────────────────────────────────────────────────────────┤
│  L1: Page (Tab) 级隔离                                         │
│      共享 Cookies/Storage，最低开销，同账号多任务                │
└────────────────────────────────────────────────────────────────┘
```

### 方案对比

| 方案 | 内存开销 | Cookies 隔离 | Storage 隔离 | 启动速度 | 适用场景 |
|------|----------|--------------|--------------|----------|----------|
| **独立浏览器实例** | 高 | ✅ 完全 | ✅ 完全 | 秒级 | 不同用户/账号 |
| **Browser Context** | 低 | ✅ 完全 | ✅ 完全 | 毫秒级 | **推荐默认** |
| **Page (Tab)** | 最低 | ❌ 共享 | ❌ 共享 | 毫秒级 | 同账号并行任务 |

### 实现示例

**Playwright（推荐）**：
```javascript
// 一个 Browser，多个 Context
const browser = await chromium.launch();
const context1 = await browser.newContext();  // Agent 1
const context2 = await browser.newContext();  // Agent 2

await Promise.all([
  runAgent(context1, "Task 1"),
  runAgent(context2, "Task 2")
]);
```

**Browser-Use**：
```python
browser = Browser()
agents = [
    Agent(task=task, browser=browser,
          browser_context=BrowserContext(browser=browser))
    for task in tasks
]
results = await asyncio.gather(*[agent.run() for agent in agents])
```

**CDP 底层**：
```javascript
Target.attachToTarget(targetId)   // 获取独立 session
Target.createBrowserContext()     // 创建隔离 context
```

### 性能边界

| Agent 数量 | 推荐方案 | 注意事项 |
|------------|----------|----------|
| **2-5** | Browser Context | 单机足够 |
| **6-20** | Context + 资源监控 | 内存约 100MB/Agent |
| **> 20** | 云端托管 / 分布式 | Browserbase/自建集群 |

### 隔离决策框架

```
需要并行？
    │
    ├─ 同账号多任务 → Page 级隔离
    │
    ├─ 不同账号/需要隔离 → Browser Context（推荐）
    │
    └─ > 20 Agent 或生产级 → 云端托管
```

### 注意事项

| 风险 | 缓解措施 |
|------|----------|
| 内存泄漏 | 确保每次 `context.close()` |
| 端口冲突 | CDP 动态端口分配 |
| 元素引用失效 | 使用 stable selector（role/text） |

## 实现检查清单

| 层级 | 必需组件 |
|------|----------|
| DOM | 元素识别器、序列化器、Selector Map |
| LLM | 任务解析器、规划器、动作生成器 |
| Browser | Playwright/CDP、会话管理、错误恢复 |

## 相关规范

- [[code-as-interface]] - 代码生成效率对比
- [[agent-browser]] - AI-First 浏览器自动化 CLI

## 相关工具

| 工具 | 交互方式 | 索引格式 | 适用场景 |
|------|----------|----------|----------|
| **browser-use** | Python API | `[backend_id]` | Agent 自主规划 |
| **agent-browser** | CLI 命令 | `@e1, @e2` | 外部 Agent 调用 |
| **Playwright MCP** | MCP tools | CSS selector | MCP 集成 |

## 参考

- [browser-use GitHub](https://github.com/browser-use/browser-use)
- [Browser Agent Architecture Paper](https://arxiv.org/html/2511.19477v1)
