---
paths:
  - "src/**/*"
  - "lib/**/*"
  - "app/**/*"
  - "server/**/*"
  - "api/**/*"
---

# 架构自演化规范

> 来源：渐进式架构演化（"龙虾蜕壳"）调研与设计收敛 | 吸收时间：2026-04-14

## 核心问题

项目架构有两种失败模式：

- **过早完整架构**：预判错误导致 over-engineering，agent 忠实遵循错误结构产出冗余代码
- **永不升级**：以"小项目"为由持续膨胀，直到必须重写

AI agent 在架构演化中的特殊弱点：

- 擅长沿用现有模式扩展，不擅长判断"何时该蜕壳"
- 小范围重构（< 5 文件）成本极低，大范围重构（> 15 文件）成本陡增
- 默认不质疑现有架构，需要显式信号

## 核心原则

**最小可行架构 + 显式升级触发器 + 频繁小重构。**

| 原则 | 含义 |
|------|------|
| **Start Minimal** | 初始只建立目录约定、对外调用入口、命名风格、测试入口 |
| **Explicit Triggers** | 用量化条件告诉 agent 什么时候该升级，而不是靠直觉 |
| **Small Molts** | 每次蜕壳控制在 < 5 文件的小手术，而不是积攒到大重写 |
| **Domain-Specific** | 不同领域有不同的阶段定义和触发阈值 |

## 触发条件

当满足以下任一情况时，必须应用本规范：

- 新建项目或进入新项目的初始架构决策
- 实现过程中发现代码膨胀、职责混乱
- 需要决定是否做架构升级
- 项目进入新的复杂度阶段

## 三阶段生命周期协议

所有项目都经历三个阶段，每个领域填入自己的具体定义：

### Stage 1: Bootstrap

```yaml
目标: 快速闭环，避免过早架构化
特征:
  - 单入口 / 单功能起步
  - 文件数量少，交互链路短
允许的简化:
  - 主文件可兼任轻量容器
  - 可保留一次性状态整形
必须保留的边界:
  - 对外调用必须经统一入口（service / adapter / API client）
  - 不允许业务逻辑与 I/O 完全混合
```

### Stage 2: Growth

```yaml
目标: 从"能跑"过渡到"可维护"
特征:
  - 开始出现第二个相似模块
  - 状态管理变复杂
  - 同一逻辑开始被多处共享
必须新增:
  - 编排层（hook / store / controller / service）
  - 主文件不再直接管理完整异步流程
  - 可复用逻辑抽到独立模块
允许保留:
  - 本地 UI 态 / 局部配置
  - 与单一入口强绑定的轻量格式化
```

### Stage 3: Structured

```yaml
目标: 完整分层，降低回归成本
特征:
  - 多入口 / 多流程 / 多状态源
  - 跨模块联动和回归风险明显
必须满足:
  - 主文件只消费 contract，不拼装关键状态
  - 所有可复用逻辑进入独立层
  - 核心行为可脱离 UI / runtime 直接测试
  - 对外 contract 面向消费方，而不是面向内部实现
```

## 通用升级触发器

出现以下任一情况时，必须评估是否需要从当前阶段升级：

### 量化触发器（通用）

| 触发器 | 阈值 | 目标阶段 |
|--------|------|----------|
| 单文件行数 | > 200 行且仍在增长 | 至少 Stage 2 |
| 单文件函数/方法数 | > 15 个 | 至少 Stage 2 |
| 同类逻辑重复出现 | 在第 2 个位置出现 | 至少 Stage 2 |
| 单文件管理的异步流程数 | > 2 个 | 至少 Stage 2 |
| 单文件持有的状态源类型 | > 2 类（远端/运行时/配置） | 至少 Stage 2 |
| 跨模块联动的文件数 | > 3 个 | Stage 3 |
| 测试某行为需启动完整 runtime | 任何时候 | Stage 3 |

### 模式触发器（通用）

- 某个流程已需要单独测试、复用或被频繁修改
- 文件开始理解 retry / reconnect / rollback / optimistic update 之类状态机
- 新增功能需要跨 3+ 个现有模块协调
- 同一 bug 修复需要改 3+ 个不相关文件

### 领域特定触发器

不同领域有额外的触发条件，定义在各自的 `architecture-stages.md` 中：

| 领域 | 阶段定义文件 |
|------|-------------|
| 前端 | `rules/domain/frontend/ui-logic-boundary.md`（已有） |
| 后端 | `rules/domain/backend/architecture-stages.md` |
| 通用/全栈 | `rules/domain/shared/architecture-stages.md` |

## 升级执行协议

### Step 1: 确认触发

当检测到触发器命中时，先形成判断：

```markdown
## 架构升级评估

- 当前阶段：Stage X
- 触发的指标：[具体哪些触发器命中]
- 建议目标阶段：Stage Y
- 涉及文件范围：[预估 < 5 文件]
```

### Step 2: 守门条件

升级必须同时满足以下条件（与 `project-architecture-first.md` 对齐）：

- 触发器确实命中（不是主观感觉"该重构了"）
- 升级范围可控（单次 < 5 文件）
- 不引入项目中不存在的新分层（优先复用已有层级）
- 不与当前任务无关（change-scope-guard）

### Step 3: 执行小手术

- 每次只做一个升级动作（抽 hook / 拆 service / 建 contract）
- 升级完成后立即验证：原有行为不变 + 新结构可用
- 更新 status / spec 中的架构阶段标注

### Step 4: 记录演化

在项目的 `status.md` 或等效位置记录：

```markdown
## 架构演化记录

- [日期] Stage 1 → Stage 2：抽出 XxxService，触发器：单文件超 200 行
```

## 降级保护

以下情况禁止升级：

| 禁止条件 | 原因 |
|----------|------|
| 触发器未命中，但"感觉该重构了" | 主观判断不可靠 |
| 升级范围 > 5 文件 | 超出 agent 安全操作范围，需拆批次 |
| 引入项目中不存在的全新分层 | 违反 project-architecture-first |
| 当前任务不涉及相关模块 | 违反 change-scope-guard |
| 用户未授权架构变更 | 需显式确认 |

当触发器命中但升级范围过大时：

- 记录为 `Incidental finding`
- 建议拆分为独立任务
- 不在当前任务中执行

## 自动化检测

`hooks/architecture-fitness.py` 提供可执行的适应度检测：

```bash
# 手动运行
python3 ~/.claude/hooks/architecture-fitness.py --path /project/dir --domain frontend

# 输出格式
{
  "project": "/project/dir",
  "domain": "frontend",
  "current_stage": "bootstrap",
  "metrics": {
    "total_source_files": 42,
    "max_file_lines": 245,
    "max_functions_per_file": 18,
    "duplicate_pattern_count": 2,
    "multi_async_files": ["src/pages/Dashboard.tsx"],
    "directory_imbalance_count": 0
  },
  "triggered_upgrades": [
    {
      "trigger": "single_file_lines",
      "file": "src/pages/Dashboard.tsx",
      "value": 245,
      "threshold": 200,
      "target_stage": "growth"
    }
  ],
  "recommendations": [
    "src/pages/Dashboard.tsx 超过 200 行，建议抽离可复用逻辑到 hook/service"
  ]
}
```

## 决策框架

```text
实现过程中发现代码膨胀？
    │
    ├─ 检查升级触发器是否命中
    │       │
    │       ├─ 未命中 → 继续当前方式，不升级
    │       │
    │       └─ 命中 → 升级范围可控（< 5 文件）？
    │               │
    │               ├─ 是 → 执行小手术 + 记录演化
    │               │
    │               └─ 否 → 记录为 Incidental finding
    │                       → 建议拆分为独立任务
    │
    └─ 没发现膨胀 → 继续当前阶段
```

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/core/project-architecture-first.md` | 守门条件来源；升级必须沿用现有层级 |
| `rules/domain/frontend/ui-logic-boundary.md` | 前端领域的已验证实现；本规范从中抽象 |
| `rules/pattern/change-scope-guard.md` | 限制升级不超出当前任务边界 |
| `rules/pattern/change-impact-review.md` | 升级后必须做回归验证 |
| `skills/shit` | 治理资产的结构精简（阈值：skills>20, rules>500行） |
| `skills/freeze` | 冷热存储管理，与阶段演化互补 |

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 项目初始就建完整 DI / 事件系统 / 微服务边界 | Start Minimal，只建目录约定和调用入口 |
| 触发器未命中就"顺手重构" | 无触发则不升级 |
| 一次升级改 15+ 文件 | 拆成多次 < 5 文件的小手术 |
| 用"以后会用到"为理由提前建抽象 | 等触发器命中再建 |
| agent 凭直觉判断"该蜕壳了" | 只依赖量化触发器 |
| 积攒到必须重写才升级 | 频繁小重构，每次触发即处理 |

## 检查清单

- [ ] 项目是否有明确的当前阶段标注？
- [ ] 升级触发器是否量化且可检测？
- [ ] 升级范围是否控制在 < 5 文件？
- [ ] 是否沿用现有层级而非引入新分层？
- [ ] 升级后是否做了回归验证？
- [ ] 是否记录了架构演化历史？
