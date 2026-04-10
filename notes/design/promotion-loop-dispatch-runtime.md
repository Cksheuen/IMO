# Promotion Loop Dispatch Runtime

- Status: historical-background
- Date: 2026-03-27
- Trigger: 当时需要把 `Promotion Loop -> promote-notes subagent` 从概念设计推进到可执行调度链

## 当前事实源

这份文档不再承担运行时规范职责；当前事实以代码和规则为准：

- [`hooks/promotion-dispatch.py`](../../hooks/promotion-dispatch.py)
- [`hooks/promotion-apply-result.py`](../../hooks/promotion-apply-result.py)
- [`rules/pattern/promotion-loop-background-execution.md`](../../rules/pattern/promotion-loop-background-execution.md)
- [`skills/promote-notes/SKILL.md`](../../skills/promote-notes/SKILL.md)

## 这份设计稿保留的背景

它记录的是调度链为何被拆成 queue 协议，而不是继续停留在“提醒主 agent 手工处理”的阶段。

后来被保留下来的关键设计点有三条：

- 候选发现、queue claim、subagent 派发、结果回写要分层
- 主链路和 `promote-notes` 执行链之间需要单一事实源
- `claim / apply / fail` 必须分开，避免 subagent 中途失败时丢候选

## 仍然有价值的实现判断

- 运行作用域必须说清楚，不能把“当前仓库开发态已接通”误写成“全局配置已接通”
- queue 的单一事实源应保持明确，避免多份 `promotion-queue.json` 并存
- Promotion Loop 真正执行时应由独立执行链消费 queue，而不是要求主 agent 在结束前手工完成整条链

## 为什么还保留这份文档

它解释了今天这套 dispatch/runtime 结构为什么长成现在这样。

如果要改实现，请直接读脚本和规则；如果要追溯 queue、claim、apply、fail 这组接口为何出现，这份背景文档仍然有价值。
