---
name: codex-review-symlink-eisdir
description: Codex review 在 symlink 指向目录时触发 EISDIR 错误的规避方案
triggers:
  - 运行 /codex:review 或 /codex:adversarial-review
  - 项目工作树中存在 symlink 指向目录
---

# Codex Review EISDIR 规避

> 来源：notes/lessons/codex-eisdir-symlink-directory.md

## 触发条件

当满足以下条件时，使用替代方案：
- 运行 `/codex:review` 或 `/codex:adversarial-review`
- 项目中存在 symlink 指向目录（如 `.claude/tasks/current -> 2026-04-02-xxx/`）

## 问题

codex-companion.mjs 的文件遍历逻辑未处理 symlink-to-directory，触发：
```
EISDIR: illegal operation on a directory, read
```

## 决策框架

```
需要 codex review？
    │
    ├─ 项目有 symlink 指向目录？
    │       │
    │       ├─ 是 → 使用 reviewer agent 替代
    │       │
    │       └─ 否 → 正常使用 codex review
    │
    └─ 不确定 → 检查：find . -type l -exec test -d {} \; -print
```

## 替代方案

```yaml
# 使用 reviewer agent
Agent(subagent_type: "reviewer", prompt: "Review the code changes")

# 或使用 code-reviewer
Agent(subagent_type: "code-reviewer", prompt: "Review code quality and security")
```

## 检查 symlink

```bash
# 查找指向目录的 symlink
find . -type l -exec test -d {} \; -print
```

## 长期修复

需要在 codex plugin 中排查文件遍历是否 follow symlink 时缺少 `lstat` / `isDirectory` 检查。
