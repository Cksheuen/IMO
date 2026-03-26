# Privacy-First Proxy Architecture Pattern

> 来源：[SearXNG](https://github.com/searxng/searxng) | 吸收时间：2026-03-26

## 触发条件

当设计需要保护用户隐私的系统时：
- 用户数据不应被第三方追踪
- 需要聚合多个外部服务
- 追求自托管可控性

## 核心原则

**中间层隔离 = 隐私保护**

通过代理层隔离用户与外部服务，实现：
- 用户身份隐藏
- 请求去标识化
- 数据本地化

## 架构模式

### 三层分离架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Reverse Proxy (Caddy/Nginx)                           │
│  - TLS 终止、安全头、速率限制                                     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Application Layer (Flask/uWSGI)                       │
│  - 请求处理、结果聚合、隐私清洗                                   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Caching Layer (Redis/Valkey)                          │
│  - 结果缓存、会话管理、性能优化                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 隐私保护机制

| 机制 | 实现方式 |
|------|----------|
| **身份隐藏** | 所有请求从代理服务器发出，隐藏用户 IP |
| **数据清洗** | 移除追踪脚本、分析代码、Cookies |
| **无日志** | 不存储查询历史、不创建用户画像 |
| **图像代理** | 代理图片加载，避免 referrer 泄露 |

## 决策框架

```
需要保护用户隐私？
    │
    ├─ 单一服务 → 简单代理层
    │
    ├─ 多服务聚合 → 元聚合架构（SearXNG 模式）
    │       │
    │       ├─ 高并发 → 加缓存层（Redis/Valkey）
    │       └─ 低并发 → 无缓存
    │
    └─ 完全隔离 → 自托管全部组件
```

## 技术选型

| 组件 | 推荐选择 | 原因 |
|------|----------|------|
| Reverse Proxy | Caddy | 自动 HTTPS、配置简单 |
| Application | Python Flask | 生态丰富、易扩展 |
| Cache | Valkey/Redis | 高性能、持久化 |
| 容器编排 | Docker Compose | 单机部署足够 |

## 自托管 vs 公共实例

| 维度 | 自托管 | 公共实例 |
|------|--------|----------|
| **隐私控制** | ✅ 完全控制 | ⚠️ 依赖运营者 |
| **可识别性** | ⚠️ 单用户易被识别 | ✅ 混在流量中 |
| **维护成本** | ⚠️ 需要技术能力 | ✅ 零成本 |
| **可靠性** | ⚠️ 可能被搜索引擎封禁 | ⚠️ 可能下线 |

**推荐策略**：
- 技术用户 → 自托管（最大控制）
- 普通用户 → 信誉良好的公共实例

## 性能优化策略

```yaml
caching:
  - 结果缓存: 减少外部请求
  - 会话缓存: 保持用户偏好

rate_limiting:
  - 防止被封禁
  - 保护后端服务

result_dedup:
  - 去重相似结果
  - 提升响应速度
```

## 检查清单

- [ ] 是否有 Reverse Proxy 处理 TLS？
- [ ] 是否配置了安全响应头？
- [ ] 是否移除了追踪代码？
- [ ] 是否设置了速率限制？
- [ ] 是否有缓存层提升性能？

## 应用场景

- **元搜索引擎** - SearXNG、Whoogle
- **AI 对话代理** - 隐藏用户身份的 AI 网关
- **API 聚合器** - 聚合多个第三方 API
- **内容过滤** - 广告拦截、内容清洗

## 相关规范

- [[browser-auth-reuse]] - 浏览器认证复用
- [[code-as-interface]] - 代码生成模式

## 参考

- [SearXNG GitHub](https://github.com/searxng/searxng)
- [SearXNG Docker Architecture](https://deepwiki.com/searxng/searxng/8.1-container-architecture-and-docker)
- [Self-hosting SearXNG](https://akashrajpurohit.com/blog/selfhost-searxng-for-privacy-focused-search/)
