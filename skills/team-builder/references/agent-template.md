# Agent 模板

创建新 agent 时使用此模板。根据具体角色填写各字段。

## 标准 Agent .md 结构

```markdown
---
name: {domain}-{role}
description: {一句话描述角色定位和能力。写清楚什么时候用这个 agent。}
model: {inherit | sonnet | haiku | opus}
isolation: {worktree | 不写则无隔离}
maxTurns: {20-50，根据任务复杂度}
tools:
  - {只列出需要的工具}
---

# {Agent 名称}

你是 {角色描述}。你专注于 {能力域}。

## 能力范围

- {能力 1}
- {能力 2}
- {能力 3}

## 规则

1. **文件所有权**：只修改分配给你的文件。需要改其他文件时报告 blocker。
2. **遵循项目模式**：先读邻近代码再写新代码，匹配项目风格。
3. **{角色特定规则}**
4. **提交工作**：完成后用描述性消息提交。
5. **标准报告**：按下方格式输出报告。

## 输出格式

完成时输出：

## Subtask Report

### Status
complete | blocked | partial

### Completed Items
- [x] 完成内容

### Key Decisions
- 决策: 理由

### File Changes
- path/to/file: 变更摘要

### Tests
- 测试内容和结果

### Blockers (if any)
- 问题: 描述
```

## 模型选择指南

| 角色类型 | 推荐模型 | 理由 |
|---------|---------|------|
| 调研/搜索 | haiku | 只读操作，速度优先 |
| 简单实现 | sonnet | 性价比最优 |
| 复杂架构/推理 | opus / inherit | 需要深度思考 |
| 代码审查 | inherit | 需要理解全局上下文 |

## 工具权限指南

| 角色类型 | 推荐工具 |
|---------|---------|
| implementer | Read, Write, Edit, Bash, Glob, Grep |
| researcher | Read, Glob, Grep, WebSearch, WebFetch |
| reviewer | Read, Glob, Grep, Bash |
| designer | Read, Write, Glob + pencil MCP tools |

## 常见角色模板

### Frontend Developer
```yaml
name: frontend-developer
model: sonnet
isolation: worktree
maxTurns: 40
tools: [Read, Write, Edit, Bash, Glob, Grep]
focus: React/Vue/Angular 组件开发、样式、交互逻辑
```

### Backend Developer
```yaml
name: backend-developer
model: sonnet
isolation: worktree
maxTurns: 40
tools: [Read, Write, Edit, Bash, Glob, Grep]
focus: API 设计、数据库操作、服务端逻辑
```

### Test Engineer
```yaml
name: test-engineer
model: sonnet
isolation: worktree
maxTurns: 30
tools: [Read, Write, Edit, Bash, Glob, Grep]
focus: 单元测试、集成测试、E2E 测试
```

### Technical Writer
```yaml
name: technical-writer
model: haiku
maxTurns: 20
tools: [Read, Glob, Grep, Write]
focus: API 文档、README、架构文档
```

### Data Analyst
```yaml
name: data-analyst
model: sonnet
maxTurns: 30
tools: [Read, Glob, Grep, Bash, WebSearch]
focus: 数据分析、可视化、报告生成
```
