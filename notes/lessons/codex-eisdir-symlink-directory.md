---
title: Codex review EISDIR 错误：symlink 指向目录导致文件遍历崩溃
status: promoted
promoted_to: rules-library/tool/codex-review-symlink-eisdir.md
last_verified: 2026-04-02
---

## Trigger

当项目工作树中存在 symlink 指向目录（如 `.claude/tasks/current -> 2026-04-02-xxx/`）时，运行 `/codex:adversarial-review` 或 `/codex:review`。

## Decision

1. codex-companion.mjs 的文件遍历逻辑未处理 symlink-to-directory，触发 `EISDIR: illegal operation on a directory, read`
2. 遇到此错误时，不要重试（同样会失败），改用 reviewer agent 替代
3. 长期修复：需要在 codex plugin 中排查文件遍历是否 follow symlink 时缺少 `lstat` / `isDirectory` 检查

## Source Cases

- **2026-04-02 slugcat 终端测试**: 项目含 `.claude/tasks/current` symlink 指向任务目录。两次运行 `/codex:adversarial-review` 均因 EISDIR 失败。根因是 codex-companion.mjs 遍历文件时对 symlink 指向的目录执行了 `read()` 文件操作。

## Workaround

遇到 EISDIR 时的替代方案：
- 使用 `Agent(subagent_type: "reviewer")` 或 `Agent(subagent_type: "code-reviewer")` 执行审查
- 或临时删除/重命名 symlink 后重试 codex review
