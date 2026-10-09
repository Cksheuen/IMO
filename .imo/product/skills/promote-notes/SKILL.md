---
name: promote-notes
description: 将已稳定且反复复用的 notes 提炼为 rule、skill 或 canonical memory。用户要求“提炼 notes”“升格经验”“检查晋升候选”时触发；默认手动、显式、小批量执行。
description_en: "Manually evaluate stable notes and promote only reusable knowledge into rules, skills, or canonical memory."
---

# Promote Notes

默认主路径是用户显式触发。后台信号最多形成候选或提醒，不自动改变 rule、skill、
active digest 或 declarative memory。

## 边界

- `eat` 吸收新资料；本技能只评估已有 note；
- 低证据、单案例或仍以背景解释为主的内容留在当前工作面；用户要求直接炼化并删除时，先补齐证据或明确不适用，不把空洞摘要留成 note；
- 能成为短 rule 的内容不扩成 skill；
- memory 只接收 canonical fact，不复制 note 正文；
- 每次优先处理 1-3 个候选，避免全库批量晋升。

## 候选资格

至少满足两项：

- 在不同任务中再次复用；
- 触发条件清晰；
- 执行步骤稳定；
- 决策不再依赖单个案例；
- 有可追溯来源和最近验证时间。

## 工作流

1. 若用户指定候选或已有 queue，只处理该小批候选；否则搜索明确标记为
   `candidate-rule` 的 notes。
2. 记录 `Last Verified`、`Source Cases`、触发条件、稳定步骤和仍存在的歧义。
3. 在现有 rules、skills、memory 中查重和检查冲突。
4. 选择最小去向：

   - 频繁、短、稳定、可执行 → rule；
   - 长流程、工具导向、仅按需触发 → skill；
   - 稳定跨会话事实 → canonical declarative memory；
   - 检索路标 → non-declarative memory/index；
   - 证据不足或案例性强 → keep/defer。

5. 晋升时提炼而非搬运，保留来源、review 和 rollback 信息。
6. 若用户要求直接炼化并删除：回读目标 owner，移除 note path/id 引用，再删除精确 note
   文件并做全局残留检索；否则更新原 note 状态与目标路径，复查 queue 或候选状态已正确收尾。

## 全局安装下的 canonical 回流

IMO 全局安装后，`~/.codex/skills/*` 只是懒加载投影，不是可写真源。晋升为
IMO rule/skill 前先运行 `imo global status --json`，读取其中的 `source_root` 与
`source_mode`：

- `linked-checkout`：目标必须写入 `<source_root>/.imo/product/rules/` 或
  `<source_root>/.imo/product/skills/`。Codex symlink 会立即看到更新；仍需显式
  review，并由正常 Git diff/commit 流程带回 IMO 项目。
- `package`：不得修改 package cache、`node_modules` 或 `~/.codex/skills/`。
  只生成带 `target_path`、base hash、来源、review 状态和 proposed patch 的候选，
  放入 `~/.imo/runtime/promotion-outbox/`，等待在 IMO checkout 中显式应用。

自动化可以发现、去重、生成候选和验证 patch，但不得静默写 canonical source、
commit 或 push。这样既保证单一真源，也避免“安装副本更新了、IMO 仓库没更新”。

## Declarative memory

目标为 declarative memory 时，仅构造以下稳定字段：

```text
subject, key, value, valueType, scope, source, updatedAt, lastVerifiedAt
```

用 `subject + key` upsert。禁止写入 transcript、任务进度、长解释、项目私有路径、
credentials 或未经确认的推断。

## 结果

每个候选返回：

- `action`: `promoted_to_rule | promoted_to_skill | indexed_in_memory | merge | keep | defer`；
- `target_path`（如适用）；
- 判断证据和冲突处理；
- 原 note/queue 的收尾状态（已删除或保留及原因）；
- 验证与回滚方式。

若仓库提供 promotion helper，可用它完成 scan/claim/apply 等机械步骤；helper 不能
替代晋升判断，也不能自动把占位结果视为批准。

## 禁止

- 单条 correction 直接升级为全局规则；
- 自动后台修改长期知识；
- 新建与现有资产重复的 rule/skill；
- 把 note body 原样搬到目标文件；
- 因 queue 存在就假设用户已批准晋升。
- 直接编辑 `~/.codex/skills/`、package cache 或 `node_modules` 中的投影。
