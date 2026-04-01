# 终端图片移动通知动画技术方案

> 设计时间：2026-04-01
> 状态：design
> 关联调研：[terminal-floating-image.md](../research/terminal-floating-image.md)

## 1. 目标与边界

### 1.1 目标

当图片从一个终端移动到另一个终端时，为接收端提供清晰的到达提示。

### 1.2 非目标

- 不在 Phase 1 承诺所有终端都支持同等级飞行动画。
- 不把终端私有图像协议误写成统一的跨窗口定位协议。
- 不修改终端源码。

### 1.3 收敛后的实现边界

- **飞行动画**：统一由 OS 级 overlay 实现。
- **终端内图片显示**：按终端能力分别接入。
- **落地反馈**：按终端能力分别降级。
- **Phase 1 范围**：Kitty-first；WezTerm、iTerm2、foot 只定义降级路径。

## 2. 为什么要改边界

之前的设计把 Kitty、iTerm2、WezTerm、Alacritty、foot 全部写成“跨终端兼容”，但实际核验后只有 Kitty 同时具备足够清晰的终端内图片摆放能力和窗口级颜色控制能力。WezTerm、iTerm2、foot 都能承担部分能力，但当前证据不足以支撑“跨窗口飞行动画已可等价落地”。

因此，本设计改为两层模型：

1. **OS 级 overlay** 负责飞行。
2. **终端协议** 只负责落地显示与注意力反馈。

## 3. 架构

```text
Move Request
  -> Window Locator
  -> Overlay Animator
  -> Terminal Renderer
  -> Attention Feedback
```

### 3.1 Window Locator

职责：

- 获取 source / target 对应的 OS window
- 解析屏幕像素坐标
- 维护终端类型与窗口 ID 的映射

实现原则：

- Kitty 可优先通过 `kitten @ ls` 拿到窗口树，再结合平台能力补足屏幕坐标。
- WezTerm 不再假设 `wezterm cli list` 足以提供屏幕像素坐标。
- iTerm2 / foot 走平台级窗口探测。
- Wayland 下全局窗口坐标通常依赖 compositor 特定能力，不能默认视为通用前提。

### 3.2 Overlay Animator

职责：

- 创建系统级透明 overlay
- 从 source 坐标飞到 target 坐标
- 处理淡入、缩放、淡出

平台分层：

- macOS：`NSWindow` / `NSPanel`
- Linux/X11：override-redirect overlay
- Linux/Wayland：layer-shell overlay

注意：

- overlay 是跨终端统一层，不与某个终端协议耦合。
- 如果 overlay 不可用，系统退化为“无飞行，仅落地反馈”。

### 3.3 Terminal Renderer

职责：

- 在目标终端落地显示图片或标记
- 不负责跨窗口飞行动画

终端策略：

| 终端 | 落地显示策略 |
|------|--------------|
| Kitty | Kitty Graphics Protocol |
| WezTerm | `wezterm imgcat` / iTerm image protocol |
| iTerm2 | Inline Images Protocol |
| foot | sixel |

### 3.4 Attention Feedback

职责：

- 在图片落地后给目标终端一个“到了”的反馈

终端策略：

| 终端 | 反馈策略 |
|------|----------|
| Kitty | `kitten @ set-colors` 临时高亮 |
| iTerm2 | `OSC 1337 ; RequestAttention=once` |
| WezTerm | bell 或外部通知，后续再评估更强能力 |
| foot | `OSC 555` flash 或通知 |

## 4. 能力接口

```typescript
type TerminalType = 'kitty' | 'wezterm' | 'iterm2' | 'foot' | 'unknown';

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LocatedWindow {
  id: string;
  terminal: TerminalType;
  bounds: WindowBounds;
  focused: boolean;
}

interface WindowLocator {
  listWindows(): Promise<LocatedWindow[]>;
  getWindow(id: string): Promise<LocatedWindow | null>;
}

interface OverlayAnimator {
  animate(params: {
    start: WindowBounds;
    end: WindowBounds;
    imagePath: string;
    durationMs: number;
  }): Promise<void>;
}

interface TerminalRenderer {
  render(params: {
    terminal: TerminalType;
    windowId: string;
    imagePath: string;
  }): Promise<void>;
}

interface AttentionFeedback {
  notify(params: {
    terminal: TerminalType;
    windowId: string;
  }): Promise<void>;
}
```

## 5. 执行时序

```text
1. 用户触发 move-image
2. Window Locator 解析 source / target
3. 如果 overlay 可用，则执行飞行动画
4. Terminal Renderer 在 target 落地图像
5. Attention Feedback 触发高亮 / flash / attention
6. 清理 overlay 与临时状态
```

## 6. 降级策略

### 6.1 按能力降级

```text
overlay 可用?
  yes -> 飞行动画 + 落地图像 + 反馈
  no  -> 直接落地图像 + 反馈

目标终端能显示图片?
  yes -> 显示图片
  no  -> 仅反馈（flash / attention / bell）

目标终端能提供强反馈?
  yes -> 高亮/attention
  no  -> bell 或外部通知
```

### 6.2 失败恢复

- `WINDOW_NOT_FOUND`：跳过动画，只记录失败。
- `OVERLAY_UNAVAILABLE`：直接走落地反馈路径。
- `RENDER_NOT_SUPPORTED`：不显示图片，只做 attention。
- `ATTENTION_NOT_SUPPORTED`：退化为 bell 或外部通知。

## 7. Phase 划分

### Phase 1

- Kitty window discovery
- macOS overlay
- Kitty render
- Kitty border highlight

### Phase 2

- iTerm2 render
- iTerm2 `RequestAttention`
- WezTerm render

### Phase 3

- Linux/X11 overlay
- foot sixel render
- foot `OSC 555`

### Phase 4

- Wayland overlay
- 更细粒度能力探测
- 配置系统与观测日志

## 8. 测试矩阵

| 平台 | 终端 | 飞行动画 | 落地图像 | 注意力反馈 |
|------|------|----------|----------|------------|
| macOS | Kitty | yes | yes | yes |
| macOS | iTerm2 | planned | yes | yes |
| macOS | WezTerm | planned | yes | fallback |
| Linux/X11 | Kitty | yes | yes | yes |
| Linux/X11 | WezTerm | planned | yes | fallback |
| Linux/Wayland | foot | compositor-dependent | yes | yes |

说明：

- `yes` 表示当前设计中已有较明确的能力证据；`planned` 表示方向成立但仍需补齐窗口定位或平台接入验证；`compositor-dependent` 表示依赖具体 Wayland compositor 能力。
- 当前已核验最完整的终端仍然是 Kitty；其余终端应继续以能力补齐为准，不得在后续文档中写成“已完全支持”。

## 9. 文档约束

后续更新本设计时，必须遵守以下约束：

1. 已核验能力和推测能力分开写。
2. “终端能显示图片”不等于“终端能支撑跨窗口飞行动画”。
3. 未拿到屏幕像素坐标证据前，不得把某终端写成可直接驱动 overlay 起终点。
4. 跨终端统一性来自 overlay 抽象，不来自终端图像协议本身。

## 10. 参考

- [terminal-floating-image.md](../research/terminal-floating-image.md)
