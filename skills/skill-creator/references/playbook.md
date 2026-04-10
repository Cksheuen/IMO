# Skill Creator Playbook

在需要完整 workflow、评估步骤、viewer 说明时读取本文件。

## 创建 Skill

### Capture Intent

至少确认：

1. 这个 skill 要让模型做到什么
2. 什么情况下触发
3. 输出格式是什么
4. 是否值得为它建立测试样例

## 写 SKILL.md

主文件至少应包含：

- `name`
- `description`
- 触发条件
- 核心流程
- 关键边界
- 参考文件入口

## 运行与评估

### Step 1

同一轮启动：

- with-skill
- baseline / old-skill

### Step 2

等待结果时写 assertions。

### Step 3

收集 timing 与 grading。

### Step 4

聚合结果并生成 viewer。

## Report 结构

```markdown
## Executive summary
## Key findings
## Recommendations
```

## 改进原则

- 先修结构问题
- 再修 trigger 问题
- 最后再修措辞
- 不要把单个失败样例直接上升成主规则

## Blind Comparison

当用户更关心“效果差异”而不是“哪个版本写法更漂亮”时，优先用 blind comparison。

## Description Optimization

1. 生成触发 queries
2. 和用户确认应命中 / 不应命中
3. 运行优化循环
4. 应用结果
