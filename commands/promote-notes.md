/promote-notes

显式触发 `promote-notes` 技能或继续处理当前 `promotion-queue.json` 里的待晋升候选。

模式切换：
- 优先使用 `/promotion-mode on|off|status`
- 兼容别名：`/promotion-auto-on`、`/promotion-auto-off`、`/promotion-auto-status`

模式语义：
- 自动模式：Stop / SubagentStop 后台自动扫描并处理
- 手动模式：不自动跑，需手动执行本命令

适用场景：
- 用户要求"提炼 notes"
- 需要手动继续 `Promotion Loop`
- `promotion-dispatch.py` 检测到待处理候选

执行要求：
1. 先运行 `python3 "$HOME/.claude/hooks/promotion-dispatch.py" scan` 扫描候选
2. 若有候选，运行 `python3 "$HOME/.claude/hooks/promotion-dispatch.py" claim` 获取候选
3. 分析候选，决定晋升动作
4. 写入 `promotion-result.json`
5. 运行 `python3 "$HOME/.claude/hooks/promotion-apply-result.py" --result-file promotion-result.json`

晋升动作：
- **create**: 新建 rule/skill 文件
- **merge**: 合并到现有 rule/skill（需指定 target）
- **keep**: 保留在 notes，更新状态
