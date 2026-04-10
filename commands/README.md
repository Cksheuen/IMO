# commands/

`commands/` 为顶层、用户可见的 skills 提供显式 slash wrapper。

存在该目录的原因：

- 满足 `AGENTS.md` 对 Codex slash-command 兼容的要求
- 让 skill 可以通过 `/name` 的形式被显式调用

## 维护规则

- 只为顶层、用户可见的 skill 创建 wrapper
- wrapper 保持很薄，只描述入口与适用场景
- wrapper 的语义必须与对应 `skills/<name>/SKILL.md` 保持同步

## 当前状态

当前只保留少量高频入口：

- `promote-notes.md`
- `promotion-mode.md`
- `promotion-auto-on.md`
- `promotion-auto-off.md`
- `promotion-auto-status.md`
- `task-audit.md`

其中 `promotion-auto-*` 仅作为兼容别名，正文应始终保持一跳跳转到统一入口 `/promotion-mode`，避免重复维护。

`task-audit.md` 是只读治理入口，用于人工扫描本地 `tasks/` 池中的重复主题、draft、legacy 和非标准目录；它不属于自动 hook，也不执行清理动作。
