---
name: vim-exit-commands
description: vim 退出命令的区别与选择
type: lesson
status: active
---

# vim 退出命令

## Trigger
当在 vim 中编辑 commit message 或其他内容后需要退出时。

## Decision

| 命令 | 用途 | 场景 |
|------|------|------|
| `:q` | 退出 | 未做任何修改 |
| `:q!` | 强制退出，**放弃修改** | 想放弃更改 |
| `:wq` | 保存并退出 | **merge commit 时使用** |

## Source Cases

### 2026-04-03 git merge commit 场景

**问题**：`git commit` 进入 vim 后用 `:q` 退出，报错 `E37: No write since last change`

**原因**：vim 打开了 merge commit message 模板，有内容需要保存

**解决**：用 `:wq` 保存并退出
