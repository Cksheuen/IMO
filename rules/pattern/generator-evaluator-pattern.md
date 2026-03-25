# Generator-Evaluator 模式规范

> 来源：[Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 触发条件

当任务满足以下任一条件时，**必须**使用 Generator-Evaluator 分离：

| 条件 | 示例 |
|------|------|
| 输出质量需要主观判断 | 前端设计、文案创作、架构设计 |
| 任务复杂度超过单次上下文 | 全栈应用、多模块系统 |
| 自我评估不可靠 | Agent 倾向"自信表扬"自己工作 |
| 需要"品味"的创造性工作 | 非模板化输出、需要原创性 |

## 执行规范

### 1. 角色分配

```
任务类型 → Agent 配置

简单任务（< 30 min）：
  └─ Solo Agent

中等任务（主观质量重要）：
  ├─ Generator Agent
  └─ Evaluator Agent（独立）

复杂任务（> 1 hr，多模块）：
  ├─ Planner Agent → 扩展规格
  ├─ Generator Agent → 按功能迭代
  └─ Evaluator Agent → 测试验收
```

### 2. Evaluator 独立性要求

**必须**：
- Evaluator 不能看到 Generator 的内部思考过程
- Evaluator 只看最终输出和规格要求
- Evaluator 使用独立工具验证（如 Playwright 测试页面）

**禁止**：
- Generator 自己评估自己的输出
- Evaluator 接受"差不多就行"的判断

### 3. 反馈循环

```
Generator 输出
    │
    ▼
Evaluator 评估 ──── 通过 ──→ 完成
    │
    └─── 未通过 ──→ 具体问题反馈
                        │
                        ▼
                   Generator 修复
                        │
                        ▼
                   (回到评估)
```

**迭代上限**：3-5 轮，避免无限循环

## 决策框架

### 是否需要 Evaluator？

```
                    ┌─────────────┐
                    │ 有客观测试？ │
                    └──────┬──────┘
                     是 ↓      ↓ 否
              ┌──────────┐  ┌─────────────┐
              │ 测试通过？│  │ 需要品味判断？│
              └─────┬────┘  └──────┬──────┘
               是 ↓   ↓ 否      是 ↓     ↓ 否
             完成   修复    需要 Evaluator  Solo
```

### Evaluator 调优检查清单

当 Evaluator 评估不符合预期时：

1. [ ] 评估标准是否足够具体？（"好设计" vs "使用非标准布局"）
2. [ ] 是否提供了 few-shot 示例？
3. [ ] Evaluator 是否使用了工具独立验证？
4. [ ] 反馈是否可操作？（"有问题" vs "具体哪里有问题"）

## 评估标准模板

```markdown
## [评估维度名称] (权重: 高/中/低)

### 定义
[什么是这个维度？具体指什么？]

### 高分表现
- [具体描述]

### 低分表现
- [具体描述，包含反例]

### 阈值
- 通过: [分数]
- 失败: [分数] → 必须修复
```

## Sprint Contract 模板

复杂任务**必须**在编码前使用：

```markdown
## Sprint [N]: [功能名称]

### 范围
- [具体要实现什么]
- [明确边界，不包括什么]

### 验收标准
1. [可测试的行为]
2. [可测试的行为]
3. [可测试的行为]

### 排除项
- [这次不做的]
```

**验收标准必须**：
- 可通过工具或观察验证
- 具体，不模糊
- 双方（Generator + Evaluator）达成一致

## 相关规范

- [[task-centric-workflow]] - 任务分解
- [[context-injection]] - 上下文注入
