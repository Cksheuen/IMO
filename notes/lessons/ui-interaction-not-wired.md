# Lesson: UI 交互元素未正确连线

- Status: candidate-rule
- First Seen: 2026-03-28
- Last Verified: 2026-03-30
- Trigger: 实现 UI 功能后，按钮无法点击、滚动失效、状态未同步

## 现象

实现 UI 功能后，交互元素频繁出现"看起来在但用不了"的问题：按钮 disabled 但不该 disabled、页面溢出无法滚动、点击无响应。

## 根因

1. **只实现了视觉层，忽略了事件/状态连线**：添加 UI 组件时只关注渲染，未验证事件处理器是否绑定
2. **条件守卫过严**：按钮的 enabled 条件依赖多个状态，新增功能后条件未同步更新
3. **缺乏交互验证**：实现后未模拟真实用户操作流程

## Source Cases

| 时间 | 案例 | 问题 |
|------|------|------|
| 2026-03-29 | Textura training optimization 按钮 | disabled 状态未正确计算，用户反馈"单纯的 disable 无法点击" |
| 2026-03-29 | Textura 模型推理页面滚动 | 超出页面部分无法 scroll |
| 2026-03-29 | Textura evaluate 按钮 | 模型评估按钮无法点击 |

## 正确做法

### 实现 UI 功能后的验证清单

1. **事件绑定检查**：每个可交互元素是否有对应的 click/change handler
2. **状态条件审查**：enabled/disabled 条件是否涵盖新增状态
3. **溢出处理**：内容可能超出容器时是否配置了 scroll
4. **模拟操作**：从用户视角走一遍完整交互流程

## Promotion Criteria

- 后续 3 个 UI 功能实现都一次通过交互验证（无"按钮无法点击"类反馈）
