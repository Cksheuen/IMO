# 长时运行 Agent 技术规范

> 来源：[Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 触发条件

当 Agent 执行长时间任务时：
- 任务复杂度超过单次上下文容量
- 模型出现 Context Anxiety 症状
- 需要多 Agent 协作

## Context Anxiety 处理

### 识别信号

| 类型 | 表现 |
|------|------|
| 行为 | 突然说"差不多完成"但明显还有工作、跳过细节、质量下降 |
| 技术 | 上下文使用超过 70% |

### 处理流程

```
检测 Anxiety → 生成 handoff.md → Context Reset → 新 Session 读取 handoff
```

### Handoff 格式

```markdown
# Handoff - [任务名称]
## 进度
- [x] 已完成项
- [ ] 进行中
## 关键决策
## 下一步
```

### 模型差异

| 模型 | Anxiety 程度 | 建议 |
|------|-------------|------|
| Sonnet 4.5 | 强 | 必须 Reset |
| Opus 4.5 | 中 | 按需 Reset |
| Opus 4.6 | 弱 | 优先 Compaction |

## 评估标准设计

### 设计流程

```
识别维度 → 明确定义 → 设定权重 → 提供示例 → 设定阈值
```

### 标准格式（每个维度必须包含）

| 要素 | 说明 |
|------|------|
| name | 维度名称 |
| weight | high/medium/low |
| thresholds | pass/fail 分数 |
| definition | 一句话定义 |
| examples | 高分/低分表现 |
| anti_patterns | AI slop 模式 |

## Sprint Contract 规范

### 使用条件

| 必须 | 可跳过 |
|------|--------|
| 任务 > 1 小时 | 任务 < 30 min |
| 多人/Agent 协作 | 单一明确任务 |
| 高层需求需细化 | |

### Contract 内容

```yaml
sprint_contract:
  scope: [要做的]        # 必须
  excluded: [不做的]      # 必须
  acceptance_criteria:   # 必须，3-7 条
    - action: [行为]
      verification: [测试方法]
```

### 协议流程

```
Generator 提议 → Evaluator 审核 → 签署 → 编码
         ↑________________↓
           问题 → 反馈 → 修订
```

## 相关规范

- [[generator-evaluator-pattern]] - 多 Agent 架构
- [[task-centric-workflow]] - 任务分解
