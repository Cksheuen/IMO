# 架构自演化系统设计文档

> 类型：设计决策记录 | 记录时间：2026-04-14
> 对应核心规范：`rules/core/architecture-evolution.md`

## 问题陈述

### 两种失败模式

项目架构在实践中呈现两种对称的失败：

| 失败模式 | 表现 | 根因 |
|----------|------|------|
| **过早完整架构** | 初始建了 DI 容器、微服务边界、事件总线，但大量接口永远不需要 | 预判需求而非响应事实 |
| **永不升级** | 以"小项目"为由把所有逻辑堆在主文件，直到必须重写 | 升级成本模糊，缺乏明确信号 |

### AI Agent 的特殊弱点

传统架构演化由人来判断时机，而 AI agent 有三个特有弱点：

1. **擅长沿模式扩展，不擅长判断蜕壳时机**：给定现有模式，agent 会忠实复制；没有外部信号，agent 不会主动质疑结构。
2. **小重构成本陡降**：`< 5` 文件的小手术对 agent 来说成本极低，可以高频执行；`> 15` 文件的大重构成本陡增，应当尽量避免。
3. **需要显式量化信号**：人类凭经验说"这块该拆了"，agent 需要具体的、可检测的触发条件。

---

## 设计目标

三个核心目标，相互约束：

```yaml
goals:
  minimal_viable_architecture:
    含义: 初始只建目录约定、对外调用入口、命名风格、测试入口
    避免: 预先建立永远不会用到的抽象层

  explicit_triggers:
    含义: 用量化条件（行数、函数数、重复次数）告诉 agent 何时升级
    避免: 主观感觉驱动的"顺手重构"

  frequent_small_molts:
    含义: 每次触发器命中后立即做 < 5 文件的小手术
    避免: 积压到必须做大重写
```

---

## 核心设计决策

### a. 为什么选三阶段而不是更多或更少

**两阶段不够**：Bootstrap → Structured 的跨度太大，升级代价一次性过高，agent 会回避。

**四阶段以上过细**：触发器和定义数量增加，agent 记忆和判断负担增加，反而降低应用率。

**三阶段的语义正好**：Bootstrap（快速闭环）→ Growth（第一次痛点出现时的小重构）→ Structured（多模块稳定化）覆盖了项目生命周期的三个真实转折点。

### b. 为什么触发器必须量化

量化触发器的核心价值不是精确，而是**可检测**和**可自动化**：

- agent 可以在每次任务完成后自动检测，无需依赖人的判断
- 量化条件排除了"我觉得该重构了"这种不可靠的主观信号
- 阈值可以随项目类型调整，但始终保持可测量性

`scripts/architecture-fitness.py` 的存在正是这一决策的产物：把触发器变成可以机械执行的代码。

### c. 为什么限制单次升级 < 5 文件

这个限制来自 agent 操作特性的实证观察：

| 改动范围 | agent 成功率 | 回归风险 |
|----------|-------------|----------|
| < 5 文件 | 高 | 低，可即时验证 |
| 5–15 文件 | 中 | 中，需要额外测试 |
| > 15 文件 | 低 | 高，上下文溢出风险 |

超过 5 文件时，强制要求拆成多次独立的小手术，而不是一次性完成。

### d. 为什么领域特定阶段优先于通用阶段

通用三阶段提供骨架，领域特定阶段提供内容。原因：

- 前端的"Stage 2 触发"（页面超 200 行）和后端的"Stage 2 触发"（service 层出现）含义完全不同
- 通用触发器（单文件行数、函数数）覆盖了所有领域的共性信号
- 领域触发器覆盖了语义层面的特有信号，避免通用规则误判

决策结果：`ui-logic-boundary.md` 中前端三阶段已经是领域特定阶段的完整实现，作为参考模板供后端阶段文件复用结构。

---

## 系统组成

各交付物及其关系：

```yaml
核心协议:
  文件: rules/core/architecture-evolution.md
  职责: 三阶段定义、通用触发器、升级执行协议、降级保护
  关系: 被所有领域阶段文件引用；被 fitness hook 实现

领域阶段定义:
  前端:
    文件: rules/domain/frontend/ui-logic-boundary.md
    状态: 已有，三阶段已完整实现
  后端:
    文件: rules/domain/backend/architecture-stages.md
    状态: 待创建
  通用/全栈:
    文件: rules/domain/shared/architecture-stages.md
    状态: 待创建

自动化检测:
  文件: scripts/architecture-fitness.py
  职责: 扫描项目目录，检测量化触发器是否命中，输出结构化建议
  触发方式: 手动运行或 PostToolUse hook 调用

仪表盘技能:
  文件: skills/architecture-health/SKILL.md
  状态: 待创建
  职责: 展示当前项目的阶段状态和触发器命中情况
```

组件关系图：

```
核心协议 ──引用──► 领域阶段定义（3 个）
    │
    └──实现──► fitness hook（自动化检测）
                    │
                    └──呈现──► architecture-health skill（仪表盘）
```

---

## 与现有体系的关系

| 规则/技能 | 与本系统的关系 |
|-----------|---------------|
| `project-architecture-first.md` | 提供守门条件：升级必须先读现有架构，不得引入项目中不存在的新分层 |
| `change-scope-guard.md` | 限制升级范围：触发器命中但不在当前任务边界内时，记录为 Incidental finding，不顺手改 |
| `shit` skill | 提供治理资产的阈值参考：skills > 20 个、rules 总行数 > 500 行；本系统的量化触发器设计参考了这一模式 |
| `freeze` skill | 冷热存储管理；当某个阶段的规则长期不用时，可由 freeze 管理；两者互补而非重叠 |
| `promote-notes` | 本文档本身和调研结论将通过 promote-notes 流程晋升到 rules/；知识晋升通道 |

---

## 外部调研结论

### Neal Ford《Building Evolutionary Architectures》

核心贡献：**适应度函数（Fitness Functions）**概念——用可执行的自动化检测来守护架构特性，而不是靠人工 review。

本系统的 `scripts/architecture-fitness.py` 直接对应这一理念：把架构约束变成可执行代码。

### Factory.ai 的 lint-as-guardrail 模式

将架构规范编码为 lint 规则，集成到 CI 中自动执行。本系统采用 hook 而非 lint 的原因：lint 规则需要预定义好架构边界，而 hook 可以在运行时根据项目当前阶段动态判断。

### 全行业空白

调研覆盖了 SonarQube、ArchUnit、fitness function 生态。共同空白：**自动检测"何时该演化"尚无产品化方案**。现有工具只做"当前是否违反已定义规则"，不做"当前是否到了该升级阶段"的判断。本系统填补这一空白。

---

## 演化路径

本系统自身的未来改进方向（按优先级排序）：

1. **补全后端和通用阶段定义**：`architecture-stages.md` 的两个文件，提供领域特定触发器
2. **补全 architecture-health skill**：让 agent 可以通过 `/architecture-health` 快速查看当前项目状态
3. **与 project-architecture-inject hook 联动**：在架构预读注入时，同时注入当前阶段状态，减少 agent 重新检测的成本
4. **自动化演化记录**：fitness hook 在检测到触发器命中时，自动写入 `status.md` 的"架构演化记录"字段

---

## 关键缺口

当前已设计但尚未实现，值得后续补齐：

| 缺口 | 描述 | 优先级 |
|------|------|--------|
| 后端阶段定义 | `rules/domain/backend/architecture-stages.md` 尚未创建 | 高 |
| 通用阶段定义 | `rules/domain/shared/architecture-stages.md` 尚未创建 | 高 |
| architecture-health skill | 仪表盘技能尚未创建 | 中 |
| 阶段标注约定 | 项目 `status.md` 中如何记录当前阶段，尚无统一格式 | 中 |
| CI 集成路径 | fitness hook 目前只支持手动运行，尚未集成到 PostToolUse | 低 |
