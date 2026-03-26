# Browser Agent Architecture Pattern

> 来源：[browser-use/browser-use](https://github.com/browser-use/browser-use) | 吸收时间：2026-03-26

## 触发条件

当设计 LLM 驱动的浏览器自动化系统时，应用此规范：
- 需要让 Agent "理解"网页并自主操作
- 追求高鲁棒性（网站布局变化不影响功能）
- 需要多模态理解（DOM + 视觉）

## 核心原则

**三层解耦架构：理解 → 规划 → 执行**

将 Agent 系统分层设计，每层职责清晰，便于独立迭代。

## 架构规范

### 三层架构

```
┌─────────────────────────────────────────────────────┐
│                   LLM Layer                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Task Parser │→ │ Planner     │→ │ Action Gen  │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│         ↑                                    ↓      │
│    Natural Lang                          Actions    │
└─────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────┐
│               DOM/Vision Layer                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ DOM Extract │→ │ Serialize   │→ │ Index Map   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│         ↑                              ↓            │
│      Raw HTML                       Selector Map    │
└─────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────┐
│              Browser Control Layer                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Playwright  │→ │ CDP Bridge  │→ │ Execution   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│         ↑                              ↓            │
│    Browser API                       Actions        │
└─────────────────────────────────────────────────────┘
```

### 各层职责

| 层级 | 职责 | 输入 | 输出 |
|------|------|------|------|
| LLM Layer | 理解任务、规划步骤、生成动作 | 自然语言 + 页面状态 | 结构化动作 |
| DOM/Vision Layer | 提取页面结构、索引元素 | Raw HTML | Selector Map + Screenshot |
| Browser Control Layer | 执行动作、管理会话 | 动作指令 | 页面状态变更 |

## 关键设计模式

### 1. Element Indexing（元素索引）

**问题**：LLM 如何精确定位网页元素？

**解决方案**：
```
1. DOM Tree Traversal
   └─ 遍历 DOM 树，识别可交互元素

2. Index Assignment
   └─ 为每个可交互元素分配唯一索引（backend node ID）

3. Selector Map
   └─ 建立 index → element 的映射关系

4. LLM Output
   └─ LLM 输出 click(index=12345) 而非 CSS selector
```

**可交互元素识别标准**：
- 原生交互元素：`<button>`, `<a>`, `<input>`, `<select>`
- 事件绑定：`onclick`, `addEventListener`
- ARIA 角色：`role="button"`, `role="link"`
- 样式提示：`cursor: pointer`
- Shadow DOM：穿透 shadow root

### 2. DOM Serialization（DOM 序列化）

**问题**：如何让 LLM 理解复杂的 DOM 结构？

**解决方案**：
```
Raw HTML (可能 100KB+)
    │
    ↓ DOM Serializer
    │
LLM-Friendly Format (几 KB)
    ├─ 只保留可交互元素
    ├─ 层级结构保留
    ├─ 文本内容精简
    └─ 添加索引标注
```

**示例输出**：
```html
<div id="header">
  <button [123]>Menu</button>
  <input [124] placeholder="Search">
</div>
<nav>
  <a [125] href="/products">Products</a>
  <a [126] href="/about">About</a>
</nav>
```

### 3. Hybrid Understanding（混合理解）

**问题**：仅靠 DOM 无法理解视觉布局

**解决方案**：
```
┌─────────────┐     ┌─────────────┐
│ DOM Extract │     │ Screenshot  │
└──────┬──────┘     └──────┬──────┘
       │                   │
       ↓                   ↓
┌─────────────┐     ┌─────────────┐
│ Structured  │     │ Visual      │
│ Context     │     │ Context     │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └───────┬───────────┘
               ↓
         LLM Decision
```

**适用场景**：
- DOM 理解：表单填写、链接点击、文本提取
- Vision 理解：布局判断、视觉验证、复杂 UI

### 4. Session Persistence（会话持久化）

**问题**：如何保持登录状态和上下文？

**解决方案**：
```python
# 会话级别状态
class BrowserSession:
    cookies: dict
    localStorage: dict
    navigation_history: list

# 跨任务复用
session = Browser(keep_alive=True)
# Agent 1: 登录
# Agent 2: 执行任务（继承登录状态）
```

## 决策框架

### 是否需要 Vision 增强？

```
任务类型？
    │
    ├─ 纯文本操作（表单填写、链接点击）
    │   └─ DOM Only → 成本低
    │
    └─ 视觉判断（布局验证、样式检查）
        └─ DOM + Vision → 准确性高
```

### 索引策略选择

| 策略 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| Backend Node ID | 动态页面 | 唯一稳定 | 需要 CDP |
| XPath | 静态页面 | 广泛支持 | DOM 变化易失效 |
| CSS Selector | 简单页面 | 直观 | 可能不唯一 |

## 实现检查清单

- [ ] **DOM Layer**
  - [ ] 可交互元素识别器
  - [ ] DOM 序列化器（LLM 友好格式）
  - [ ] Selector Map 维护

- [ ] **LLM Layer**
  - [ ] 任务解析器
  - [ ] 步骤规划器
  - [ ] 动作生成器

- [ ] **Browser Layer**
  - [ ] Playwright/CDP 集成
  - [ ] 会话管理
  - [ ] 错误恢复

- [ ] **多模态**
  - [ ] 截图捕获
  - [ ] 视觉上下文注入

## 性能指标

| 指标 | browser-use 基准 |
|------|------------------|
| WebVoyager 成功率 | 89.1% |
| 单任务成本（10步） | ~$0.07 |
| DOM 处理时间 | 10-100ms |
| 缓存命中率 | 95%+ |

## 相关规范

- [[code-as-interface]] - 代码生成 vs 工具调用的效率对比
- [[generator-evaluator-pattern]] - 多 Agent 架构

## 相关工具

- **browser-use**: `pip install browser-use` - Python 浏览器 Agent 框架
- **Playwright**: `pip install playwright` - 底层浏览器控制
- **dev-browser**: `npm i -g dev-browser` - 代码生成模式（替代方案）

## 参考

- [browser-use GitHub](https://github.com/browser-use/browser-use)
- [Interactive Element Detection](https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection)
- [Browser Agent Architecture Paper](https://arxiv.org/html/2511.19477v1)
