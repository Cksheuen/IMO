---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.
---

# Skill Creator

用于创建、评估、迭代、打磨 skill。

## 何时使用

- 从零创建新 skill
- 修改现有 skill
- 需要跑 eval / baseline / benchmark
- 需要优化 skill 的 trigger description
- 需要把“一个 workflow”收敛成稳定 skill

## 核心流程

1. 澄清目标与触发条件
2. 起草或读取现有 `SKILL.md`
3. 设计测试样例
4. 运行 with-skill 与 baseline
5. 汇总结果、生成 viewer、读取反馈
6. 根据反馈迭代 skill
7. 需要时再做 description optimization

## 关键约束

- 先判断用户处在“草稿 / eval / 迭代 / 触发优化”的哪个阶段
- 不要默认所有 skill 都需要重度 eval；主观型 skill 可轻量评估
- `SKILL.md` 主体尽量控制在 500 行以内
- 大模板、长参考、脚本说明放入 `references/` 或 `scripts/`
- 技能描述要明确“什么时候必须触发”

## 最小执行指南

### 创建 skill

- 明确：做什么、何时触发、输出什么
- 识别边界：什么不做
- 起草 `SKILL.md`
- 若 skill 支持多个变体或大参考面，建立 `references/`

### 跑 eval

- 同一轮里尽量同时启动 with-skill 与 baseline
- 在等待运行结果时补 assertions
- 记录 timing、grading、失败模式
- 用 viewer 帮用户看结果，而不是只给口头总结

### 做改进

- 优先修复高频误触发 / 漏触发
- 优先修复结构问题，再修辞
- 避免把“偶发样例”过拟合成主流程

### 做 description optimization

- 先生成触发测试 queries
- 和用户确认哪些查询应该 / 不应该命中
- 再跑描述优化循环

## 输出要求

至少给出：

- 当前阶段判断
- 本轮改动点
- eval / benchmark 结果摘要
- 下一轮建议
- 若改了 skill，指出关键 trigger 变化

## 参考文件

- `references/playbook.md`：详细 workflow、report 结构、blind comparison、优化循环
- `references/schemas.md`
- `scripts/run_eval.py`
- `scripts/run_loop.py`
- `scripts/generate_report.py`
- `scripts/improve_description.py`
