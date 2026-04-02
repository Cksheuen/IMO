# Claude Code Settings Merge 作用域覆盖陷阱

> 主题：settings.json 多层级 merge 导致配置静默失效
> 创建时间：2026-04-01
> 最近验证：2026-04-01
> 状态：active

## 核心教训

Claude Code 的 settings 有多层作用域（user → project → local），merge 时**高优先级作用域的存在会覆盖低优先级**。如果高优先级文件存在但缺少某个 key，该 key 的值会被覆盖为空/undefined，而不是回退到低优先级的值。

## 触发条件

- 项目中存在 `.claude/settings.local.json`（即使内容只有 permissions）
- 用户级 `~/.claude/settings.json` 中配置了 `enabledPlugins`、`hooks` 等
- **特别危险**：当项目根目录本身就是 `~/.claude/` 时，project-level 路径变为 `~/.claude/.claude/`，容易混淆

## 现象

- `claude plugin list` 显示所有 plugin 为 `✘ disabled`
- `claude plugin enable` 报 "Successfully enabled" 但不生效
- `settings.json` 中 `enabledPlugins` 明明写了 `true`
- `/reload-plugins` 输出 `0 plugins · 0 skills · 0 hooks`

## 根因

Settings merge 优先级：`settings.local.json` > `settings.json`（project） > `settings.json`（user）

当 `settings.local.json` 存在时，merge 逻辑以它为主。如果它没有 `enabledPlugins` key，不会回退到 user-level 的值，而是视为"该 key 不存在"→ 所有 plugin disabled。

## 解决方案

确保 `enabledPlugins`（以及其他需要生效的 key）在**最高优先级的 settings 文件**中也存在：

```json
// .claude/settings.local.json
{
  "enabledPlugins": {
    "plugin-name@marketplace": true
  },
  "permissions": { ... }
}
```

## 推广：其他可能受影响的 key

同样的 merge 逻辑可能影响：
- `hooks`：project-local 的 hooks 可能覆盖 user-level hooks
- `env`：环境变量可能被覆盖
- `permissions`：权限可能被覆盖

## 诊断检查清单

遇到"配置写了但不生效"时：
1. 确认存在哪些层级的 settings 文件（user / project / local）
2. 检查目标 key 是否在最高优先级文件中存在
3. 特别注意项目根目录是否是 `~/.claude/` 本身

## Source Cases

- **2026-04-01**：codex plugin 安装后 `/reload-plugins` 显示 0 plugins。排查发现 `~/.claude/.claude/settings.local.json` 存在但无 `enabledPlugins`，覆盖了 user-level settings。在 local 文件中补上 `enabledPlugins` 后解决。相关 issue: [#27247](https://github.com/anthropics/claude-code/issues/27247)

## 参考

- [Claude Code Settings Documentation](https://code.claude.com/docs/en/settings)
- [GitHub Issue #27247](https://github.com/anthropics/claude-code/issues/27247)
