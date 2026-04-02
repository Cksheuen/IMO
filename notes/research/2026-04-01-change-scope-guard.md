- Status: superseded
# 2026-04-01 改动边界防误伤规范调研

- 日期：2026-04-01
- 触发来源：用户反馈「agent 在工作过程中总是对不相关的内容造成破坏」
- 目标：通过 `brainstorm` 先调研，再沉淀一条可执行规范，阻止实现过程中顺手改无关内容

## 知识库检索记录

- 检索关键词：`不相关改动`、`最小影响`、`误伤`、`回滚`、`unrelated changes`
- 命中结果：
  - `rules/pattern/requirements-confirmation.md`：高相关。已约束“先确认需求，避免做错方向”，但没有约束“方向对了之后不要顺手扩范围”。
  - `rules/pattern/change-impact-review.md`：高相关。已约束“修改前分析影响、修改后做回归”，但重点是防回归，不是防无关改动。
  - `notes/lessons/refactor-introduces-regression.md`：中相关。强调修改范围超出预期会引入回归。
  - `notes/lessons/implementation-vs-user-intent-mismatch.md`：中相关。强调目标偏离用户意图。
  - `notes/research/2026-03-27-hooks-notes-design.md`：低相关。只说明 `.gitignore` 已对白名单目录做语义声明。
- 结论：现有规范覆盖“做错方向”和“做出回归”，但缺少“即使方向正确，也必须锁定改动边界，禁止顺手修无关内容”的显式守门规则。

## Repo 调研记录

- 扫描路径：`.gitignore`、`CLAUDE.md`、`AGENTS.md`、`rules/`、`notes/`
- 白名单目录：`.gitignore` 明确允许持久化的目录包括 `agents/`、`skills/`、`commands/`、`hooks/`、`rules/`、`notes/`、`memory/`、`tasks/README.md`
- 现有模式：
  - `CLAUDE.md` / `AGENTS.md` 已有三条总原则：`简洁优先`、`根因导向`、`最小影响`
  - `rules/pattern/requirements-confirmation.md` 负责开工前的需求边界确认
  - `rules/pattern/change-impact-review.md` 负责改动前后的影响审查与回归验证
- 缺口判断：当前缺的是“执行中的改动边界控制”，属于 `pattern` 级规范，而不是纯 lesson 或纯 core 原则复述。

## 业界调研记录

- 搜索关键词：
  - `Anthropic effective harnesses long-running agents minimal changes`
  - `OpenAI Codex AGENTS.md minimal changes unrelated files`
  - `Codex minimal change needed only that change`
- 参考来源：
  1. Anthropic Claude Code docs / best practices：强调通过清晰指令、权限边界、最小必要上下文来降低 agent 误操作风险。
  2. OpenAI《How OpenAI uses Codex》：建议通过 `AGENTS.md` 提供持久上下文，把任务写成像 issue 一样精确、范围明确、可审查。
  3. OpenAI Cookbook `autofix-github-actions`：示例 prompt 明确写出“implement only that change, and stop. Do not refactor unrelated code or files.”

### 参考源演进判断

- 参考源：Anthropic Claude Code 官方文档、OpenAI Codex 官方文档 / cookbook
- 当前主路径：都在强化“把任务范围写清楚 + 只给必要权限/上下文 + 对 diff 做显式审查”
- 旧路径是否仍推荐：不推荐依赖模糊 prompt 或默认让 agent 自主扩张范围
- 对本次方案的影响：应把“改动边界声明 + diff 审查 + 无关问题只记录不顺手修”写成显式规范，而不是只保留在抽象原则层

## 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 仅强化 `CLAUDE.md` 中的“最小影响”一句话 | 改动最少 | 约束太抽象，无法指导执行前/执行中/收尾检查 |
| 只写 `notes/lessons/` | 保留经验，适合复盘 | 不能立即成为强约束，不足以改变后续 agent 行为 |
| 新增 `rules/pattern/change-scope-guard.md`，并在 `CLAUDE.md` / `AGENTS.md` 加一条入口 | 触发条件、执行步骤、决策框架完整；既可被引用，也能被总规范激活 | 需要维护一个新规则文件 |

## 收敛结论

- 推荐方案：新增 `rules/pattern/change-scope-guard.md`
- 原因：这是一个稳定、可复用、具备明确触发条件和执行步骤的规则，已经超过 note 的阶段。
- 配套动作：
  - 在 `CLAUDE.md` / `AGENTS.md` 中加入一句高层守门语句，确保主规范可直接触发
  - 规则中强制要求：
    - 开工前写清楚允许改什么、明确不改什么
    - 发现无关问题时只记录，不顺手修
    - 收尾时审查 diff，删除自己引入的无关改动

## 晋升判断

- 是否需要保留在 `notes/research/`：是，作为本次 brainstorm 证据
- 是否立即晋升到 `rules/`：是，触发条件和执行步骤已经稳定
- 是否需要 lesson 合并：暂不新增 lesson；本规则主要补的是执行边界，不是新的失败主题汇总
