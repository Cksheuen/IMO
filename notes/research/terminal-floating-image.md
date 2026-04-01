# 终端浮动图片与跨窗口动画调研

> 调研时间：2026-04-01
> 调研场景：终端内图片渲染、跨终端图片移动提示
> 新鲜度：active

## 调研问题

1. 哪些终端原生支持图片渲染？
2. 哪些能力可以直接用于“跨窗口图片移动”动画？
3. 哪些能力只能作为落地反馈，而不能支撑飞行动画？

## 仓库内上下文

- 现有设计 note 目标是“图片从一个终端移动到另一个终端时，为接收端提供超出终端范围的动画效果”。
- 当前仓库规则要求 research note 避免同主题平行分叉，优先归并已有 note。
- 之前同主题出现了两份重复 research note，因此本次统一收敛到本文件。

## 核心结论

| 需求 | 收敛结论 |
|------|----------|
| 终端内图片渲染 | Kitty、WezTerm、iTerm2、foot 都有各自可用能力，但协议并不统一 |
| 终端内 absolute 定位 | 只有 Kitty Graphics Protocol 明确提供 `x`/`y`、`c`/`r`、`z` 和 `C=1` 这组可用于稳定摆放的能力 |
| 跨窗口飞行动画 | 不应依赖终端私有图像协议本身；应依赖 OS 级 overlay |
| MVP 实现范围 | Phase 1 只做 Kitty-first；其他终端先做“落地反馈”级降级，而不是承诺完整飞行动画 |

## 官方能力核验

### 1. Kitty

- Kitty Graphics Protocol 明确支持使用 `c`/`r` 指定行列占位，使用 `z` 指定 z-index，负值表示绘制在文字下方。
- 协议支持 `C=1`，可在放置图片时不移动光标。
- Kitty remote control 文档提供 `kitten @ ls` 列窗口树，提供 `kitten @ set-colors` 修改窗口颜色。

**结论**：Kitty 同时具备“终端内图片摆放”和“窗口级视觉反馈”两类能力，是 Phase 1 最稳妥的目标终端。

### 2. WezTerm

- WezTerm 官方特性页明确列出对 Kitty graphics、iTerm2 image protocol、Sixel 的支持。
- WezTerm 也提供 `wezterm imgcat` 和 iTerm image protocol 支持。
- 但 `wezterm cli list` 返回的是 `window_id`、`tab_id`、`pane_id`、`SIZE`、`TITLE`、`CWD`，其中 `SIZE` 仅是终端单元格尺寸，不是屏幕像素坐标。

**结论**：WezTerm 适合作为“图片可显示”的目标终端，但现有 CLI 证据不足以支撑跨窗口飞行动画的像素级定位，不应在设计中写成已具备完整定位能力。

### 3. iTerm2

- iTerm2 官方文档明确支持 Inline Images Protocol，可通过 `OSC 1337 ; File=...` 显示图片。
- iTerm2 官方文档明确支持 `OSC 1337 ; RequestAttention=[value]` 请求用户注意。

**结论**：iTerm2 适合承担“终端内显示图片 + 请求注意力”的降级路径，但文档证据不足以说明其具备跨窗口飞行动画所需的屏幕级定位接口。

### 4. foot

- `foot.ini(5)` 说明 foot 在启用时会处理 sixel 图片。
- `foot-ctlseqs(7)` 说明 foot 支持 `OSC 555`，用于 flash 整个 terminal；也支持 `OSC 99` 与 `OSC 777` 的通知相关能力。

**结论**：foot 可以承担“终端内图片 + 整体闪烁/通知”的弱反馈路径，但目前没有足够证据表明它能承担跨窗口飞行动画。

## 能力矩阵

| 终端 | 图片协议 | 终端内可控摆放 | 窗口/终端反馈 | 适合作为飞行动画目标 |
|------|----------|----------------|---------------|----------------------|
| Kitty | Kitty Graphics | 强，官方明确支持 `x/y/c/r/z/C=1` | 强，`kitten @ set-colors` | 是，Phase 1 主路径 |
| WezTerm | Kitty / iTerm2 / Sixel | 中，能显示图，但当前核验未拿到屏幕像素坐标接口 | 中，可做弱反馈 | 否，先降级 |
| iTerm2 | Inline Images | 中，能显示图，但当前核验未拿到跨窗口定位接口 | 中，`RequestAttention` | 否，先降级 |
| foot | Sixel | 弱，重在终端内显示 | 中，`OSC 555`/通知 | 否，先降级 |

## 方案对比

### 方案 A：完全依赖终端协议实现飞行动画

优点：

- 不需要额外 overlay 进程。

缺点：

- 各终端协议差异太大。
- 当前只有 Kitty 的定位能力足够明确。
- 跨窗口、跨终端时很难获得统一的屏幕坐标模型。

### 方案 B：OS 级 overlay 负责飞行动画，终端协议只负责落地显示和反馈

优点：

- 飞行动画逻辑与终端协议解耦。
- 可以把终端差异收敛为“能否显示图”“能否闪烁/提醒”两类能力。
- 设计边界更真实，文档不需要假装所有终端都能做同级别效果。

缺点：

- 需要平台适配层。
- 需要窗口发现与屏幕坐标映射。

## 收敛决策

1. **MVP 只承诺 Kitty-first**。
2. **飞行动画统一走 OS 级 overlay**，不把 WezTerm / iTerm2 / foot 写成已具备等价能力。
3. **非 Kitty 终端先实现落地反馈**：
   - iTerm2：Inline image + `RequestAttention`
   - WezTerm：inline image / imgcat，必要时退化为 bell 或外部通知
   - foot：sixel + `OSC 555` 或通知
4. **设计文档必须把“已验证能力”和“推测可行能力”分开写**。

## 参考源演进判断

- 参考源：Kitty、WezTerm、iTerm2、foot 官方文档
- 当前主路径：Kitty 仍在强化 graphics protocol 与 remote control；WezTerm 明确同时支持多种图像协议；iTerm2 继续维护 1337 系列私有序列；foot 继续维护 sixel 与自有控制序列
- 旧路径是否仍推荐：不是“旧路径被废弃”的问题，而是不同终端各自扩展并存，没有统一主标准
- 对本次方案的影响：不应把“跨终端图片动画”写成一个统一协议问题；应该拆成 OS 级动画 + 终端级显示/提醒两个层次

## 参考

- Kitty Graphics Protocol: https://sw.kovidgoyal.net/kitty/graphics-protocol/
- Kitty Remote Control: https://sw.kovidgoyal.net/kitty/remote-control/
- WezTerm Features: https://wezterm.org/features.html
- WezTerm CLI list: https://wezterm.org/cli/cli/list.html
- WezTerm imgcat / image support: https://wezterm.org/imgcat.html
- iTerm2 Inline Images: https://iterm2.com/3.4/documentation-images.html
- iTerm2 Proprietary Escape Codes: https://iterm2.com/documentation-escape-codes.html
- foot.ini(5): https://man.archlinux.org/man/foot.ini.5.en
- foot-ctlseqs(7): https://man.archlinux.org/man/extra/foot/foot-ctlseqs.7.en
