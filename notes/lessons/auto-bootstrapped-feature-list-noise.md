---
title: 自动创建的 feature-list 与实际任务不匹配
status: promoted
promoted_to: rules/pattern/auto-created-feature-list-noise.md
promoted_at: 2026-04-03
last_verified: 2026-04-02
---

## Trigger

当 scale-gate / verification-gate 从非实现类命令（如 `/codex:rescue`、`/codex:adversarial-review`）自动创建 feature-list.json 时。

## Decision

1. 自动创建的 feature-list 如果描述与实际任务不匹配，应立即修正或标记 completed，而不是反复修改试图让它符合
2. verification-gate 阻止退出时，先检查 feature-list 是否由 scale-gate 自动创建——如果 feature 描述是 slash command 原文而非真实需求，直接 skip verification
3. 对于非实现类命令触发的 feature-list，优先用 Option C（skip）而不是尝试验证一个无意义的 feature

## Source Cases

- **2026-04-01 slugcat 终端图片协议**: `/codex:rescue` 触发 scale-gate 自动创建 feature-list，feature 描述为 "Route this request to the codex:codex-rescue subagent"——这是命令路由指令，不是功能需求。导致 feature-list.json 被反复修改 5 次（自动创建 → 验证阻塞 → 手动标记完成），实际任务（图片协议实现+审查修复）早已完成且通过全部测试。

- **2026-04-02 slugcat 终端测试脚本**: 用户要求创建全局 terminal-test-harness + 项目特化测试脚本。scale-gate 再次从用户消息自动创建 feature-list，feature 描述为用户的中文原文。任务实际已完成（65 个测试全部通过），但 verification-gate 阻塞退出。直接用 `jq` 标记 completed 跳过。同一 pattern 第二次出现。

## Root Cause

scale-gate 把所有进入的消息都当作"可能需要 feature-list 跟踪的任务"，但 `/codex:rescue` 等工具调用命令不是用户功能需求，它们的 prompt 文本不应该作为 feature description。

## Pattern Frequency

| 日期 | 触发场景 | 处理方式 |
|------|---------|---------|
| 2026-04-01 | `/codex:rescue` 自动创建 | 反复修改 5 次后跳过 |
| 2026-04-02 | 用户消息自动创建 | 直接 jq 标记 completed |

第二次出现时处理更快（直接跳过），说明 lesson 生效。但根因（scale-gate 无差别创建）未修复。

**状态：`candidate-rule`** — 同一 pattern 已复发两次，考虑晋升为 rule 或修复 scale-gate 逻辑。
