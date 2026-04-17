---
status: resolved
promotion_status: resolved
promotion_reason: "超集已存在于 notes/lessons/lesson-gate-false-positive-corrections.md 且标记 resolved；lesson-gate.sh 已退化为 no-op shim，该 bug 路径不再激活"
trigger: lesson-gate hook 误将 skill prompt injection 文本检测为用户纠正信号
last_verified: 2026-04-02
resolved_at: 2026-04-17
resolution: |
  1. signal-detector.sh 已增加 is_system_injection() 过滤（详见 corrections 版本）
  2. hooks/lesson-capture/lesson-gate.sh 已退化为 exit 0 shim，默认 Stop 链不再调用
  3. lesson capture 改由 /lesson-review skill 显式触发
---

# Lesson Gate 误报：Skill Prompt Injection 被当作纠正信号

> 注：本 lesson 的完整版与修复记录已沉淀于
> [`lesson-gate-false-positive-corrections.md`](./lesson-gate-false-positive-corrections.md)。
> 本文件保留为历史片段，不再作为 promotion 候选。

## Decision

当 lesson-gate 反复触发同一个 signal 且该 signal 文本来自 slash command 的 prompt injection（如 `/codex:review` 的 "Run a Codex review through the shared built-in reviewer"），应直接 mark as handled，不需要写真正的 lesson。

根因是 lesson-gate 的信号检测逻辑无法区分"用户纠正"和"skill 注入的指令文本"。

## Source Cases

- 2026-04-02: `/codex:review` 的 skill prompt 被检测为 "Explicit correction at turn 1"，同一会话内反复触发 3 次。signal 文本为 "Run a Codex review through the shared built-in reviewer. Raw slash-command argu..."，这是 codex:review skill 自动注入的指令，不是用户纠正。

## 潜在修复方向

- lesson-gate.sh 应排除 `<command-name>` / `<command-message>` tag 内的文本
- 或对 skill prompt injection 的 turn 做白名单处理
