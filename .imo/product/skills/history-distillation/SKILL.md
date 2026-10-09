---
name: history-distillation
description: 炼化或清理本地 Claude Code、Codex、Grok 的历史会话：按来源维护增量历史水位，从长程任务链提炼用户明确纠正、隐藏意图、反例与 global/project-only 经验，并在证据完备后会话归档或删除冗余记录。触发词：炼化 history、清理本地 CC/Codex/Grok history、增量历史水位、会话归档、历史蒸馏。
---

# History Distillation / 历史炼化

把已完成的本地 AI 会话提炼成可执行规范，直接更新已有 rule、skill 或全局
profile。默认不新增历史炼化笔记、研究报告或重复知识副本；来源核对在当前
任务中完成，需要跨轮增量的 id/hash 水位放在本地 runtime。

笔记只能作为临时证据工作面，不能作为本流程的交付物。用户要求直接炼化或
删除已有笔记时，稳定结论必须回填现有 owner；完成目标文件回读和引用清理后，
删除精确的笔记文件，不另存归档、摘要或“已炼化”副本。

## 来源与水位

- 水位按来源各自持久化：Claude history root 下按 session id，Codex 按 thread/session id，Grok 按 LevelDB 记录键；每条记录绑定 source-specific session id、timestamp、content hash。
- eligibility window：炼化与清理前先定 `eligible_before = 当前时间 - 用户指定窗口`（本轮 24h）；只有整条任务链在 eligible_before 之前已完成的记录才可进入炼化与清理候选。
- 链完成状态按整条 task chain / root parent 判断：child session 完成不代表链完成；链状态以 root parent 最终状态为准。
- `task_complete`、`end_turn` 只证明一轮结束；必须结合最后的用户目标、结果及后续续接记录确认整链完成。只有进度回复、待接手、未完成验证或仍待执行的记录按 unknown/ongoing 排除。
- 正在进行、窗口内完成、完成时间不明的链：不得用于画像/rule/skill 结论，也不得删除，默认保留。
- manifest 必须含 chain status 与 completed_at（或保守证据标注 unknown）；mtime 仅作辅助排序与异常检测，不得作为增量、链完成判定或删除依据。
- 未获扫描授权时直接退出；水位缺失时只处理用户显式指定范围。

## 过滤与身份判定

- Claude history：剔除 subagents 目录、tool_result 块、local-command 输出与 skill 注入内容，只保留真人指令与决策。
- Codex：按 thread_source/source/parent/fork 字段区分真人会话、subagent、exec worker 与 smoke 会话；role=user 不等于真人，工具回填与 fork 链必须按来源字段判定。
- Grok：LevelDB 内容只证明本地缓存存在，不证明云端对话发生过；引用时标注“本地缓存”。

Grok 的 CLI `prompt_history.jsonl` 如果存在，可以作为独立的本地来源按
timestamp 增量读取；浏览器 IndexedDB/LevelDB 仍只能证明本地缓存存在。
两类来源不可互相替代，也不能把某个来源的空结果推断成云端没有对话。

## 提炼

- 以长程任务链为单位，提炼：用户明确纠正、隐藏意图、反例、global 与 project-only 经验。
- 只炼化 eligible 链（见来源与水位 eligibility window）；ongoing、窗口内完成、完成时间不明的链内容不进入 claims/profile/promotion 结论。
- 项目级 why 仅在 docs/code/Git/memory 均无替代承载时保留，否则只留指针。
- 不造 task/spec 状态机，不自动写 canonical memory；稳定结论按 promote-notes 的来源、范围和回滚要求直接落入已有规范，无需先生成 note。

## 已有笔记的直接替换

- 先读取笔记的当前有效视图和来源证据，只提取仍成立、能形成执行规则的结论；
  项目私有事实回到项目 source/docs，不搬进全局笔记或画像。
- 查重后把结论写入已有 rule、skill 或 profile；优先合并到现有 owner，只有真实
  责任边界缺失时才扩展已有 owner，不因笔记存在而新建平行资产。
- 回读目标 owner、规则索引、调用方和实际上下文注入，确认笔记结论已经被消费；
  同时删除 profile、索引和其他文档中的笔记路径或 note id 引用。
- 只有替代承载和回读证据都成立后，才删除精确笔记文件；删除后再按路径与 id 做
  一次全局检索，确认没有残留副本。不得把删除后的内容重写成历史报告或新 note。

## 规范落地与验收

1. 从真人纠正和跨任务复现中提炼「触发条件 → 执行动作 → 验收证据」。
   查找反例和适用范围；一次任务的模型、路径和特例不升级成永久全局默认。
2. 查重后选择现有 owner：通用行为写 rule，工具流程写 skill，稳定的人级
   偏好写 profile。项目实现事实留在项目 source/docs，不复制进全局画像。
3. 已明确要求“提炼并添加规范”就是本轮写入授权；直接修改、审阅和验证，
   不以整理笔记或列出候选替代交付，也不重复请求同一授权。
4. 更新正文时同步规则索引、调用方与上下文摘要；先证明某条约束冗余或失效，
   再删改，不能仅以“模型变强”为理由取消证据、权限或数据保护边界。
5. 来源引用使用真实 session/turn ID 或已有证据位置；按变更的文件回读，
   检查实际注入与必要契约。最终报告改了哪些规范、行为如何变化、验证结果。

水位只标记实际完成证据审阅的链，不把扫描过的文件都记成已炼化。只有在
删除历史时才需要 exact manifest 与删除前后 readback；更新规范不强制生成
四套额外文档。后台准备仍只生成候选，不能借本轮授权启用持续自动 promotion。

## 清理

- 清理前先生成 exact manifest（路径、id、分类、chain status、completed_at 或保守证据、替代承载、字节数），由主 agent 审查；若当前用户请求已明确授权该精确类别则无需重复提问，否则请求确认后才执行。
- 仅清理 eligible 且 archived+distilled+replaced，或 smoke/aborted/redundant 会话；active 链、窗口内完成链与完成时间不明的链默认保留。
- 排除：当前活动会话、被 codex://threads 引用的记录、未完成的外部写证据链。
- 用户当前明确要求删除即授权，但仍需精确解析范围，不得扩大。
- 删除前后各 readback 一次，并汇报不可恢复性。
