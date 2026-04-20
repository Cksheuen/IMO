/caveman-mode [on|off|status|intensity|allowlist]

统一管理 Caveman 全局开关，用于全局输出风格压缩（中文简洁协议）。

## 参数

| 参数 | 动作 |
|------|------|
| `on` | 打开全局简洁协议注入 |
| `off` | 关闭全局注入，恢复默认输出风格 |
| `status` | 打印当前 config（enabled / intensity / allowlist） |
| `intensity <lite\|full\|ultra>` | 切换压缩档位 |
| `allowlist add <skill>` | 将 skill 加入豁免列表（该 skill 触发时不注入协议） |
| `allowlist remove <skill>` | 移除豁免 |
| `allowlist list` | 列出当前豁免 skill |

## 执行要求

1. `on` → `python3 "$HOME/.claude/scripts/caveman-mode.py" enable`
2. `off` → `python3 "$HOME/.claude/scripts/caveman-mode.py" disable`
3. `status` → `python3 "$HOME/.claude/scripts/caveman-mode.py" status`
4. `intensity <X>` → `python3 "$HOME/.claude/scripts/caveman-mode.py" intensity <X>`
5. `allowlist <...>` → `python3 "$HOME/.claude/scripts/caveman-mode.py" allowlist <...>`
6. 返回当前 config 摘要，并给出下一步建议：
   - 刚 `on`：提醒本次会话需要重新发一条 prompt 才会注入
   - 刚 `off`：提醒需要在下一条 prompt 生效
   - `intensity` 切换：说明新档位的行为特征

## 兼容别名

- `/caveman-on` = `/caveman-mode on`
- `/caveman-off` = `/caveman-mode off`
- `/caveman-status` = `/caveman-mode status`

## 档位说明

| 档位 | 行为 |
|------|------|
| `lite` | 去客套话 + 去 hedging，句式不变，允许段落解释 |
| `full` | 短句优先，合并同义句，列表替代长段落 |
| `ultra` | 电报体，箭头表因果，列表优先，段落最后 |

## 豁免场景

以下 skill 触发时自动豁免，保留详细输出：
`brainstorm`, `eat`, `orchestrate`, `locate`, `promote-notes`, `dual-review-loop`, `lesson-review`, `metrics-weekly`, `metrics-daily`, `architecture-health`, `skill-creator`, `pencil-design`, `multi-model-agent`

可用 `/caveman-mode allowlist add <skill>` 扩展。
