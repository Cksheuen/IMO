---
name: backend-architecture-stages
description: 后端项目三阶段架构演化定义，包含阶段特征、升级触发器与分层边界
triggers:
  - 修改或新建 handler、controller、router、service、repository
  - 在 handler 中直接写数据库查询或业务逻辑
  - 多个 handler 开始出现相同的数据处理模式
  - 需要判断某段逻辑是否应该抽到 service 层或 repository 层
---

# 后端架构阶段定义

> 来源：基于 `rules/core/architecture-evolution.md` 三阶段协议，结合后端领域特有的分层边界与膨胀模式 | 吸收时间：2026-04-14

## 核心问题

后端项目的架构膨胀路径与前端不同，主要表现为：

- Handler / Controller 文件持续增长，同时承担路由解析、参数校验、业务逻辑、数据库操作
- 业务逻辑散落在 handler 内，无法复用、无法单独测试
- 直接在 handler 中写 SQL 查询，数据访问与业务逻辑混合
- 中间件与业务逻辑边界模糊，横切关注点（日志、鉴权、限流）和领域逻辑混在一起
- 多个 handler 重复实现相同的查询与转换逻辑

结果是 Agent 容易做到"加了 service 文件就算分层了"，但 handler 仍持续承担不该承担的职责。

## 核心原则

**Handler 负责边界（解析、校验、响应格式化），Service 负责编排（业务逻辑、事务），Repository/Adapter 负责数据访问（持久化、外部调用）。**

补充约束：

- Handler 是 HTTP / RPC 协议边界，不是业务逻辑落点
- Service 是唯一可以跨数据源、跨模块编排的层
- Repository / Adapter 是唯一的数据库 / 外部系统访问入口
- 核心业务逻辑应可脱离 HTTP 框架和数据库直接测试

## 触发条件

当满足以下任一条件时，必须应用本规范：

- 修改 `handlers/`、`controllers/`、`routes/`、`api/` 下的文件
- 修改 `services/`、`repositories/`、`models/`、`adapters/` 下的文件
- 在 handler 中新增数据库查询、外部 API 调用、复杂业务判断
- 需要判断某段逻辑是否应抽到 service 层或 repository 层

## 通用分层映射

| 层 | 典型位置 | 职责 | 不应承担 |
|----|----------|------|----------|
| **Handler / Controller** | `handlers/`、`controllers/`、`routes/` | 路由绑定、参数解析与校验、调用 service、格式化响应、错误映射 | 业务逻辑、数据库查询、跨模块编排、事务管理 |
| **Service** | `services/`、`usecases/` | 业务逻辑、跨 repository 编排、事务边界、领域规则校验 | HTTP 细节（状态码、header）、直接 DB 查询、响应格式化 |
| **Repository / Adapter** | `repositories/`、`adapters/`、`store/` | 唯一的数据库访问入口、外部 API 调用封装、查询构建 | 业务规则判断、HTTP 响应构建、跨模块编排 |
| **Domain / Model** | `models/`、`entities/`、`domain/` | 核心数据结构定义、领域不变量、值对象 | I/O 操作、HTTP 细节、框架依赖 |
| **Middleware** | `middleware/`、`interceptors/` | 横切关注点（鉴权、日志、限流、CORS） | 业务逻辑、数据库操作 |

## 三阶段生命周期

所有后端项目都从小规模起步，但不能永远按起步阶段的规则写。

| 阶段 | 适用状态 | 目标 | 允许的简化 | 必须保留的边界 |
|------|----------|------|------------|----------------|
| **Stage 1: Bootstrap** | 单资源 / 单功能起步期 | 快速闭环、避免过早架构化 | Handler 可兼任轻量业务逻辑 | 不允许 handler 直接写裸 SQL；必须经 repository / DB client 入口 |
| **Stage 2: Growth** | 进入中期，多资源 / 多接口 | 从"能跑"过渡到"可维护" | 可保留少量 handler 级轻量判断 | 可复用业务逻辑必须抽到 service；数据访问统一经 repository |
| **Stage 3: Structured** | 多模块 / 多资源 / 跨团队维护 | 完整分层、降低回归成本 | 不再依赖 handler 承担业务流程 | Handler 只做协议转换；Service 返回明确 contract；核心逻辑可脱离框架测试 |

---

### Stage 1: Bootstrap

```yaml
目标: 快速闭环，避免过早架构化
适用状态:
  - 单资源 CRUD 起步
  - 接口数量少（< 10 个路由）
  - 单人开发，无并行模块

特征:
  - route + handler 在一起
  - handler 兼任轻量业务判断
  - 单文件或少量文件组织

允许的简化:
  - handler 内可有简单业务逻辑（if/else 分支、简单校验）
  - 允许 handler 直接调用 DB client / ORM 方法
  - 允许一个文件包含多个相关 handler

必须保留的边界:
  - 禁止 handler 内写裸 SQL（必须经 ORM / query builder / repository function）
  - 禁止 handler 内直接调用外部 HTTP 服务（必须经 adapter / client 函数）
  - 禁止业务错误码与 HTTP 状态码完全混用（至少有一层 error mapping）
```

### Stage 2: Growth

```yaml
目标: 从"能跑"过渡到"可维护"
适用状态:
  - 出现第二个相似的资源 / handler
  - 同类查询或业务判断开始重复出现
  - 接口数量增长（10-30 个路由）
  - 开始需要事务或跨表操作

必须新增:
  - service 层承担业务逻辑和跨模块编排
  - handler 只做参数校验 + 调用 service + 格式化响应
  - repository 层统一数据访问（即使是简单封装）

允许保留:
  - handler 内可有轻量参数校验（字段存在性、类型检查）
  - handler 内可有直接的错误映射（service 错误 -> HTTP 状态码）
  - 简单的 CRUD 可暂时 handler -> repository，不强制经 service

禁止:
  - 新增业务逻辑直接写入 handler
  - 相同查询逻辑在多个 handler 中重复
  - 事务逻辑分散在多个 handler
```

### Stage 3: Structured

```yaml
目标: 完整分层，降低回归成本，支持多人协作
适用状态:
  - 多个资源模块并行开发
  - 跨模块联动变多（A 资源操作触发 B 资源变更）
  - 需要端到端测试以外的单元测试覆盖
  - 接口数量多（> 30 个路由）或被外部消费者依赖

必须满足:
  - Handler 只负责协议边界（解析 -> 调用 service -> 格式化）
  - Service 返回明确的领域类型，而非 raw DB 结果
  - Repository 封装所有查询细节，service 不直接拼 SQL / ORM 查询
  - 核心业务逻辑可在不启动 HTTP server 的情况下直接测试
  - 中间件只处理横切关注点，不包含业务判断

对外 contract 要求:
  - Service 返回值面向调用方消费，而非暴露 DB 内部结构
  - 错误类型明确（领域错误 vs 基础设施错误 vs 协议错误）
  - 接口 schema 与实现保持同步（建议 contract-first 或至少类型安全）
```

## 后端特有升级触发器

在通用触发器（来自 `rules/core/architecture-evolution.md`）之外，以下后端特有触发器命中时必须评估升级：

### 量化触发器

| 触发器 | 阈值 | 目标阶段 | 说明 |
|--------|------|----------|------|
| Handler / Controller 文件行数 | > 200 行且仍在增长 | 至少 Stage 2 | 行数膨胀通常说明 handler 在兼任 service |
| 单个 handler 函数行数 | > 80 行 | 至少 Stage 2 | 超长 handler 函数无法独立测试 |
| 相同查询逻辑出现次数 | 在第 2 个 handler 出现 | 至少 Stage 2 | 立即抽到 repository |
| 相同业务逻辑出现次数 | 在第 2 个 handler 出现 | 至少 Stage 2 | 立即抽到 service |
| Handler 中直接的 DB 查询数 | > 3 次 | Stage 2 | 数据访问应统一经 repository |
| Handler 同时访问的数据源数 | ≥ 2 个（DB + 缓存 / DB + 外部 API） | Stage 2 | 跨数据源编排应在 service 层 |
| 模块间跨依赖的路由数 | > 5 个 | Stage 3 | 跨模块联动需要完整分层 |

### 模式触发器

以下模式出现时，无论行数是否达到阈值，都必须升级：

**必须触发 Stage 2 升级：**
- Handler 中出现了 try/catch 包裹的事务逻辑
- 多个 handler 需要相同的鉴权 + 业务前置校验组合
- Handler 直接调用另一个 handler 的内部函数
- Handler 中出现了 for 循环处理多条数据库记录
- Handler 中的业务逻辑需要被测试用例覆盖

**必须触发 Stage 3 升级：**
- 核心业务行为只能通过启动 HTTP server 才能测试
- Service 层开始直接拼 SQL 或 ORM 查询链（绕过 repository）
- 跨资源的操作（A 资源创建触发 B 资源更新）散落在多个 handler
- 接口响应直接返回了 DB 实体结构（暴露内部存储细节）

## 升级执行路径

每次升级控制在 **< 5 文件**，按以下顺序执行：

```text
检测触发器命中
    │
    ├─ Stage 1 -> Stage 2
    │       │
    │       ├─ Step 1: 建立 service 文件（1 文件）
    │       ├─ Step 2: 将 handler 中的业务逻辑迁移到 service（1-2 文件）
    │       ├─ Step 3: 建立 repository 文件（1 文件）
    │       └─ Step 4: 将 handler 中的 DB 调用迁移到 repository（1-2 文件）
    │
    └─ Stage 2 -> Stage 3
            │
            ├─ Step 1: 明确 service 的返回类型 contract（1 文件）
            ├─ Step 2: 将 service 中残余的 DB 查询迁移到 repository（1-2 文件）
            ├─ Step 3: 补充核心业务逻辑的单元测试（1 文件）
            └─ Step 4: 更新 handler 以消费 service contract（1 文件）
```

## 决策框架

```text
发现后端代码膨胀或逻辑混合？
    │
    ├─ 是否有 DB 查询在 handler 函数体内（非经 repository）？
    │       ├─ 是，且超过 3 处 → 抽 repository，升级到 Stage 2
    │       └─ 否 → 继续检查
    │
    ├─ 是否有业务逻辑在多个 handler 中重复出现？
    │       ├─ 是，第 2 处刚出现 → 立即抽 service，升级到 Stage 2
    │       └─ 否 → 继续检查
    │
    ├─ Handler 文件是否超过 200 行且仍在增长？
    │       ├─ 是 → 识别可抽离逻辑，升级到 Stage 2
    │       └─ 否 → 继续检查
    │
    ├─ 核心业务测试是否必须启动 HTTP server？
    │       ├─ 是 → 分离业务逻辑到 service，升级到 Stage 3
    │       └─ 否 → 继续检查
    │
    ├─ Service 是否直接暴露 DB 实体结构给 handler？
    │       ├─ 是 → 定义 contract 类型，升级到 Stage 3
    │       └─ 否 → 继续检查
    │
    └─ 无命中 → 继续当前阶段，不升级
```

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| Handler 中直接写 SQL 字符串 | 数据访问散落无法复用 | 所有 DB 操作经 repository / ORM wrapper |
| Handler 函数超 80 行，包含多个 if/else 业务分支 | 逻辑无法独立测试 | 将业务判断抽到 service 函数 |
| 多个 handler 重复相同的 `db.query(...)` 调用 | 查询逻辑漂移 | 查询逻辑收口到 repository，handler 调用 repository 方法 |
| Service 返回 `SELECT *` 的原始 DB 行对象 | 暴露存储细节给调用层 | Service 返回面向消费方的明确类型 |
| 中间件内做业务判断（"此用户的资源配额是否足够"）| 横切关注点与业务混合 | 配额校验放 service，中间件只做鉴权 |
| 两个资源的操作逻辑写在同一个 handler 文件 | 模块边界不清晰 | 按资源拆分 handler 文件，跨资源编排收口到 service |
| Service 层直接 import ORM model 并拼查询链 | Service 层与 ORM 耦合 | Repository 封装查询细节，service 调用 repository 方法 |
| 以"这是小项目"为理由保留 handler 中的业务逻辑 | 触发器命中后应升级 | 触发器命中后立即做小手术，不依赖"以后再说" |

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/core/architecture-evolution.md` | 核心协议来源；三阶段框架、通用触发器、升级执行协议均来自此处，本规范只填充后端领域特有内容 |
| `rules/core/project-architecture-first.md` | 升级时必须沿用项目已有层级，不引入项目中不存在的新分层 |
| `rules/pattern/change-scope-guard.md` | 架构升级若非当前任务必需，不得顺手扩范围 |
| `rules/pattern/change-impact-review.md` | 升级后必须验证已有接口行为不变 |
| `rules/domain/shared/testable-architecture.md` | Stage 3 的"核心逻辑可脱离框架测试"要求与此规范对齐 |

## 检查清单

- [ ] 当前后端项目是否有明确的阶段标注？
- [ ] Handler 中是否出现了直接的数据库访问（绕过 repository）？
- [ ] 是否有重复的查询或业务逻辑分散在多个 handler？
- [ ] Service 是否返回明确类型，而非 raw DB 结果？
- [ ] 核心业务逻辑是否可以在不启动 HTTP server 的情况下测试？
- [ ] 横切关注点是否全部在中间件处理，而不是散落在 handler/service？
- [ ] 架构升级是否控制在 < 5 文件的小手术范围内？
