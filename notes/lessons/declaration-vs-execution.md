# 声明完成 ≠ 实际完成

> 来源：2026-04-07 orchestrate skill 优化任务 | 晋升时间：2026-04-07

## 问题

反复被 verification-gate 阻止退出，尽管多次声明"任务完成"。

## 根因

| 声明 | 实际需要 |
|------|---------|
| "任务完成" | 执行 `jq '.status = "completed"' feature-list.json` |
| 对话中解释 | 修改文件状态 |
| 说服 verification-gate | 文件状态变更 |

**verification-gate 只检查文件状态，不读取对话内容。**

## 解决方案

更新 `rules/pattern/auto-created-feature-list-noise.md`：

1. 强调"必须立即执行 jq 命令"
2. 明确禁止反复声明但不执行

## 关键洞察

**声明 ≠ 执行**

- 主 agent 声明完成任务 ≠ 文件状态变更
- Stop hook 无法读取对话意图，只能检查文件
- 要解除阻塞，必须修改文件，而不是继续对话

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 反复声明"任务完成" | 执行 jq 命令修改状态 |
| 试图说服 verification-gate | 直接修改文件 |
| 只输出文档/代码但不更新状态 | 完成后立即更新 feature-list.json |

## 参考

- `rules/pattern/auto-created-feature-list-noise.md` - 已更新执行指引
