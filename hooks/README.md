# hooks/

`hooks/` 的一级定义以 `.gitignore` 注释为准：**自定义 hooks（事件钩子脚本）**。

它用于存放会被 Claude Code hooks 机制调用的脚本，以及这些脚本所需的最小辅助文件。

## 设计目标

- 把“事件触发后的自动动作”从 prompt/rules 中分离出来
- 让自定义 hook 脚本可以被版本管理和复用
- 避免把 hook 写成不可审计的本地黑盒

## 边界

`hooks/` 应该放：

- 可执行 hook 脚本，如 `*.py`、`*.sh`
- hook 依赖的轻量辅助模块
- 与 hook 紧密绑定的使用说明

`hooks/` 不应该放：

- 一次性调试脚本
- 与事件触发无关的通用工具
- 知识沉淀类文档
- 密钥、令牌、机器私有路径

## 推荐职责

按事件类型收敛职责，避免 hook 变成第二套规则系统：

- `SessionStart`：注入短小、稳定、计算便宜的动态上下文
- `Notification` / `PermissionRequest`：提醒与交互增强
- `PreToolUse`：安全策略、参数修正、守门
- `Stop` / `SubagentStop`：完成校验与循环控制，但必须有明确的退出条件

## 设计约束

- 快：默认应在秒级完成，避免阻塞主流程
- 稳：输入缺失时降级返回，不因 hook 异常拖垮会话
- 幂等：重复触发时结果应可预期
- 可审计：行为应由脚本和配置显式定义，而不是隐含在 prompt 里
- 最小权限：只访问完成任务所需的最小范围

## 配置关系

- Claude Code 官方通过 `settings.json` 配置 hooks；`hooks/` 本身是脚本存放目录，不是自动生效入口
- 当前仓库根目录 `settings.json` 适用于“这个仓库被直接安装为 `~/.claude`”的场景
- 当前仓库内的 `.claude/settings.json` 与 `.claude/hooks/` 是“开发这个仓库自身”时使用的项目级配置和脚本

因此这里的推荐是：

- 想作为配置仓库内容被同步、复用的 hook 脚本，放根目录 `hooks/`
- 只服务于本仓库开发流程的项目级 hook，继续留在 `.claude/hooks/`

## 调用链

`hooks/` 目录本身不会触发任何脚本。要生效，必须把脚本挂到 settings 中。

最小调用链：

1. 在 `hooks/` 中放置脚本
2. 在 `settings.json` 或项目级 `.claude/settings.json` 中声明事件与命令
3. 通过对应事件触发执行
4. 用实际日志、通知或上下文注入结果验证脚本已经被调用

最小配置检查清单：

- 是否声明了正确的 hook event
- 是否引用了正确的脚本路径
- 是否需要 matcher
- 是否验证过脚本真的被执行

## 真实链路要求

创建脚本、创建 loop、补设计文档，不等于已经进入真实运行链。

以后任何 hook / loop / 自动流程，如果声称“已落地”“自动触发”“当前运行时协议”，必须同时给出：

1. **挂载位置**：是根目录 `settings.json`，还是项目级 `.claude/settings.json`
2. **触发事件**：`SessionStart` / `PreToolUse` / `Stop` / `SubagentStop` 等哪个事件
3. **消费方**：是 hook runtime、主 agent、subagent，还是 queue/disaptch 脚本
4. **验证证据**：实际配置、脚本路径、最小触发验证方法

若缺少以上任一项：

- 只能写成 `proposed` / `design` / `intended`
- 不能写成“当前最小执行链已经落地”
- 不能默认认为后续 agent 会自然遵守这条链

## 与 notes 的协同

`hooks/` 不负责保存知识；它只负责在事件点做自动动作或提醒。

推荐协同方式：

- `SessionStart`：提示当前是否存在高优先级的 `notes/design/` 或 `notes/lessons/` 需要关注
- `Stop` / `SubagentStop`：对本轮更新过的 note 执行轻量晋升扫描，必要时自动进入 `Promotion Loop`
- `Notification`：在用户明确纠正 agent 时，提醒检查 `notes/lessons/`

当前仓库开发态已接入运行时的最小实现：

- 根目录 `settings.json` 在 `PreToolUse` 挂载 `hooks/pre-write-gate.sh`、`hooks/pre-edit-gate.sh`、`hooks/pre-agent-gate.sh`
- 根目录 `settings.json` 在 `Stop` 挂载 `hooks/verification-gate.sh`、`hooks/lesson-capture/lesson-gate.sh`、`hooks/context-monitor.sh`
- 项目级 `.claude/settings.json` 在 `Stop` / `SubagentStop` 挂载 `.claude/hooks/promotion-scan.py`
- 项目级 `.claude/settings.json` 在 `Stop` / `SubagentStop` 挂载 `.claude/hooks/promotion-gate.py`
- 项目级 `.claude/settings.json` 在 `SessionStart` 挂载 `.claude/hooks/promotion-queue-status.py`
- `promotion-scan.py` 只做轻量候选扫描，不直接替代 `promote-notes`
- 命中候选时输出短晋升信号，供后续 `Promotion Loop` 继续处理
- 命中候选时同时写入根目录 `promotion-queue.json`
- `promotion-gate.py` 在队列仍有新鲜候选时阻止静默结束，要求继续执行 `Promotion Loop`
- 完整晋升动作不在 hook 中执行，而是交给独立 `promote-notes` subagent
- `skill-loader/skill-inject.sh` 在 `UserPromptSubmit` 输出轻量 skill 路由提示，不注入完整 `SKILL.md`

当前共享运行时新增接通的部分：

- 根目录 `settings.json` 在 `PreToolUse` 的 `Edit` / `Write` matcher 上挂载了 `hooks/scale-gate.sh`
- `hooks/scale-gate.sh` 在首次编辑前调用 `hooks/task-bootstrap.sh` 自动创建 task 目录
- 当前共享链路已经可以把“大任务先做规模评估，再进入 task workflow”落成运行时守门

当前最小执行桥还包括：

- `promotion-dispatch.py claim`：消费 queue，把候选标为 `processing`
- `promote-notes` subagent：只处理已 claim 的候选，并写 `promotion-result.json`
- `promotion-apply-result.py`：把 subagent 结果回写到 queue
- `promotion-dispatch.py fail`：subagent 异常时恢复 queue
- `hooks/audit-runtime-links.py`：静态审计文档中的“已落地/当前运行时协议”声明是否真的有对应 settings 挂载（只读，不自动执行）

注意：上面这条 Promotion Loop 属于**当前仓库开发态的项目级链路**，真实挂载位置是 `.claude/settings.json`，不是根目录共享 `settings.json`。

约束：

- hook 不应自动把整篇 note 原文注入上下文
- hook 应只输出短提示、摘要或晋升信号
- hook 可以触发轻量晋升扫描与 gate，但不应替代 subagent 的完整晋升判断
- 真正读取哪篇 note，仍由工作流自己决定

### 推荐连接表

| hook 事件 | 推荐连接的 notes 循环 | 用途 |
|----------|------------------------|------|
| `SessionStart` | `Design Loop` / `Correction Loop` | 提醒关注高优先级设计决策或最近 lessons |
| `Notification` | `Correction Loop` | 用户反馈后提醒检查 lesson |
| `Stop` | `Research Loop` / `Design Loop` / `Recovery Loop` / `Promotion Loop` | 结束前扫描本轮更新的 note，必要时自动触发晋升 |
| `SubagentStop` | `Recovery Loop` / `Correction Loop` / `Promotion Loop` | 子任务失败或偏航后扫描是否需要回写或晋升 |

## 推荐目录形态

```text
hooks/
├── README.md
├── session-start.py
├── permission-notify.sh
├── stop-guard.py
└── lib/
    └── ...
```

## 与其他目录的分工

- `rules/`：规定“什么时候这样做”
- `hooks/`：负责“事件触发时自动执行什么”
- `notes/`：沉淀 hook 设计、经验教训、调研笔记
- `memory/`：索引关键路径和长期可检索上下文
