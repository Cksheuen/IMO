---
name: generative-art
description: >
  Design skill 的 Generative Art DLC。为个人化场景（博客、作品集、落地页等）提供
  程序化艺术增强，对抗 AI 生成内容的同质化。基于 iquilezles.org 的数学方法，
  在 Phase 4 精修阶段注入独特的色彩、形状和纹理。
  不适用于效率优先的场景（监控仪表盘、管理后台等）。
type: dlc
parent_skill: design
---

# Generative Art DLC

为 UI 设计注入程序化艺术感，让每个设计都独一无二。

## 核心理念

AI 生成的 UI 有一个根本问题：**太干净、太统一、太可预测**。所有的 shadcn 风格仪表盘看起来都一样，所有的落地页都遵循相同的视觉公式。

Generative art 提供了"程序化但独特"的解决方案——通过数学函数产生的变化，每次都不同，但都在审美安全范围内。这不是随机，而是 **可控的不完美**。

> 参考：[iquilezles.org](https://iquilezles.org/) — Inigo Quilez 的程序化图形学经典文献

## 适用场景判断

| 场景 | 是否启用 | 理由 |
|------|---------|------|
| 博客 / 个人网站 | **是** | 个性化是核心诉求 |
| 作品集 / Portfolio | **是** | 需要独特视觉印象 |
| 落地页 / 营销页 | **是** | 品牌差异化 |
| SaaS 定价页 | **可选** | 如果追求品牌感则启用 |
| Web 应用（非效率关键） | **可选** | 装饰元素可以用 |
| 监控仪表盘 | **否** | 效率优先，装饰是干扰 |
| 管理后台 | **否** | 信息密度优先 |
| 数据分析工具 | **否** | 清晰性优先 |

## 注入时机

DLC 在 design skill 的 **Phase 4（精修阶段）** 介入，不改变基础布局流程：

```
Phase 3 完成基础设计
    │
    ▼
Phase 4 — Layer 4 精修
    │
    ├─ 常规精修（间距、对齐、阴影）
    │
    └─ Generative Art 增强（本 DLC）
         │
         ├─ 配方 1: 余弦调色板 → 独特色系
         ├─ 配方 2: 有机形状 → 装饰元素
         └─ 配方 3: 程序化纹理 → 背景增强
```

这保证了：基础结构正确 → 再增加艺术感。先骨架，后灵魂。

---

## 配方 1: 余弦调色板 (Cosine Palette)

> 参考：[iquilezles.org/articles/palettes](https://iquilezles.org/articles/palettes/)

### 原理

一条公式生成无限和谐的色彩：

```
color(t) = a + b · cos(2π · (c · t + d))
```

其中 a, b, c, d 是 RGB 三维向量。通过调整这 4 个参数，可以产生从温暖日落到冷冽极光的任何色系。每组参数产生的配色数学上保证和谐，因为它们沿余弦曲线平滑变化。

### 预置参数集

以下是经过审美验证的安全参数，按情绪分类：

```yaml
presets:
  warm-sunset:
    a: [0.5, 0.5, 0.5]
    b: [0.5, 0.5, 0.5]
    c: [1.0, 1.0, 1.0]
    d: [0.00, 0.33, 0.67]
    mood: 温暖、经典、黄金时段
    适用: 个人博客、美食、旅行

  cool-ocean:
    a: [0.5, 0.5, 0.5]
    b: [0.5, 0.5, 0.5]
    c: [1.0, 1.0, 1.0]
    d: [0.30, 0.20, 0.20]
    mood: 冷静、专业、深邃
    适用: 技术博客、作品集

  vibrant-neon:
    a: [0.5, 0.5, 0.5]
    b: [0.5, 0.5, 0.5]
    c: [1.0, 1.0, 0.5]
    d: [0.80, 0.90, 0.30]
    mood: 鲜艳、活力、赛博
    适用: 创意作品集、音乐、游戏

  muted-earth:
    a: [0.5, 0.5, 0.5]
    b: [0.3, 0.3, 0.3]
    c: [0.6, 0.6, 0.6]
    d: [0.05, 0.15, 0.25]
    mood: 柔和、自然、质朴
    适用: 手工艺、自然、文学

  pastel-dream:
    a: [0.8, 0.8, 0.8]
    b: [0.2, 0.2, 0.2]
    c: [1.0, 1.0, 1.0]
    d: [0.00, 0.10, 0.20]
    mood: 柔软、梦幻、轻盈
    适用: 生活方式、时尚、婚礼
```

### 执行步骤

1. **选择 preset** — 根据 Design Brief 的 mood 匹配最接近的预置，或基于 mood 关键词微调参数
2. **生成色值** — 在 t = 0.0, 0.15, 0.30, 0.50, 0.70, 0.85, 1.0 处采样，得到 7 个色值
3. **分配角色** — 将采样色值分配为：
   - t=0.0 → background（背景）
   - t=0.15 → surface（卡片/容器表面）
   - t=0.30 → muted（次要文本/边框）
   - t=0.50 → primary（主色调/品牌色）
   - t=0.70 → accent（强调色/CTA）
   - t=0.85 → secondary（辅助色）
   - t=1.0 → highlight（高亮/装饰）
4. **对比度检查** — 确保 text 与 background 的对比度 ≥ 4.5:1（WCAG AA）。如果不够，调暗 background 或调亮 text
5. **应用** — 调用 `set_variables()` 将色值设为 design token

### 计算方法

在 batch_design 中生成色值时，用 JavaScript 表达式：

```javascript
// 余弦调色板计算（在 Agent 侧计算，输出 hex 色值）
function cosinePalette(t, a, b, c, d) {
  const r = a[0] + b[0] * Math.cos(2 * Math.PI * (c[0] * t + d[0]));
  const g = a[1] + b[1] * Math.cos(2 * Math.PI * (c[1] * t + d[1]));
  const bl = a[2] + b[2] * Math.cos(2 * Math.PI * (c[2] * t + d[2]));
  return [
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, bl))
  ];
}

// RGB 0-1 → hex
function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
```

Agent 应在内部完成计算，然后将 hex 结果传给 `set_variables()`。

---

## 配方 2: 有机形状装饰 (Organic Shapes)

> 参考：[iquilezles.org/articles/distfunctions2d](https://iquilezles.org/articles/distfunctions2d/)，[smooth min](https://iquilezles.org/articles/smin/)

### 原理

标准 UI 全是直角矩形和圆角矩形。通过 2D SDF（Signed Distance Function）可以生成有机、不规则但数学上优美的形状，然后转化为 SVG path 插入设计中。

核心技术：
- **SDF 基础形状**：圆、椭圆、多边形、星形、心形等 50+ 原语
- **Smooth Min**：将两个形状平滑融合（gooey 效果），参数 k 控制融合厚度
- **圆角化**：对任何 SDF 减去常数 r 即得圆角版本

### 装饰类型

| 类型 | 描述 | 适用位置 |
|------|------|---------|
| **Blob** | 2-3 个圆 smooth min 融合 | Hero 背景、section 装饰 |
| **波浪分隔线** | 正弦叠加不同频率 | Section 之间 |
| **有机边框** | SDF 形状做 card 边框 | 特色卡片、CTA 区域 |
| **散点装饰** | 随机分布的小形状 | 空白区域点缀 |

### 执行步骤

1. **确定装饰需求** — 根据 Design Brief 判断哪些位置需要装饰（hero 背景、section 分隔、空白区域）
2. **选择形状类型** — 参照上表匹配
3. **生成 SVG path** — Agent 计算 SDF 轮廓点，转化为 SVG path data
4. **插入设计** — 通过 `batch_design` 插入 path 节点，设置填充色（从配方 1 的 accent/highlight 色取）
5. **调整透明度** — 装饰元素通常 opacity 0.1-0.3，不能喧宾夺主
6. **截图验证** — 确保装饰不遮挡内容、不破坏阅读流

### Blob 生成算法

```
生成 N 个控制圆（N = 2-4）：
  - 每个圆：中心坐标 (cx, cy)、半径 r
  - 圆心分布在目标区域内，间距 = r * 0.8-1.5

对目标区域采样网格（步长 2-4px）：
  对每个采样点 (x, y)：
    计算到每个圆的 SDF 距离
    用 smooth_min(k=20-40) 合并所有距离
    如果距离 ≤ 0，该点在形状内

将边界点 (距离 ≈ 0) 转化为 SVG path（贝塞尔曲线拟合）
```

### 波浪分隔线生成

```
波浪 path 生成：
  y(x) = A₁·sin(f₁·x + φ₁) + A₂·sin(f₂·x + φ₂)

推荐参数：
  A₁ = 8-15px, f₁ = 0.01-0.02, φ₁ = 随机
  A₂ = 3-6px,  f₂ = 0.03-0.05, φ₂ = 随机

采样 x 从 0 到 canvas 宽度，步长 4px
输出为 SVG path: M x0,y0 C ... (三次贝塞尔曲线)
```

---

## 配方 3: 程序化纹理背景 (Procedural Textures)

> 参考：[iquilezles.org/articles/fbm](https://iquilezles.org/articles/fbm/)，[domain warping](https://iquilezles.org/articles/warp/)，[voronoise](https://iquilezles.org/articles/voronoise/)

### 原理

用数学函数生成非重复的背景纹理，替代纯色或标准渐变。核心思想是"噪声叠加"——多个不同频率的噪声层叠加产生自然感的复杂纹理。

### 纹理类型

| 类型 | 视觉效果 | 推荐场景 | 参考 |
|------|---------|---------|------|
| **FBM 云纹** | 柔和的云/烟效果 | Hero 背景、全屏背景 | [fbm](https://iquilezles.org/articles/fbm/) |
| **Domain Warp** | 液态/大理石纹理 | 装饰面板、card 背景 | [warp](https://iquilezles.org/articles/warp/) |
| **Voronoi 细胞** | 蜂窝/裂纹图案 | 艺术装饰、section 背景 | [voronoise](https://iquilezles.org/articles/voronoise/) |
| **噪声颗粒** | 胶片颗粒质感 | 全局叠加层 | 简单随机噪声 |

### 在 Pencil 中的实现策略

由于 Pencil 是静态设计工具，纹理需要"烘焙"为可表达的元素：

**策略 A: 渐变叠加（推荐，最简单）**
- 用 2-4 层半透明渐变模拟纹理效果
- 每层用不同角度、不同色值的线性/径向渐变
- 通过 opacity 控制层间混合
- 适合 FBM 云纹和 domain warp 效果

**策略 B: SVG 图案（中等复杂度）**
- Agent 计算纹理采样点，生成散点/线条 SVG path
- 适合 Voronoi 细胞和几何图案
- 需要更多 batch_design 操作

**策略 C: 外部生成导入**
- 用脚本生成纹理图片（PNG/SVG）
- 通过 batch_design 的 image 操作导入
- 最灵活但最复杂

### 执行步骤（策略 A — 渐变叠加）

1. **确定纹理区域** — 哪些 frame 需要纹理背景（通常是 hero section、大面积空白区域）
2. **选择基色** — 从配方 1 的调色板取 background 和 surface 色
3. **创建叠加层** — 在目标 frame 内创建 2-4 个全尺寸子 frame：
   - 层 1：径向渐变，从 accent 色 (opacity 0.08) 到透明，中心偏右上
   - 层 2：线性渐变，从 secondary 色 (opacity 0.05) 到透明，角度 135°
   - 层 3：径向渐变，从 highlight 色 (opacity 0.06) 到透明，中心偏左下
   - 层 4（可选）：极小 opacity (0.02-0.03) 的噪声纹理色
4. **调整** — 截图验证，确保纹理微妙而非显眼。用户不应"看到"纹理，只应"感觉到"背景不是死板的纯色

### 参数安全范围

| 参数 | 最小 | 推荐 | 最大 | 超出后果 |
|------|------|------|------|---------|
| 渐变层数 | 2 | 3 | 4 | >4 性能下降，视觉混乱 |
| 单层 opacity | 0.02 | 0.05-0.08 | 0.15 | >0.15 太显眼 |
| 总叠加 opacity | 0.05 | 0.10-0.20 | 0.30 | >0.30 影响内容可读性 |
| 渐变半径 | 30% | 50-70% | 100% | 过小太集中，过大无效果 |

---

## 配方组合建议

不是所有配方都必须同时使用。根据 Design Brief 的需要选择组合：

| 设计类型 | 推荐配方 | 理由 |
|---------|---------|------|
| 极简博客 | 配方 1 | 独特配色就够了 |
| 创意作品集 | 配方 1 + 2 + 3 | 全套增强 |
| 产品落地页 | 配方 1 + 3 | 配色 + 背景纹理 |
| 技术博客 | 配方 1 + 2（波浪分隔线） | 微妙装饰 |
| 个人简历页 | 配方 1 + 2（blob） | 独特但克制 |

## 质量检查清单

每次使用 DLC 后验证：

- [ ] 装饰元素不遮挡正文内容
- [ ] 文本在纹理背景上仍然清晰可读（对比度 ≥ 4.5:1）
- [ ] 装饰的 opacity 在安全范围内
- [ ] 整体感觉是"微妙独特"而非"花哨凌乱"
- [ ] 移除装饰后基础设计依然完整（装饰是增强，不是依赖）

## 参考资料

核心数学参考（按需深入阅读）：

| 主题 | 链接 | 何时阅读 |
|------|------|---------|
| 余弦调色板公式 | [iquilezles.org/articles/palettes](https://iquilezles.org/articles/palettes/) | 需要自定义参数时 |
| 2D SDF 形状集 | [iquilezles.org/articles/distfunctions2d](https://iquilezles.org/articles/distfunctions2d/) | 需要更多形状类型时 |
| Smooth Min 融合 | [iquilezles.org/articles/smin](https://iquilezles.org/articles/smin/) | 需要调整融合效果时 |
| FBM 噪声详解 | [iquilezles.org/articles/fbm](https://iquilezles.org/articles/fbm/) | 需要更精细的纹理控制时 |
| Domain Warping | [iquilezles.org/articles/warp](https://iquilezles.org/articles/warp/) | 需要液态/扭曲效果时 |
| Voronoise | [iquilezles.org/articles/voronoise](https://iquilezles.org/articles/voronoise/) | 需要细胞/蜂窝纹理时 |
| Smoothstep 变体 | [iquilezles.org/articles/smoothsteps](https://iquilezles.org/articles/smoothsteps/) | 需要更平滑的过渡曲线时 |
