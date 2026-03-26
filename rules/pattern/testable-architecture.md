# 可测试架构范式

> 来源：brainstorm 调研 | 吸收时间：2026-03-26

## 核心洞察

**分层 + Contract-First = 可测试性保证**

通过 Clean Architecture 分层确保业务逻辑独立可测，通过 Contract-First 确保类型定义与 Mock 数据自动同步。

## 触发条件

- 新建桌面/移动应用项目
- 需要跨技术栈共享类型定义（Flutter + Rust）
- 项目测试覆盖率要求 > 80%
- 需要长期维护的企业级应用

## 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│  Presentation Layer（表现层）                                    │
│  Flutter: Widget / Rust: View - 薄，只渲染 + 事件分发           │
├─────────────────────────────────────────────────────────────────┤
│  ViewModel Layer（状态管理层）                                   │
│  Flutter: BLoC / Rust: ViewModel - 持有 UI 状态                 │
├─────────────────────────────────────────────────────────────────┤
│  Domain Layer（领域层）                                          │
│  Flutter: UseCase / Rust: Service - 业务逻辑，无 UI 依赖        │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer（数据层）                                            │
│  Repository - 数据持久化 / 外部 API 调用                         │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
project/
├── contracts/           # 单一真相来源（Schema 定义）
├── generated/           # 自动生成（类型 + Mock）
├── lib/                 # 生产代码（domain/data/presentation）
├── test/                # 测试代码（镜像结构）
└── Makefile             # 生成命令
```

## 技术栈映射

| 层级 | Flutter | Rust (egui) | 测试方式 |
|------|---------|-------------|----------|
| **View** | Widget | `fn show(ui)` | Widget Test / egui_kittest |
| **ViewModel** | BLoC/Cubit | `struct ViewModel` | 单元测试 |
| **UseCase** | `class UseCase` | `trait Service` | 纯单元测试 |
| **Repository** | `abstract class` | `trait Repository` | Mock 测试 |

## Contract-First 类型同步

类型定义作为单一真相来源，生产代码、Mock 数据、测试代码均从中生成。

| 场景 | 推荐方案 | 工具 |
|------|----------|------|
| **跨语言（Rust + Flutter）** | Protocol Buffers | `protoc`, `prost`, `protobuf-dart` |
| **API 优先** | OpenAPI Schema | `openapi-generator-cli` |
| **纯 Rust** | ts-rs + fake | `ts-rs`, `fake-rs` |

## 测试策略

| 层级 | 测试类型 | 覆盖率目标 | 速度 |
|------|----------|------------|------|
| **Domain** | 单元测试 | 90%+ | 极快 |
| **Data** | 集成测试 + Mock | 80%+ | 快 |
| **ViewModel** | 单元测试 | 85%+ | 快 |
| **View** | UI 测试 | 关键路径 | 中 |

## 检查清单

- [ ] 类型定义集中在 `contracts/` 目录？
- [ ] Mock 数据从 Schema 自动生成？
- [ ] 领域层无 UI 框架依赖？
- [ ] UI 层足够薄（只渲染+事件分发）？
- [ ] CI 包含契约一致性验证？

## 相关规范

- [[rust-egui-testing]] - Rust egui 具体测试方案
- [[generator-evaluator-pattern]] - 复杂任务的评估模式

## 参考

- [MVVM as complementary pattern for Clean Architecture](https://www.spaceteams.de/en/insights/mvvm-as-a-complementary-pattern-for-clean-architecture-applications)
- [Contract-First API Development](https://devguide.dev/blog/contract-first-api-development)
