# Task-Centric Workflow

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 核心原则

**任务驱动，上下文隔离**

每个任务独立目录，包含完整的上下文（PRD、实现状态、评审标准），使 AI 能准确理解工作目标。

## 目录结构

```
tasks/
├── feature-auth/
│   ├── prd.md        # 需求 + Acceptance Criteria
│   ├── context.md    # 相关文件、依赖
│   └── status.md     # 进度、blockers、next steps
└── feature-payment/
    └── ...
```

## 关键实践

1. **PRD 明确验收标准**：Acceptance Criteria 作为评审依据
2. **status.md 记录进度**：便于会话恢复
3. **context.md 隔离上下文**：每个任务有独立的相关文件列表

## 与 CLAUDE.md 的关系

CLAUDE.md Plan 阶段已整合此模式：每个任务独立规划，状态可追踪。

## 相关规则

- [[context-injection]] - 上下文注入
- [[git-worktree-parallelism]] - 并行任务隔离
