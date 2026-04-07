---
status: active
trigger: lesson-gate hook 误将 skill prompt injection 文本检测为用户纠正信号
last_verified: 2026-04-02
---

# Lesson Gate 误报：Skill Prompt Injection 被当作纠正信号

## Decision

当 lesson-gate 反复触发同一个 signal 且该 signal 文本来自 slash command 的 prompt injection（如 `/codex:review` 的 "Run a Codex review through the shared built-in reviewer"），应直接 mark as handled，不需要写真正的 lesson。

根因是 lesson-gate 的信号检测逻辑无法区分"用户纠正"和"skill 注入的指令文本"。

## Source Cases

- 2026-04-02: `/codex:review` 的 skill prompt 被检测为 "Explicit correction at turn 1"，同一会话内反复触发 3 次。signal 文本为 "Run a Codex review through the shared built-in reviewer. Raw slash-command argu..."，这是 codex:review skill 自动注入的指令，不是用户纠正。

## 潜在修复方向

- lesson-gate.sh 应排除 `<command-name>` / `<command-message>` tag 内的文本
- 或对 skill prompt injection 的 turn 做白名单处理
