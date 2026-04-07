---
name: lesson-review
description: 教训回顾技能。仅在用户显式要求“回顾教训”“复盘最近纠正”“处理未回顾的 lesson signals”或使用 `/lesson-review` 时触发。读取 `~/.claude/lesson-signals.json`，只处理其中尚未回顾（`handled != true`）的信号，把结论归并到 `notes/lessons/`，完成后再把本次已处理信号标记为 handled。
---

# Lesson Review - 教训回顾技能

**默认不自动运行，只在显式触发时执行。**

## 目标

把本轮或历史积累的 lesson signals 做一次人工触发的回顾，沉淀为可复用的 `notes/lessons/` 内容。

## 输入来源

优先读取：`~/.claude/lesson-signals.json`

如果文件不存在、`unhandled_count == 0`，直接说明“当前没有未回顾内容”，不要制造新的 lesson。

## 回顾区间

**只回顾未回顾内容。** 判定规则：

- 仅处理 `signals` 中 `handled != true` 的项
- 已 `handled: true` 的历史信号全部跳过
- 若用户另外指定更小范围，可在“未回顾内容”子集内继续收缩

## 执行步骤

1. 读取 `~/.claude/lesson-signals.json`
2. 提取所有 `handled != true` 的 signals 作为本次回顾区间
3. 按主题搜索 `notes/lessons/` 现有 note
4. 若已有同主题 note：更新 `Last Verified` / `Source Cases` / `Decision`
5. 若没有：新建主题化 lesson note，避免按日期写流水账
6. **只有在 note 写入成功后**，才把本次处理过的 signals 标记为 `handled: true`，并同步更新 `unhandled_count`

## 标记完成

完成回顾后，用脚本或等价方式更新 state file，保证只标记本次实际处理的未回顾 signals：

```python
import json
from pathlib import Path

path = Path.home() / '.claude' / 'lesson-signals.json'
state = json.loads(path.read_text())
for signal in state.get('signals', []):
    if not signal.get('handled'):
        signal['handled'] = True
state['unhandled_count'] = sum(1 for s in state.get('signals', []) if not s.get('handled'))
path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
```

## 约束

- 不要在没有显式触发时主动执行本技能
- 不要回顾已 handled 的历史内容
- 不要在 main agent 中把“检测到 signal”误当成“必须立刻写 lesson”
- 不要重写 `signal-detector.sh`，除非当前任务明确要求修改检测逻辑
