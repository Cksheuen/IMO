# commands/

`commands/` 为顶层、用户可见的 slash 命令提供显式入口。

存在该目录的原因：

- 满足 `AGENTS.md` 对 Codex slash-command 兼容的要求
- 让高频 skill 或只读治理工具可以通过 `/name` 的形式被显式调用

## 维护规则

- 只为顶层、用户可见的 skill 或治理工具创建入口
- 入口保持很薄，只描述用途、执行方式与边界
- 若入口对应 skill，其语义必须与 `skills/<name>/SKILL.md` 保持同步
- 若入口对应只读工具，必须明确“不自动执行”“不修改状态”

## 当前状态

当前只保留少量高频入口：

- `promote-notes.md`
- `promotion-mode.md`
- `promotion-auto-on.md`
- `promotion-auto-off.md`
- `promotion-auto-status.md`
- `task-audit.md`
- `runtime-profile-audit.md`
- `runtime-storage-audit.md`

其中 `promotion-auto-*` 仅作为兼容别名，正文应始终保持一跳跳转到统一入口 `/promotion-mode`，避免重复维护。

`promote-notes.md` 现在对应一条明确的手动主路径：通过 `hooks/promote-notes-run.py` 串起 `scan -> list -> claim -> stub-result -> apply`。它仍是人工决策流，不把晋升判断自动化。

`task-audit.md` 是只读治理入口，用于人工扫描本地 `tasks/` 池中的重复主题、draft、legacy 和非标准目录；它不属于自动 hook，也不执行清理动作。

`runtime-profile-audit.md` 用于对比共享 runtime 与当前仓库开发态 runtime，帮助确认某条 hooks / plugins 配置属于哪一层。

`runtime-storage-audit.md` 用于扫描本地 runtime-heavy 目录的体积与职责边界；它只做观测，不执行清理。
