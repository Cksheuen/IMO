# tasks/

`tasks/` 是**当前项目的任务事实源**，服务单次任务的规划、执行、验证与恢复。

标准位置是 `<project>/.claude/tasks/`。

当前仓库已经把 task bootstrap 接入运行时链路，但这里不重复维护具体挂载细节；若要确认当前是否真的接通、挂在哪些事件上，请直接查看：

- `settings.json`
- `hooks/README.md`
- `rules/core/task-centric-workflow.md`

当前仓库本身位于 `~/.claude/`，所以这里的 `tasks/` 只是这个仓库项目自己的任务目录；它不是其他项目共享的全局 task 池。

它回答的是：

- 这次任务要做什么
- 现在做到哪了
- 卡在哪里
- 下一步是什么
- 验收是否通过

## 推荐结构

```text
<project>/.claude/tasks/
└── 2026-03-31-feature-auth/
    ├── prd.md
    ├── context.md
    ├── status.md
    ├── feature-list.json
```

## 文件职责

### `prd.md`

- 写目标、范围、Acceptance Criteria、交付物
- 不写实时进度和过程日志

### `context.md`

- 写相关文件、依赖、外部约束、背景事实
- 不写与当前任务无关的泛化知识

### `status.md`

- 写当前进度、blocker、next step、关键证据链接
- 不写大段长期复盘或通用方法论

### `feature-list.json`

- 写结构化验证状态、attempt_count、passes、notes
- 不写完整调研正文或设计长文

## 目录类型

当前 `tasks/` 中允许三种目录并存：

- **现代 task 目录**：包含 `prd.md / context.md / status.md / feature-list.json`
- **legacy 目录**：只保留旧式编号 JSON（如 `1.json`、`2.json`），用于历史归档
- **特殊调研目录**：只有 `design.md`、`plan.md`、`research.md` 一类文件，表示早期实验或专项设计稿

### Legacy 目录约定

- legacy 目录不视为当前 task workflow 的标准样式
- 若保留旧编号 JSON，建议补 `README.md` 说明其历史性质
- 不再为 legacy 目录补新的 `.lock` / `.highwatermark` 一类运行时噪音文件

## 生命周期治理

当本地 `tasks/` 池开始出现以下信号时，运行只读审计工具：

- 同主题目录反复出现
- `draft-task-*` 持续堆积
- 现代 task、legacy、特殊调研目录混杂后难以人工扫描

推荐命令：

```bash
python3 ~/.claude/scripts/task-audit.py --root ~/.claude/tasks
```

工具输出会标记：

- `modern`
- `legacy`
- `special`
- `draft`
- `nonstandard`
- duplicate themes

注意：

- `task-audit.py` 只读，不自动删除、移动或合并任务目录
- 它的作用是帮助人工决定后续归档、去重和整理动作

## 与 `notes/` 的区别

- `tasks/`：项目级目录，服务当前任务闭环
- `notes/`：用户级全局目录 `~/.claude/notes/`，沉淀跨任务可复用知识

如果一段内容既要支撑当前执行，又值得长期复用：

- `tasks/` 只保留摘要与指针
- 完整正文写入 `notes/`

详见：

- `rules/core/task-centric-workflow.md`
- `rules/core/task-notes-boundary.md`
