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
