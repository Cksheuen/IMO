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

Phase 1 仅创建目录与约束说明，具体 wrapper 在 skill 迁移稳定后补齐。
