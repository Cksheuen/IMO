# Context Injection Pattern

> 来源：[Trellis](https://github.com/mindfold-ai/Trellis) | 吸收时间：2026-03-25

## 核心原则

**按需注入，而非全局加载**

当项目规范变多时，分层组织规范文件，根据当前任务注入相关上下文，避免单文件膨胀。

## 实践要点

1. **CLAUDE.md 保持精简**：只放核心原则（< 100 行）
2. **规范分层存储**：`rules/pattern/`, `rules/technique/`, `rules/tool/`, `rules/knowledge/`
3. **按需引用**：在 CLAUDE.md 中引用相关规则文件

## Claude Code 原生支持

```markdown
# CLAUDE.md 中引用其他文件

## 架构规范
See [architecture.md](rules/pattern/architecture.md)

## 当前任务
See [task-context.md](<project>/.claude/tasks/current/context.md)

若当前仓库本身就是 `~/.claude/`，则当前项目 task 路径等价为 `~/.claude/tasks/current/context.md`。
```

## 相关规则

- [[task-centric-workflow]] - 任务组织方式
