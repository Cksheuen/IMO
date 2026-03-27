# Feishu/Lark MCP Server 使用规范

> 来源：[Feishu/Lark CLI / MCP Server 使用手册](https://bytedance.sg.larkoffice.com/docx/HjOVd1XHko6xV8xFISalyEcSgbg)
> 吸收时间：2026-03-27

## 触发条件

当需要让 AI 编程助手操作飞书/Lark 时：
- 创建、读取、更新飞书云文档
- 操作多维表格（Bitable）
- 管理日历、任务、消息
- 搜索知识库文档

## 快速配置

### .mcp.json 配置

```json
{
  "mcpServers": {
    "feishu": {
      "type": "stdio",
      "command": "npx",
      "args": ["@i18n-ecom/feishu-lark-mcp-server", "--registry=https://bnpm.byted.org/"],
      "env": {
        "NPM_CONFIG_REGISTRY": "http://bnpm.byted.org/"
      }
    }
  }
}
```

### 环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `FEISHU_BRAND` | 平台选择 | `feishu`（中国大陆）/ `lark`（国际版） |
| `FEISHU_APP_ID` | 自建应用 ID | 内置默认 |
| `FEISHU_APP_SECRET` | 自建应用密钥 | 内置默认 |
| `FEISHU_ENABLED_TOOLS` | 工具白名单 | 全部启用 |
| `FEISHU_DISABLED_TOOLS` | 工具黑名单 | 无 |

### 国际版配置

```json
{
  "env": {
    "FEISHU_BRAND": "lark"
  }
}
```

---

## 认证机制

### OAuth Device Flow

专为终端环境设计，无需浏览器嵌入：

```
首次调用飞书工具 → 终端输出授权链接 → 浏览器打开 → 点击授权 → Token 自动存储
```

### Token 存储

| 平台 | 存储方式 |
|------|----------|
| macOS | Keychain（`security` 命令管理） |
| Linux | AES-256-GCM 加密文件（`~/.local/share/openclaw-feishu-uat/`） |
| Windows | AES-256-GCM 加密文件（`%LOCALAPPDATA%/openclaw-feishu-uat/`） |

### Token 生命周期

| Token 类型 | 有效期 | 处理 |
|------------|--------|------|
| Access Token | ~2 小时 | 过期前 5 分钟自动刷新 |
| Refresh Token | ~7 天 | 过期后需重新授权 |

### 清除 Token

```bash
# macOS
security delete-generic-password -s openclaw-feishu-uat

# Linux
rm -rf ~/.local/share/openclaw-feishu-uat/
```

---

## 工具过滤策略

> **核心原则**：当工具过多时，AI 容易选错。使用白名单只注册需要的工具，大幅提升准确率。

### 白名单模式（推荐）

```json
{
  "env": {
    "FEISHU_ENABLED_TOOLS": "feishu_create_doc,feishu_fetch_doc,feishu_update_doc"
  }
}
```

### 场景配置推荐

| 场景 | FEISHU_ENABLED_TOOLS |
|------|----------------------|
| **只做文档** | `feishu_create_doc,feishu_fetch_doc,feishu_update_doc,feishu_search,feishu_drive_file,feishu_lark_parser` |
| **只做日程** | `feishu_calendar_event,feishu_calendar_calendar,feishu_calendar_freebusy,feishu_calendar_event_attendee` |
| **只做数据** | `feishu_bitable_app,feishu_bitable_app_table,feishu_bitable_app_table_record,feishu_bitable_app_table_field,feishu_bitable_app_table_view` |

---

## 核心工具分类

### 云文档

| 工具 | 用途 |
|------|------|
| `feishu_create_doc` | 从 Markdown 创建云文档 |
| `feishu_fetch_doc` | 获取文档内容（返回 Markdown） |
| `feishu_update_doc` | 更新文档（覆盖/追加/替换/插入/删除） |
| `feishu_lark_parser` | **推荐** 高质量 Markdown 转换（支持 AI 图片描述、mermaid 画板） |
| `feishu_doc_comments` | 文档评论管理 |
| `feishu_doc_media` | 文档媒体资源管理 |

### 文档获取工具选择

```
需要 AI 增强能力？
    ├─ 是（图片描述、表头提取、mermaid 画板）→ feishu_lark_parser
    └─ 否 → 简单获取 → feishu_fetch_doc
           └─ 大文档分页 → feishu_fetch_doc（支持 offset/limit）
```

**feishu_lark_parser 特有功能**：
- AI 图片描述（`enable_image_caption`）
- AI 表头提取（`enable_table_header_extract`）
- Agent 友好模式（画板/白板 → mermaid，默认开启）
- Wiki URL 直传（无需先解析 token）

### 多维表格（Bitable）

| 工具 | 用途 |
|------|------|
| `feishu_bitable_app` | 多维表格应用管理 |
| `feishu_bitable_app_table` | 数据表管理 |
| `feishu_bitable_app_table_record` | 记录（行）增删改查 |
| `feishu_bitable_app_table_field` | 字段（列）管理 |
| `feishu_bitable_app_table_view` | 视图管理 |

### 日历

| 工具 | 用途 |
|------|------|
| `feishu_calendar_event` | 日程事件 CRUD |
| `feishu_calendar_calendar` | 日历管理 |
| `feishu_calendar_event_attendee` | 参会人管理 |
| `feishu_calendar_freebusy` | 忙闲查询 |

### 任务 & 消息

| 工具 | 用途 |
|------|------|
| `feishu_task_task` | 任务 CRUD |
| `feishu_task_tasklist` | 任务清单管理 |
| `feishu_im_user_message` | 以用户身份发送消息 |
| `feishu_search` | 全局文档搜索 |

### 知识库 & 群聊

| 工具 | 用途 |
|------|------|
| `feishu_wiki_space` | 知识空间管理 |
| `feishu_wiki_space_node` | 知识库节点管理 |
| `feishu_chat` | 群聊管理 |
| `feishu_chat_members` | 群成员管理 |
| `feishu_get_user` | 获取用户信息 |
| `feishu_search_user` | 按关键词搜索用户 |

---

## CLI 命令行模式

```bash
# 认证
feishu-lark auth

# 列出所有工具
feishu-lark list

# 调用工具（JSON 参数）
feishu-lark call feishu_create_doc '{"title":"周报"}'

# 调用工具（Flag 参数）
feishu-lark call feishu_get_user --action=me

# 直接调用
feishu-lark feishu_get_user '{"action":"me"}'

# 启动 MCP Server
feishu-lark serve
```

### 自动化脚本示例

```bash
#!/bin/bash
# 每日站会提醒
feishu-lark call feishu_im_user_message '{
  "action": "send",
  "receive_id_type": "chat_id",
  "receive_id": "oc_your_group_id",
  "msg_type": "text",
  "content": "{\"text\":\"@all 站会即将开始！\"}"
}'
```

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 授权失败「授权码已过期」 | 授权码有效期 4 分钟，超时后重新调用 `feishu_auth` |
| 调用工具报权限不足 | 运行 `feishu-lark auth` 重新授权 |
| 切换飞书/Lark | 设置 `FEISHU_BRAND=lark` |
| CI/CD 中使用 | 通过 `FEISHU_USER_OPEN_ID` 预设用户身份 |

---

## 使用场景示例

| 场景 | 自然语言请求 |
|------|-------------|
| AI 辅助写文档 | "帮我写一篇关于微服务架构的技术文档，创建到我的飞书云空间" |
| 数据录入 | "把这几条 bug 记录到多维表格里" |
| 日程管理 | "明天下午有没有空闲时间段？我要约 30 分钟的会议" |
| 知识库检索 | "搜索知识库里关于 CI/CD 配置的文档" |

---

## 相关规范

- [[browser-auth-reuse]] - 浏览器登录态复用（另一种认证模式）

## 参考

- [Feishu/Lark CLI / MCP Server 使用手册](https://bytedance.sg.larkoffice.com/docx/HjOVd1XHko6xV8xFISalyEcSgbg)
- [LarkParser - OpenAPI & MCP](https://bytedance.larkoffice.com/wiki/Ne4Hws9vuieCWAkPYPrcG6lsn2b)
- Skills: https://ai-skills.bytedance.net/pengziqi/feishu-lark-gec-skills
