# 浏览器登录态复用技术

> 来源：eat 鉴权问题调研 | 吸收时间：2026-03-26

## 触发条件

当需要操作需要登录态的网页时：
- 抓取需要认证的页面内容
- 操作需要登录的功能（如发布、评论）
- 访问用户私有数据

## 核心原则

**复用用户已登录的浏览器状态，而非重新实现登录流程**

| 原则 | 说明 |
|------|------|
| 用户透明 | 用户可以看到浏览器操作 |
| 最小权限 | 只读取必要 Cookie |
| 本地存储 | Cookie 不上传云端 |
| 懒加载 | 仅在需要时才提取 Cookie |

## 实现方案

### 方案选择框架

```
需要浏览器操作 + 需要鉴权？
    │
    ├─ Chrome DevTools MCP 可用 → 直接在浏览器中操作（推荐）
    │       │
    │       ├─ 打开页面 → 获取内容 → 完成
    │       │
    │       └─ 无需处理 Cookie 传递
    │
    └─ 需要外部请求 → 提取 Cookie + 带 Cookie 请求
            │
            ├─ document.cookie（仅非 httpOnly）
            │
            └─ pycookiecheat（完整 Cookie，需额外安装）
```

### 方案A: Chrome DevTools MCP 直接操作（推荐）

**优势**：无需处理 Cookie 传递，浏览器自动携带登录态

```yaml
workflow:
  1. 打开目标页面:
     tool: mcp__chrome-devtools__new_page(url)

  2. 等待页面加载:
     tool: mcp__chrome-devtools__wait_for(text: [关键内容])

  3. 获取内容:
     tools:
       - mcp__chrome-devtools__take_snapshot()  # a11y 树，适合结构化内容
       - mcp__chrome-devtools__evaluate_script("() => document.body.innerText")  # 纯文本
       - mcp__chrome-devtools__take_screenshot()  # 视觉验证

  4. 操作元素（如需要）:
     tools:
       - mcp__chrome-devtools__click(uid)
       - mcp__chrome-devtools__fill(uid, value)
```

### 方案B: Cookie 提取 + 外部请求

**适用场景**：需要用 WebFetch 或其他工具发起请求

```yaml
workflow:
  1. 提取 Cookie:
     tool: mcp__chrome-devtools__evaluate_script()
     script: "() => document.cookie"
     output: "name1=value1; name2=value2"

  2. 带 Cookie 请求:
     tool: WebFetch / mcp__exa__web_search_exa
     headers:
       Cookie: "{extracted_cookies}"
```

### Cookie 缓存策略

```yaml
cache:
  enabled: true
  path: ~/.claude/cache/cookies/{domain}.json
  content:
    cookies: "cookie_string"
    expires_at: "timestamp"
    source: "chrome_devtools"

  policy:
    - 同一域名缓存 24 小时
    - 请求失败时清除缓存
    - 敏感域名（银行、支付）不缓存

  sensitive_domains:
    - "*.bank.com"
    - "*.pay.com"
    - "*alipay*"
    - "*wxpay*"
```

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 用户未登录目标网站 | 提示"请在 Chrome 中登录 {domain} 后重试" |
| Cookie 已过期 | 清除缓存，重新提取 |
| 页面需要验证码/2FA | 提示用户手动完成验证 |
| httpOnly Cookie 无法获取 | 使用方案A（直接在浏览器操作） |

## 检查清单

- [ ] 确认 Chrome DevTools MCP 可用
- [ ] 检查用户是否已登录目标网站
- [ ] 使用方案A优先（无需处理 Cookie）
- [ ] 必要时才提取 Cookie（方案B）
- [ ] 敏感域名不缓存 Cookie

## 使用此规则的 Skills

- `eat` - 抓取需要登录的页面内容
- `brainstorm` - 调研需要认证的网站
- 任何需要浏览器操作的 skill

## 相关规范

- [[browser-agent-architecture]] - 浏览器 Agent 架构
- [[agent-browser]] - AI-First 浏览器 CLI
- [[code-as-interface]] - 代码生成模式

## 参考

- [Chrome DevTools Protocol - Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- [Playwright Authentication](https://playwright.dev/python/docs/auth)
