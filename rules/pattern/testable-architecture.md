# 可测试架构范式

> 来源：brainstorm 调研 | 吸收时间：2026-03-26

## 核心洞察

**分层 + Contract-First = 可测试性保证**

通过 Clean Architecture 分层确保业务逻辑独立可测，通过 Contract-First 确保类型定义与 Mock 数据自动同步。

## 触发条件

当开发满足以下任一条件时应用此范式：
- 新建桌面/移动应用项目
- 需要跨技术栈共享类型定义（Flutter + Rust）
- 项目测试覆盖率要求 > 80%
- 需要长期维护的企业级应用

## 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        表现层 (Presentation)                     │
│  Flutter: Widget        │  Rust egui: View/Component           │
│  ├─ 薄，只渲染          │  ├─ 薄，只渲染                        │
│  └─ 接收 State/Event    │  └─ 接收 &State, &mut Action         │
├─────────────────────────────────────────────────────────────────┤
│                        状态管理层 (ViewModel)                    │
│  Flutter: BLoC/Cubit    │  Rust: ViewModel struct              │
│  ├─ 持有 UI 状态        │  ├─ 持有 UI 状态                      │
│  └─ 调用 UseCase        │  └─ 调用 Service                      │
├─────────────────────────────────────────────────────────────────┤
│                        领域层 (Domain)                           │
│  Flutter: UseCase       │  Rust: Service trait                 │
│  ├─ 业务逻辑            │  ├─ 业务逻辑                          │
│  └─ 无框架依赖          │  └─ 无 UI 依赖                        │
├─────────────────────────────────────────────────────────────────┤
│                        数据层 (Data)                             │
│  Flutter: Repository    │  Rust: Repository trait              │
│  └─ 数据持久化 / 外部 API 调用                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构规范

```
project/
├── contracts/                    # 🔑 单一真相来源
│   ├── schemas/                  # 数据结构定义 (OpenAPI/Protobuf)
│   └── api.yaml                  # API 契约
│
├── generated/                    # 自动生成（禁止手动编辑）
│   ├── models/                   # 各语言的类型定义
│   └── mocks/                    # Mock 数据
│
├── lib/                          # 生产代码
│   ├── domain/                   # 领域层（最易测试）
│   ├── data/                     # 数据层
│   └── presentation/             # 表现层
│
├── test/                         # 测试代码（镜像结构）
│   ├── domain/                   # 纯单元测试
│   ├── data/                     # Mock 测试
│   └── contract/                 # 契约测试
│
├── Makefile                      # 生成命令
└── .github/workflows/            # CI 验证
```

## 技术栈映射

| 层级 | Flutter | Rust (egui) | 测试方式 |
|------|---------|-------------|----------|
| **View** | Widget | `fn show(&mut self, ui)` | Widget Test / egui_kittest |
| **ViewModel** | BLoC/Cubit | `struct ViewModel` | 单元测试（无 UI 依赖） |
| **UseCase** | `class UseCase` | `trait Service` | 纯单元测试 |
| **Repository** | `abstract class` | `trait Repository` | Mock 测试 |

## Contract-First 类型同步

### 核心原则

类型定义作为单一真相来源，生产代码、Mock 数据、测试代码均从中生成。

### 技术选型

| 场景 | 推荐方案 | 工具 |
|------|----------|------|
| **跨语言（Rust + Flutter）** | Protocol Buffers | `protoc`, `prost`, `protobuf-dart` |
| **API 优先** | OpenAPI Schema | `openapi-generator-cli`, `prism` |
| **纯 Rust** | ts-rs + fake | `ts-rs`, `fake-rs` |
| **纯 Flutter** | json_serializable + fake | `json_serializable`, `faker` |

### CI 验证

```yaml
# 契约一致性检查
- name: 检查 Schema 是否有变更
  run: |
    if git diff --name-only origin/main | grep -q "contracts/"; then
      make generate
      if ! git diff --exit-code; then
        echo "❌ 代码与 Schema 不同步！"
        exit 1
      fi
    fi
```

## 测试策略矩阵

| 层级 | 测试类型 | 覆盖率目标 | 速度 |
|------|----------|------------|------|
| **Domain** | 单元测试 | 90%+ | 极快 |
| **Data** | 集成测试 + Mock | 80%+ | 快 |
| **ViewModel** | 单元测试 | 85%+ | 快 |
| **View** | Widget/UI 测试 | 关键路径 | 中 |
| **E2E** | 集成测试 | 核心流程 | 慢 |

## TDD 开发循环

```
1. 修改 contracts/schemas/*.yaml    ← 唯一修改点
   │
   ▼
2. make generate                    ← 自动同步
   │
   ▼
3. 🔴 RED: 写失败测试
   │
   ▼
4. 🟢 GREEN: 最小实现
   │
   ▼
5. ♻️ REFACTOR: 重构优化
   │
   ▼
6. CI 验证契约一致性
```

## 检查清单

- [ ] 类型定义是否集中在 `contracts/` 目录？
- [ ] Mock 数据是否从 Schema 自动生成？
- [ ] 领域层是否无 UI 框架依赖？
- [ ] UI 层是否足够薄（只渲染+事件分发）？
- [ ] CI 是否包含契约一致性验证？

## 相关规范

- [[rust-egui-testing]] - Rust egui 具体测试方案
- [[generator-evaluator-pattern]] - 复杂任务的评估模式

## 参考

- [MVVM as complementary pattern for Clean Architecture](https://www.spaceteams.de/en/insights/mvvm-as-a-complementary-pattern-for-clean-architecture-applications)
- [Contract-First API Development](https://devguide.dev/blog/contract-first-api-development)
- [Flutter BLoC Best Practices](https://medium.com/@balaeon/mastering-flutter-bloc-best-practices-optimization-and-real-world-patterns-b1122d20fab5)
