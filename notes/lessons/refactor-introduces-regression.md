# Lesson: 重构/修改引入回归 bug

- Status: promoted
- Promoted To: rules/pattern/change-impact-review.md
- Promoted At: 2026-03-30
- First Seen: 2026-03-28
- Last Verified: 2026-03-30
- Trigger: 修改功能后原有功能出现 bug，用户说"在先前的修改中产生的"、"又对…造成了 bug"

## 现象

修改或重构代码后，原本正常的功能出现回归。用户多次报告"修改 X 后 Y 坏了"。

## 根因

1. **修改范围超出预期**：改一个功能时无意影响了共享状态或接口
2. **缺乏回归验证**：修改后只验证了新功能，未检查已有功能
3. **跨模块副作用**：Textura 中 master-worker 连接、训练脚本、checkpoint 加载互相依赖

## Source Cases

| 时间 | 案例 | 问题 |
|------|------|------|
| 2026-03-28 | Textura task id 修改 | "又对 worker-master 之间的连接造成了 bug" |
| 2026-03-28 | Textura checkpoint 加载 | "一条进度条的总任务量错误，另一条则没有正确加载进度" |
| 2026-03-29 | Textura 训练脚本重构 | "点击启动训练后…没有正确进行训练。在先前的修改中产生的" |
| 2026-03-29 | Textura 模型加载 | "bug 仍然存在"——首次修复未解决问题 |

## 正确做法

1. **修改前列出影响范围**：明确哪些模块依赖当前修改的接口/状态
2. **Agent review 常态化**：用户已多次主动要求"开个 agent review 一下"，说明这是真实需求
3. **回归测试**：修改后主动验证相关功能，不等用户报 bug
4. **对比验证**：修改训练/连接等核心流程时，对比修改前后的 log 输出
