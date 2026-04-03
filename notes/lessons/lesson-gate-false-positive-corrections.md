---
title: lesson-gate 将 slash command 和 hook feedback 误判为 correction
status: resolved
promotion_status: resolved
promotion_reason: "描述的是 lesson-gate 的 false positive bug，已通过 filter 修复；同时 lesson capture 已改为 subagent 派发模式"
last_verified: 2026-04-02
resolved_at: 2026-04-02
resolution: |
  1. signal-detector.sh 增加了 `is_system_injection()` 过滤函数
  2. lesson-gate.sh 改为输出结构化指令 spawn subagent
  3. lesson-gate.sh 添加可配置路径环境变量 (`LESSON_SIGNALS_FILE`, `LESSON_DETECTOR_PATH`)
  4. lesson-gate.sh 简化 Python 代码，移除冗余的信号标记逻辑
  5. subagent 完成后直接删除 state file (`rm -f '$STATE_FILE'`)
---

## Trigger

当会话中使用 `/codex:review`、`/codex:adversarial-review` 等 slash command，或 hook 反馈（Stop hook feedback）出现在对话中时，lesson-gate 将其检测为 "explicit correction"。

## Decision

1. 这些不是用户纠正，是系统生成的消息（slash command 展开、hook stdout）
2. lesson-gate 的 correction 检测逻辑缺乏对消息来源的区分——无法区分"用户说你错了"和"系统注入的 slash command prompt"
3. 遇到此类 false positive 时，直接标记 handled，不需要写无意义的 lesson
4. 遇到此类 false positive 时，直接标记 handled，不需要写无意义的 lesson
5. 长期修复：lesson-gate.sh 应排除以下消息类型：
   - 以 `<command-name>` 标签包裹的 slash command
   - 以 `Stop hook feedback:` 开头的 hook 输出
   - 以 `Run a/an` 开头的 skill prompt 展开文本
   - `promotion-queue.json` / `promotion-result.json` 的变化（这些是系统状态文件，不是用户纠正）
   - slash command 展开后的完整 prompt（如 `/ttcodex:setup` 展开内容）
6. **signal-detector.sh 应增强 `is_system_injection()` 函数**：
   - 添加 "Stop hook feedback:" 前缀过滤
   - 添加 "Run a/an" 开头的 imperative instruction 过滤
   - 在 repeated modification 检测中排除 `lesson-signals.json` 自身
   - 在 repeated modification 检测中排除 `feature-list.json` 的内部操作修改
   - 添加 "This session is being continued from a previous conversation" 会话继续消息过滤
   - 在 repeated modification 检测中区分"同一 turn 的多次 hook 调用"和"跨 turn 的迭代修复"

## Source Cases

- **2026-04-02 slugcat 终端测试会话**: 同一会话中 lesson-gate 触发 4 次，累计检测到 10 个 "correction" 信号，实际全部是 `/codex:adversarial-review`、`/codex:review` slash command 和 hook feedback 的 false positive。每次都需要手动标记 handled，严重干扰工作流。
- **2026-04-02 plugin 删除会话**: lesson-gate 触发 3 次，累计 9 个信号。误判来源：`/plugin` 命令输出、Stop hook feedback 循环触发自身、`/codex:review` skill prompt、feature-list.json 正常编辑。全部为 false positive。
- **2026-04-02 plugin 修复 + promotion loop 会话**: lesson-gate 触发多次。误判来源：
  1. `promotion-queue.json` 被 promotion-scan 反复更新，导致 feature-list.json 被重复 bootstrap（5 次修改）
  2. `/ttcodex:setup` 展开的 prompt 被 lesson-gate 误判为 "expectation downgrade"
- **2026-04-02 adversarial review 会话**: lesson-gate 将 `/codex:adversarial-review` 展开的 prompt（"Run an adversarial Codex review through the shared plugin runtime..."）检测为 explicit_correction。实际是 slash command 展开内容，用户的真实反馈在 "Raw slash-command arguments" 字段中，但这应通过 Codex review 流程处理，而非 lesson capture。
- **2026-04-02 ttcodex adversarial review 会话**: 同样的问题，`/ttcodex:adversarial-review` 展开的 prompt（"Run an adversarial Codex review through the shared plugin runtime. Position it as a challenge review..."）被检测为 explicit_correction（turn 1 和 turn 2）。这是 false positive，因为：
  1. 这是从 slash command 展开的指令性文本，不是用户对 agent 的纠正
  2. 模式：以 "Run a/an..." 开头的 imperative 指令被误判为 correction
  3. signal-detector.sh 的 `is_skill_expansion()` 过滤器应覆盖此类情况
- **2026-04-02 adversarial review 后续会话（本次）**: lesson-gate 检测到 7 个 "correction" 信号，全部为 false positive：
  1. Turn 5, 8: Stop hook feedback 输出（"[LESSON CAPTURE REQUIRED]"）被检测为 "explicit correction"
  2. Turn 7: `/codex:adversarial-review` 展开文本（"Run an adversarial Codex review through the shared plugin runtime..."）被检测为 "explicit correction"
  3. Repeated modification: `lesson-signals.json` 自身的正常操作被检测为 repeated modification（8 次）
  4. Repeated modification: `feature-list.json` 的正常编辑被检测为 repeated modification（9 次）
  5. Pattern frustration: 基于上述 false positive 衍生的 "3+ corrections" 模式

  **根因分析**：signal-detector.sh 的 `is_system_injection()` 过滤器不完整：
  1. **Stop hook feedback 过滤**: lesson-gate.sh 的 stderr 输出被写入 transcript 后，再次被检测为 correction
  2. **Skill expansion 过滤**: 无法识别 "Run a/an..." 开头的 slash command 展开指令文本
  3. **Signals file 自排除**: `lesson-signals.json` 未被排除在 repeated modification 检测目标之外
  4. **内部状态文件排除**: `feature-list.json` 在 signal 处理流程中的正常修改被误判
- **2026-04-03 promote-notes subagent 会话**: lesson-gate 检测到 2 个信号，均为 false positive：
  1. "Explicit correction": 会话继续消息（"This session is being continued from a previous conversation that ran out of context"）被检测为 correction，实际是系统级会话恢复消息
  2. "Repeated modification": `task-bootstrap.sh` 在同一 turn 被 hook 调用 5 次（turn 2 所有修改都在同一 turn），实际是 hook 正常执行，非迭代修复问题

  **根因分析**：
  1. **Session continuation 过滤**: 会话继续消息（context window 耗尽后自动恢复）应被排除，这是正常的 context anxiety 处理机制，已在 `rules/technique/long-running-agent-techniques.md` 中定义
  2. **Hook 调用 vs 修改**: repeated modification 检测应区分"同一 turn 的多次 hook 调用"和"跨 turn 的迭代修复"；同一 turn 内的多次修改通常是 hook 机制导致的，不是问题信号
  3. **task-bootstrap.sh 特殊性**: 该脚本在会话启动时被 scale-gate 调用，同一 turn 内多次执行是正常行为

## Impact

- 每次 false positive 阻塞退出，需要额外 1-2 轮交互处理
- 本次会话因此浪费约 4 轮交互（~8000 tokens）
- 降低 lesson-gate 的可信度，真正的 correction 容易被忽视
