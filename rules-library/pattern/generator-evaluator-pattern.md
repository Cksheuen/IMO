---
paths:
  - "src/**/*"
  - "lib/**/*"
  - "app/**/*"
---

# Generator-Evaluator 模式规范

> 来源：[Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 触发条件

当任务满足以下任一条件时，**必须**使用 Generator-Evaluator 分离：

| 条件 | 示例 |
|------|------|
| 输出质量需主观判断 | 前端设计、文案创作、架构设计 |
| 任务复杂度超单次上下文 | 全栈应用、多模块系统 |
| 自我评估不可靠 | Agent 倾向"自信表扬"自己工作 |
| 需要"品味"的创造性工作 | 非模板化输出、需原创性 |

## 执行规范

### 角色分配

| 任务复杂度 | Agent 配置 |
|------------|------------|
| 简单（< 30 min） | Solo Agent |
| 中等（主观质量重要） | Generator + Evaluator（独立） |
| 复杂（> 1 hr，多模块） | Planner + Generator + Evaluator |

### Evaluator 独立性

**必须**：
- Evaluator 不能看到 Generator 的内部思考过程
- Evaluator 只看最终输出和规格要求
- 使用独立工具验证

**禁止**：
- Generator 自己评估自己
- 接受"差不多就行"的判断

### 反馈循环

```
Generator 输出 → Evaluator 评估
                    ├─ 通过 → 完成
                    └─ 未通过 → 具体反馈 → Generator 修复 → 循环（上限 3-5 轮）
```

## 决策框架

```
有客观测试？
    ├─ 是 → 测试通过？→ 完成/修复
    └─ 否 → 需要品味判断？→ 是：需要 Evaluator / 否：Solo
```

### Evaluator 调优检查

- [ ] 评估标准是否具体？（"好设计" vs "使用非标准布局"）
- [ ] 是否提供了 few-shot 示例？
- [ ] 是否使用工具独立验证？
- [ ] 反馈是否可操作？

## 评估标准模板

```markdown
## [维度名称] (权重: 高/中/低)

### 定义
[一句话定义]

### 高分/低分表现
- 高：[具体描述]
- 低：[具体描述]

### 阈值
- 通过: X/10
- 失败: < Y/10 → 必须修复
```

## Sprint Contract 模板

```markdown
## Sprint [N]: [功能名称]

### 范围
- [要实现的]

### 验收标准
1. [可测试的行为]
2. [可测试的行为]

### 排除项
- [这次不做的]
```

**验收标准必须**：可验证、具体、双方一致

## 相关规范

- [[task-centric-workflow]] - 任务分解
- [[context-injection]] - 上下文注入
