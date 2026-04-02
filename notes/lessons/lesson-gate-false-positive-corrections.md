---
title: lesson-gate 将 slash command 和 hook feedback 误判为 correction
status: active
last_verified: 2026-04-02
---

## Trigger

当会话中使用 `/codex:review`、`/codex:adversarial-review` 等 slash command，或 hook 反馈（Stop hook feedback）出现在对话中时，lesson-gate 将其检测为 "explicit correction"。

## Decision

1. 这些不是用户纠正，是系统生成的消息（slash command 展开、hook stdout）
2. lesson-gate 的 correction 检测逻辑缺乏对消息来源的区分——无法区分"用户说你错了"和"系统注入的 slash command prompt"
3. 遇到此类 false positive 时，直接标记 handled，不需要写无意义的 lesson
4. 长期修复：lesson-gate.sh 应排除以下消息类型：
   - 以 `<command-name>` 标签包裹的 slash command
   - 以 `Stop hook feedback:` 开头的 hook 输出
   - 以 `Run a/an` 开头的 skill prompt 展开文本

## Source Cases

- **2026-04-02 slugcat 终端测试会话**: 同一会话中 lesson-gate 触发 4 次，累计检测到 10 个 "correction" 信号，实际全部是 `/codex:adversarial-review`、`/codex:review` slash command 和 hook feedback 的 false positive。每次都需要手动标记 handled，严重干扰工作流。
- **2026-04-02 plugin 删除会话**: lesson-gate 触发 3 次，累计 9 个信号。误判来源：`/plugin` 命令输出、Stop hook feedback 循环触发自身、`/codex:review` skill prompt、feature-list.json 正常编辑。全部为 false positive。

## Impact

- 每次 false positive 阻塞退出，需要额外 1-2 轮交互处理
- 本次会话因此浪费约 4 轮交互（~8000 tokens）
- 降低 lesson-gate 的可信度，真正的 correction 容易被忽视
