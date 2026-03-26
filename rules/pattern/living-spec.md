# Living Spec Pattern

> 来源：[Augment Code - What spec-driven development gets wrong](https://x.com/augmentcode/status/2025993446633492725)
> 吸收时间：2026-03-26

## 核心洞察

**文档需要持续维护，而人类不擅长持续维护。**

Spec-Driven Development 的根本缺陷：spec 是静态文档，会过时。过时的 spec 会误导 agent 自信地执行错误计划。

**解决方案**：让 spec 成为人类与 agent 双向读写的"活文档"。

## 触发条件

当使用 spec/specification 流程时，评估是否需要 Living Spec：

| 场景 | 推荐模式 |
|------|----------|
| 需求明确、边界清晰 | 传统 spec（一次性规划） |
| 需求模糊、需要探索 | **Living Spec（双向同步）** |
| 快速迭代、实验性开发 | 可能不需要 spec |

## 执行规范

### 传统 Spec vs Living Spec

```
传统模式：
人类写 spec → agent 执行 → spec 过时 → agent 按"错误剧本"执行 → 隐蔽灾难

Living Spec：
人类写 spec → agent 执行 → 发现假设错误 → agent 更新 spec → spec 反映实际
```

### 关键机制：Agent 偏差报告

**粒度控制**（关键设计问题）：

| 粒度 | 问题 |
|------|------|
| 太多 | Spec 变成噪音，人类学会忽略 |
| 太少 | 回到猜测发生了什么 |

**正确做法**：Agent 只报告**改变方向的决策**

- ❌ "我写了第 1-50 行代码"
- ✅ "发现现有的 auth context，改用它而不是创建新的"

### 实践模板

**Spec 结构更新**：

```markdown
# [任务名称]

## 人类 Intent（原始需求）
[人类描述的需求]

## Agent 发现（执行中更新）
### 偏差报告
- [时间] 发现 [假设] 不成立，改用 [新方案]，理由：[原因]
- [时间] 发现现有 [组件/服务]，复用而非新建

## 当前状态
- 反映实际构建的内容，而非最初计划
```

### 类比：好的初级工程师

> 当发现 API 不支持分页时，他们会**主动更新 ticket**：
> "这个假设是错的，我改用了另一种方式，原因是..."
>
> 他们不会等你发现问题，也不会照着错误的方案做。

## 决策框架

```
使用 spec 流程？
    │
    ├─ 否 → 直接编码
    │
    └─ 是 → 需求明确？
            │
            ├─ 是 → 传统 spec
            │       └─ 一次性规划，agent 执行
            │
            └─ 否 → Living Spec
                    └─ 建立双向写入机制
                    └─ Agent 发现偏差时更新 spec
```

## 检查清单

### 设计 Living Spec 时

- [ ] 是否有"偏差报告"字段供 agent 写入？
- [ ] Agent 写入粒度是否合适（只报告改变方向的决策）？
- [ ] 人类 intent 与 agent 发现是否分离呈现？
- [ ] Spec 是否反映"实际构建"而非"最初计划"？

### Agent 执行时

- [ ] 发现假设错误时，是否更新 spec？
- [ ] 是否只报告关键决策，而非每一行代码？
- [ ] 更新后是否继续执行而非等待人类确认？

## 与 Trellis 等现有流程的整合

**短期改进**（现有流程）：

在 `status.md` 中增加 **"发现与偏差"** 字段：

```markdown
# status.md

## 进度
- [x] 已完成
- [ ] 进行中

## 发现与偏差（Agent 写入）
- 发现 API 不支持分页，改用 cursor-based pagination
- 发现现有 ThemeContext，复用而非新建
```

**中长期**：

1. Spec 格式支持 agent 写入
2. 区分"人类 intent"与"agent 发现的现实"
3. 建立自动化的偏差报告机制

## 根本原则

> **If agents can write code, they can update the plan. Let them.**

如果 agent 能写代码，它们就能更新计划。让它们做。

## 相关规范

- [[task-centric-workflow]] - 任务驱动组织（静态 spec 模式）
- [[long-running-agent-techniques]] - 长时 Agent 的 progress file 机制

## 参考

- [What spec-driven development gets wrong - Augment Code](https://x.com/augmentcode/status/2025993446633492725)
- [Augment Intent Product](https://www.augmentcode.com/product/intent)
