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

补充边界：

- `hooks/` 顶层只放事件脚本，且应已挂到 `settings.json`，或在文件头明确声明对应 hook 事件
- 非事件触发的 CLI 工具统一放 `scripts/`
- `caveman-mode`、`promotion-mode`、`task-audit` 等运维 CLI 已迁到 `scripts/`
- `scripts/verification-gate.sh` 也放在 `scripts/`，因为它是项目级 hook 配套工具，不是全局共享 hook 脚本

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

补充：

- `hooks/` 里也允许放**不自动挂载的只读/检查型工具**
- 这类脚本必须在文档中明确写出“不是自动 hook，只是本地检查工具”
- 当前例子包括：
  - `runtime-profile-audit.py`
  - `runtime-storage-audit.py`
  - `task-audit.py`
  - `check-langchain-runtime-deps.py`
  - `promote-notes-run.py`

其中：

- `promote-notes-run.py` 是 `promote-notes` 的人工执行 helper
- 它不挂到 `settings.json`，不属于自动 hook
- 它只包装既有 `promotion-dispatch.py` / `promotion-apply-result.py`，用于减少手工拼 `promotion-result.json`

### Runtime Profiles

当前仓库长期同时存在两套 runtime profile：

- **shared runtime**：根目录 `settings.json`
- **repo-dev runtime**：仓库内 `.claude/settings.json`

判断方法：

- 某条脚本若挂在根 `settings.json`，它属于共享 profile
- 某条脚本若挂在仓库内 `.claude/settings.json`，它只服务“开发这个仓库自身”
- 若要快速对照两套 profile，运行：
  - `python3 "$HOME/.claude/scripts/runtime-profile-audit.py"`

这个 audit 是只读工具，不属于自动 hook，不改变任何挂载。

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
- 根目录 `settings.json` 在 `UserPromptSubmit` 挂载 `hooks/skill-loader/skill-inject.sh`、`hooks/recall-entrypoint.py`
- 根目录 `settings.json` 在 `Stop` 挂载 `hooks/recall-capture.py`、`hooks/context-monitor.sh`
- `scripts/verification-gate.sh` 和 `hooks/lesson-capture/lesson-gate.sh` 已从自动 Stop hook 中移除，改为手动工具（可通过 `/task-audit` 或直接调用脚本使用）
- 项目级 `.claude/settings.json` 在 `Stop` / `SubagentStop` 挂载 `.claude/hooks/promotion-scan.py`
- 项目级 `.claude/settings.json` 在 `Stop` / `SubagentStop` 挂载 `.claude/hooks/promotion-gate.py`
- 项目级 `.claude/settings.json` 在 `SessionStart` 挂载 `.claude/hooks/promotion-queue-status.py`
- Promotion Loop 是否自动运行受根目录 `promotion-config.json` 的 `autoBackgroundEnabled` 控制
- `promotion-scan.py` 只做轻量候选扫描，不直接替代 `promote-notes`
- 命中候选时输出短晋升信号，供后续 `Promotion Loop` 继续处理
- 命中候选时同时写入根目录 `promotion-queue.json`
- `promotion-gate.py` 在队列仍有新鲜候选时阻止静默结束，要求继续执行 `Promotion Loop`
- 完整晋升动作不在 hook 中执行，而是交给独立 `promote-notes` subagent
- `skill-loader/skill-inject.sh` 在 `UserPromptSubmit` 输出轻量 skill 路由提示，不注入完整 `SKILL.md`

当前共享运行时新增接通的部分：

- 根目录 `settings.json` 在 `PreToolUse` 的 `Edit` / `Write` matcher 上挂载了 `hooks/scale-gate.sh`
- `hooks/scale-gate.sh` 在首次编辑前调用 `scripts/task-bootstrap.sh` 自动创建 task 目录（task-bootstrap 是 helper 而非事件 hook，已归 scripts/）
- 当前共享链路已经可以把”大任务先做规模评估，再进入 task workflow”落成运行时守门

### Minimal Recall Runtime（2026-04-10）

挂载事实：

- 挂载位置：根目录 `settings.json`
- 触发事件：`UserPromptSubmit`（query）+ `Stop`（capture）
- 脚本：
  - `python3 "$HOME/.claude/hooks/recall-entrypoint.py"`
  - `python3 "$HOME/.claude/hooks/recall-capture.py"`
- 消费方：
  - query 结果由 Claude Code hook runtime 注入 `hookSpecificOutput.additionalContext`，消费方是主 agent
  - 同一 consumer path 现在同时承接两类上下文：
    - `memory/declarative/` 的极短 declarative snapshot
    - `recall/entries.jsonl` 的 episodic recall hints
  - `notes/`、`eat`、`promote-notes` 不是 recall query 的消费方（它们各自走沉淀/晋升链路）
  - capture 结果写入 `~/.claude/recall/entries.jsonl`，供下次 query 读取

行为约束：

- 显式 `recall.query ...` contract 优先于自动模式
- 自动模式仅在明显跨轮/恢复信号时触发（如 `continue session`、`resume context`、`继续上次`、`恢复上下文`）
- 自动模式默认 `k=1`，并使用更小注入预算（默认 `budget_chars=220`）
- 自动模式有结果门控；命中不足时 `emit({})`，不注入 recall context
- query 只搜索 `~/.claude/recall/entries.jsonl`，不扫描 `notes/` / `tasks/` 全文
- declarative snapshot 只读取 `memory/declarative/index.json` 注册的文件，并过滤 `active` + `cross-session`
- 注入有硬预算（默认短文本）
- 只注入摘要 + 指针，不注入 transcript 原文
- declarative snapshot 使用 fenced context，明确标注“不是新的用户输入”
- capture 为 append-only，按 `entry_id = session_id:transcript_mtime` 去重

### Declarative Snapshot Consumer Path（Batch 5）

- 挂载位置：根目录 `settings.json` 的 `UserPromptSubmit` -> `hooks/recall-entrypoint.py`
- 读取路径：`memory/declarative/runtime.py` 只读取 `memory/declarative/index.json` 注册的 leaf files
- 消费规则：仅 `status=active` + `scope=cross-session`，按 `subject+key` 去重，输出极短 fenced snapshot（`<memory-context>...</memory-context>`）
- 注入通道：与 recall hints 共用同一个 `hookSpecificOutput.additionalContext`
- 边界约束：不改变 recall store 查询边界，recall 仍仅读取 `~/.claude/recall/entries.jsonl`
- 兜底：无有效 declarative facts 时静默返回空，不输出异常堆栈到上下文

### Declarative Read-Path Hardening（Batch 6）

- runtime 只信任 `index.json` registry，不直接遍历目录
- registry 与 leaf record 不一致时 fail-closed：
  - `file`
  - `id`
  - `kind`
  - `subject`
  - `key`
- 同一 `subject+key` 若出现多个不同有效 leaf record，则整项静默跳过，不做猜测合并
- hook consumer 不负责修复 declarative 数据；冲突应由 owner 链路（`promote-notes`）后续处理

### Declarative Consumer Helper（Batch 7 / 子任务 2）

- 新增 `scripts/context-bundle.py`，用于承接 declarative consumer 的共享逻辑（从 `recall-entrypoint` 可复用抽离点）
- helper 职责只包含三件事：
  - declarative snapshot 加载（调用 `memory/declarative/runtime.py` 的 `build_snapshot`）
  - session cache/frozen 语义
  - declarative + recall context 的 combine 与 `additionalContext` payload 组装
- session 语义：
  - 有 `session_id`：first-turn frozen。首次成功读取后写入 session cache，后续同 session 固定复用
  - 无 `session_id`：deterministic fallback。每次都从 runtime 重新读取，不依赖 cache
- 默认 cache 文件：`~/.claude/recall/declarative-session-cache.json`（可通过 `CLAUDE_DECLARATIVE_SESSION_CACHE` 覆盖）

边界约束：

- helper 不查询 recall store，不负责 recall ranking/query contract
- helper 不修复 declarative registry/leaf 冲突，仍遵循 read-side fail-closed
- helper 不改 `settings.json` 挂载，不改 memory runtime、skills、notes 的 owner 链路

最小验证方法：

- query 本地验证：
  - `printf '{"prompt":"recall.query query=\"scale gate\" k=2 budget_chars=240"}' | python3 ~/.claude/hooks/recall-entrypoint.py`
- capture 本地验证：
  - `printf '{"session_id":"test-session","transcript_path":"'"$HOME"'/.claude/history.jsonl"}' | python3 ~/.claude/hooks/recall-capture.py`
- store 检查：
  - `tail -n 3 ~/.claude/recall/entries.jsonl`

### Lesson Capture 后台执行机制

- `hooks/lesson-capture/lesson-gate.sh` 在 `Stop` 事件触发时检测纠正信号
- 当检测到未处理的纠正信号时，**使用 `nohup claude ... &` 在后台启动独立进程**
- 若同一批未处理 signal 已有后台进程运行，则不会重复拉起新进程
- 后台进程执行 `promote-notes` 技能捕获教训
- **主 agent 返回 `exit 0`，用户流程不被打断**
- 日志输出到 `~/.claude/logs/lesson-capture/background-*.log`

关键约束：
- hook 不向主 agent 输出任何指令
- 用户不会看到 `[LESSON CAPTURE REQUIRED]` 等提示
- Lesson capture 在后台静默完成

补充说明：`hooks/lesson-capture/lesson-gate.sh` 已于 2026-04-03 废弃，不再默认挂载；教训回顾改为通过 `/lesson-review` 显式触发，并只处理未回顾（`handled != true`）信号。

当前最小执行桥还包括：

- `promotion-dispatch.py claim`：消费 queue，把候选标为 `processing`
- `promote-notes` subagent：只处理已 claim 的候选，并写 `promotion-result.json`
- `promotion-apply-result.py`：把 subagent 结果回写到 queue
- `promotion-dispatch.py fail`：subagent 异常时恢复 queue
- `scripts/audit-runtime-links.py`：静态审计文档中的”已落地/当前运行时协议”声明是否真的有对应 settings 挂载（只读，不自动执行）

### Promotion Loop 后台执行（2026-04-03 更新）

**重要变更**: Promotion Loop 现在完全在后台执行，不再阻断主 agent。

| 组件 | 之前 | 现在 |
|------|---------|------|
| `lesson-gate.sh` | `exit 2` + stderr 输出 | `nohup ... &` + `exit 0` |
| `promotion-gate.py` | `decision: “block”` | `subprocess.Popen` + `sys.exit(0)` |
| 主 agent 行为 | 被迫执行 subagent | 正常结束 |
| 用户感知 | 看到 `[PROMOTION LOOP REQUIRED]` | 无感知 |

补充：verification gate 仍保留 `stderr` 指令输出，结构化日志只是附加通道，不替代现有 stop-hook 消费链路。

后台进程日志：
- Lesson capture: `~/.claude/logs/lesson-capture/background-*.log`
- Promotion capture: `~/.claude/logs/promotion-capture/background-*.log`

注意：上面这条 Promotion Loop 属于**当前仓库开发态的项目级链路**，真实挂载位置是 `.claude/settings.json`，不是根目录共享 `settings.json`。

### Promotion Loop 开关（2026-04-09 更新）

- 配置文件：根目录 `promotion-config.json`
- 开关字段：`autoBackgroundEnabled`
- `true`：允许 `promotion-scan.py` / `promotion-gate.py` 在 `Stop` / `SubagentStop` 自动执行并后台拉起 `promote-notes`
- `false`：hooks 静默跳过 promotion 自动链路，用户需手动执行 `/promote-notes`
- 推荐用户入口：
  - `/promotion-mode status`
  - `/promotion-mode on`
  - `/promotion-mode off`
- 兼容别名：
  - `/promotion-auto-status`
  - `/promotion-auto-on`
  - `/promotion-auto-off`
- 底层脚本：
  - `python3 "$HOME/.claude/scripts/promotion-mode.py" status`
  - `python3 "$HOME/.claude/scripts/promotion-mode.py" enable`
  - `python3 "$HOME/.claude/scripts/promotion-mode.py" disable`

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
