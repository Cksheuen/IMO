# Agent-Browser 工具规范

> 来源：[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | 吸收时间：2026-03-26

## 触发条件

当需要浏览器自动化且满足以下条件时：
- 已有 Agent 需要浏览器操作能力（而非让浏览器工具自己规划）
- 追求轻量级，不想配置 MCP 服务器
- 需要 CLI 命令调用方式

## 核心特性

| 特性 | 说明 |
|------|------|
| **Ref-based 选择** | 通过 `@e1`, `@e2` 引用元素，比 selector 更稳定 |
| **AI-First 输出** | 命令输出格式专为 LLM 设计 |
| **Client-Daemon 架构** | Rust CLI + CDP daemon，持久化会话 |

## 安装

```bash
npm install -g agent-browser && agent-browser install
```

## 核心命令

```bash
# 工作流
agent-browser open example.com      # 打开页面
agent-browser snapshot              # 获取元素引用 → [@e1] button, [@e2] textbox
agent-browser click @e1             # 操作元素
agent-browser screenshot page.png   # 验证结果

# 元素查找
agent-browser find role button click
agent-browser find text "Submit" click
agent-browser find label "Email" fill "test@example.com"

# 状态管理
agent-browser state save auth.json  # 保存会话
agent-browser state load auth.json  # 恢复会话
```

## 决策框架

```
需要浏览器自动化？
    │
    ├─ Agent 需要自主规划 → browser-use（Python 库）
    ├─ 外部 Agent + CLI 调用 → agent-browser（本工具）
    ├─ 需要 MCP 集成 → Playwright MCP
    └─ 需要代码生成 → dev-browser
```

## 工具对比

| 维度 | agent-browser | browser-use | Playwright MCP | dev-browser |
|------|---------------|-------------|----------------|-------------|
| **索引方式** | `@e1, @e2` | `[backend_id]` | CSS selector | 代码生成 |
| **交互方式** | CLI | Python API | MCP tools | 代码执行 |
| **Token 效率** | 高 | 中 | 低 | 最高 |
| **配置复杂度** | 低 | 中 | 高 | 中 |

## 检查清单

- [ ] 使用 `snapshot` 获取引用后再操作
- [ ] 保存认证状态以复用会话
- [ ] 处理元素不存在的情况

## 相关规范

- [[browser-agent-architecture]] - 浏览器 Agent 架构模式
- [[code-as-interface]] - 代码生成效率对比

## 参考

- [agent-browser GitHub](https://github.com/vercel-labs/agent-browser)
- [Pulumi Blog - Self-Verifying AI Agents](https://www.pulumi.com/blog/self-verifying-ai-agents-vercels-agent-browser-in-the-ralph-wiggum-loop/)
