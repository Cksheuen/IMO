---
paths:
  - ".git/**/*"
  - "**/.git/**/*"
---

# Git Worktree Parallelism

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 核心原则

**任务隔离，并行执行**

使用 git worktree 为每个任务创建独立工作目录，使多个 Agent 可以同时工作而不互相干扰。

## 使用场景

- 同时开发多个独立功能
- Agent Teams 并行执行任务
- 实验性开发需要隔离

## 操作流程

```bash
# 创建任务 worktree
git worktree add ../project-feature-auth -b feature/auth

# 任务完成后合并
git checkout main && git merge feature/auth

# 清理
git worktree remove ../project-feature-auth
```

## 与 Claude Code 的关系

Claude Code 内置 `EnterWorktree` / `ExitWorktree` 工具，可直接使用。

## 相关规则

- [[task-centric-workflow]] - 任务组织方式
