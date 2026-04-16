---
name: pencil-design
description: >
  Pencil MCP 特化的 AI 驱动 UI 设计技能，引导用户从模糊想法到精美的 .pen 文件设计。
  使用 Pencil MCP 工具，覆盖完整工作流：需求收敛（结构化提问明确用户真实需求）、
  设计系统对齐（风格指南、token）、自动化生成（batch_design）、视觉验证（截图）、
  迭代精修。当用户想要设计 UI、创建界面、构建页面、做原型、布局时使用此技能——
  即使用户只是说"我需要一个仪表盘"或"帮我设计登录页"。也适用于"帮我做 UI"、
  "创建 web 应用设计"、"让它好看点"，或任何提及设计页面/屏幕/布局的请求。
  如果用户描述了一个应用想法但没有明确要求设计，也考虑此技能是否能帮助他们可视化。
description_en: "AI-driven UI design skill. Guides users from vague ideas to polished .pen designs through a full Pencil MCP workflow: requirement convergence, design-system alignment, automated generation, visual verification, and iterative refinement."
---

# Design — AI 自动化 UI 设计

通过结构化需求收敛和 Pencil MCP 自动化，将模糊想法转化为精美的 UI 设计。

## 为什么需要这个技能

大多数 AI 设计工具直接从模糊 prompt 跳到输出，生成质量一般、需要反复迭代。v0 的研究表明：**详细、结构化的需求能减少 30-40% 的生成时间和 62% 的审查周期**。本技能通过前置智能提问来获取清晰需求，再利用 Pencil MCP 进行高质量自动生成。

## 工作流概览

```
用户的模糊想法
    │
    ▼
Phase 1: 需求收敛 ─── 智能提问，输出 Design Brief
    │
    ▼
Phase 2: 设计系统对齐 ── 获取设计规范 + 风格指南 + token
    │
    ▼
Phase 3: 自动化生成 ───── 分层 batch_design，截图验证
    │
    ▼
Phase 4: 迭代精修 ───── 用户反馈 → 定向修改 → 再验证
```

---

## Phase 1: 需求收敛

目标是用最少的用户交互，将模糊想法转化为结构化的 **Design Brief**。核心原则：

- **先推导再提问**：用户说"监控仪表盘"，你已经能推断出暗色主题、数据密集、桌面优先。不要问已知的事。
- **一次一个问题**：不要一次抛出 5 个问题。先问最关键的未知项，再逐步推进。
- **选项优于开放式**："偏好哪种风格？[A] 简约 [B] 企业风 [C] 活泼" 比 "你想要什么风格？" 更好。
- **最多 5 个问题**：超过 5 个用户就失去耐心。有缺口就做合理假设并注明。

### 需要提取的信息（v0 三层模型）

| 层级 | 提取内容 | 示例 |
|------|---------|------|
| **产品表面** | 页面、组件、数据、用户动作 | "侧边导航仪表盘，3 个指标卡片，折线图，告警列表" |
| **使用场景** | 谁在用、什么时候用、做什么决策 | "运维工程师排查告警，需要 < 3 秒找到根因" |
| **约束与品味** | 视觉风格、配色、平台、无障碍 | "暗色主题，shadcn 风格，桌面优先，WCAG AA" |

### 提问优先级

按以下顺序提问，已从上下文中明确的直接跳过：

1. **产品类型 & 核心页面** — "这是什么类型的应用？主要有哪些页面？"
   - 基于推导给出选项："[A] 仪表盘+详情 [B] 增删改查应用 [C] 落地页 [D] 其他"

2. **目标用户 & 场景** — "谁在什么场景下使用？"
   - 如果明显（如"管理后台"暗示内部团队）则跳过

3. **每页关键内容** — "每个页面最重要的信息是什么？"
   - 仅在用户给了页面名但没给细节时提问

4. **视觉风格** — "偏好什么视觉方向？"
   - 给 3-4 个具体选项。如有 Pencil 风格标签，展示相关选项。

5. **平台 & 约束** — "桌面优先还是移动端优先？有现有品牌/设计系统吗？"
   - 已说明或明显可推导时跳过

### Design Brief 输出格式

收敛后，整理为以下结构（供 Phase 2-3 内部使用）：

```yaml
design_brief:
  product_type: web-app | mobile-app | landing-page
  pages:
    - name: 仪表盘
      key_content: [实时指标, 告警列表, 拓扑图]
      priority: primary
    - name: 告警详情
      key_content: [指标图表, 时间线, 关联事件]
      priority: secondary
  target_user: "运维工程师排查生产告警"
  style:
    mood: dark, minimal, data-dense
    reference: "shadcn/ui 风格"
  platform: desktop-first
  constraints:
    - "必须满足 WCAG AA 对比度"
    - "使用现有品牌蓝：#2563EB"
  assumptions_made:
    - "基于监控场景假设暗色主题"
```

在继续之前，向用户展示此 Brief 并确认。这是你将要设计的契约。

### DLC 判断

Design Brief 确认后，评估是否建议启用 Generative Art DLC：

```
product_type + 场景？
    │
    ├─ 博客 / 作品集 / 个人网站 / 落地页 → 建议启用，告知用户
    │
    ├─ Web 应用（非效率关键）→ 可选，询问用户
    │
    └─ 仪表盘 / 监控 / 管理后台 → 不启用
```

如果启用，在 Phase 4 阶段读取 `dlc/generative-art/DLC.md` 获取增强配方。

---

## Phase 2: 设计系统对齐

在生成任何内容之前，先与 Pencil 的设计能力对齐。这能防止风格不一致，并充分利用现有组件。

### 执行步骤（严格顺序 — 每步依赖前一步）

**Step 1: 确保 .pen 文件已打开**

调用 `get_editor_state(include_schema=true)`。如果没有活跃文件，调用 `open_document("new")` 创建一个。你需要这一步返回的 schema 才能编写 batch_design 操作——否则你不知道有效的节点类型和属性。

**Step 2: 加载设计规范**

调用 `get_guidelines(topic)` 并匹配对应主题：

| 产品类型 | Topic |
|---------|-------|
| Web 应用 | `web-app` |
| 移动应用 | `mobile-app` |
| 落地页 | `landing-page` |
| 含设计系统的仪表盘 | `design-system` |
| 演示幻灯片 | `slides` |

复杂应用可能需要多个主题（如 `web-app` + `design-system`）。仔细阅读规范——它们包含 batch_design 中必须遵循的 .pen schema 规则。

**Step 3: 选择风格指南**

先调用 `get_style_guide_tags()` 查看所有可用标签，再调用 `get_style_guide(tags)` 传入 5-10 个匹配 Design Brief 风格的标签。这会提供配色、字体、间距和视觉方向。Step 2 和 3 可以并行执行。

**Step 4: 设置设计 token**

基于风格指南的输出，调用 `set_variables()` 在 .pen 文件中配置颜色、字体和间距。这确保所有生成元素的一致性。如果 Design Brief 指定了确切的品牌色，优先使用品牌色而非风格指南的默认值。

**Step 5: 探索现有组件**（仅在使用设计系统时）

调用 `batch_get(patterns=[{reusable: true}], readDepth=2, searchDepth=3)` 发现可复用组件。了解现有组件能避免重复造轮子。

### 如果 Pencil MCP 工具不可用

如果任何 Pencil 工具返回错误或权限拒绝，明确告知用户："Pencil MCP 工具不可访问。请确保 Pencil 编辑器正在运行并授予工具权限。"不要在没有可用的 .pen 文件和已加载 schema 的情况下进入 Phase 3。

---

## Phase 3: 自动化生成

通过分层构建来生成设计。试图在一次 `batch_design` 调用中创建整个复杂页面会导致错误和布局问题。应该渐进式构建。

### 生成策略：分层

对 Design Brief 中的每个页面：

**Layer 1 — 页面骨架**（1 次 batch_design 调用，~5-10 个操作）
- 创建正确尺寸的根 frame（桌面：1440×900，移动端：390×844）
- 添加主要布局区域：头部/导航、侧边栏、主内容区、底部
- 设置背景色和基础间距

**Layer 2 — 区域结构**（1-2 次 batch_design 调用，每次 ~10-15 个操作）
- 在每个区域内创建 section 容器
- 添加 section 标题和分隔线
- 建立网格/流式布局

**Layer 3 — 组件与内容**（2-4 次 batch_design 调用，每次 ~15-20 个操作）
- 用实际组件填充 section（卡片、图表、表格、表单）
- 添加文本内容、图标、图片
- 如有设计系统组件，使用 `{type: "ref", ref: "ComponentName"}`

**Layer 4 — 精修**（1-2 次 batch_design 调用）
- 微调间距、对齐、颜色
- 添加阴影、边框、微交互
- 确保视觉层次清晰

### 每层后的验证

完成每层后：

1. 对页面 frame 调用 `get_screenshot(nodeId)`
2. 分析截图：
   - 布局问题（元素重叠、对齐偏差）
   - 内容缺口（Design Brief 中的关键内容是否缺失）
   - 视觉一致性（颜色、间距、字体）
3. 调用 `snapshot_layout(problemsOnly=true)` 捕获裁切或溢出问题
4. 修复问题后再进入下一层

### batch_design 约束

- **每次调用最多 25 个操作** — 按逻辑分组拆分更大的批次
- **绑定名唯一** — 不要在不同操作列表间复用绑定名
- **修改前先读取** — 如果修改已有元素，先 `batch_get` 了解当前结构

### 多页面设计

对于包含多个页面的 Design Brief：
1. 使用 `find_empty_space_on_canvas(direction="right")` 为每个页面 frame 定位，留出足够间距
2. 按优先级生成页面（primary 页面优先）
3. 通过共享 variables 保持跨页面的样式一致性

---

## Phase 4: 迭代精修

生成初始设计后，向用户展示截图并进入反馈循环。

### 反馈处理

| 用户反馈类型 | 执行动作 |
|-------------|---------|
| "这个卡片太大了" | `batch_design` 用 update 操作调整指定元素尺寸 |
| "换个配色方案" | `set_variables()` 做全局 token 变更，或 `replace_all_matching_properties` 做定向颜色替换 |
| "加个搜索栏" | `batch_design` 用 insert 操作在正确位置添加 |
| "把侧边栏移到右边" | `batch_design` 用 move 操作 |
| "我不喜欢整体风格" | 用不同的风格标签重新执行 Phase 2，然后重新生成 |
| "很好！" | 如需要可通过 `export_nodes` 导出，然后完成 |

### Generative Art DLC 增强（如已启用）

如果在 Phase 1 判断启用了 Generative Art DLC，在常规精修之后执行增强。读取 `dlc/generative-art/DLC.md` 获取完整配方。

增强顺序：
1. **配方 1: 余弦调色板** → 用数学生成的独特色系替换/增强现有配色
2. **配方 2: 有机形状** → 为 hero 区域、section 分隔线添加有机装饰
3. **配方 3: 程序化纹理** → 为大面积背景添加渐变叠加纹理

每个配方执行后截图验证。装饰是增强，不是依赖——移除后基础设计必须仍然完整。

### 精修循环

```
展示截图 → 用户反馈 → 定向修改 → 重新截图 → 确认
```

保持迭代聚焦：每次 batch_design 调用解决一个反馈，截图验证，再处理下一个。避免一次修复所有问题——增量变更更容易验证和回滚。

### 何时提供导出

用户满意后，提供：
- `export_nodes(format="png")` 用于分享/审查
- `export_nodes(format="pdf")` 用于文档
- .pen 文件本身用于继续编辑

---

## 质量输出要点

- **内容真实感**：使用真实的占位文本和数据，而非"Lorem ipsum"。仪表盘应展示合理的指标值。
- **视觉层次**：最重要的内容获得最大的视觉权重（尺寸、对比度、位置）。
- **留白**：section 之间要有充足的间距。拥挤的设计显得不专业。
- **一致性**：相同间距、相同圆角、相同字号用于相似元素。这就是 Phase 2（token）的价值。
- **移动端考虑**：如果移动优先，设计 390px 宽度。触摸目标最小 44px。

## 常见模式

### 仪表盘
- 侧边导航（200-240px）
- 顶栏含搜索 + 用户菜单
- 指标卡片网格（2-4 列）
- 卡片下方的图表区域
- 数据表格或动态 feed

### 落地页
- 英雄区含标题 + CTA
- 社会证明 / logo 栏
- 功能网格（3 列）
- 用户评价
- 定价表
- 底部链接

### 增删改查应用
- 顶部导航含面包屑
- 列表/表格视图含筛选 + 搜索
- 详情面板或详情页
- 创建/编辑表单（弹窗或页面）

### 移动应用
- 底部 Tab 导航
- 卡片式内容
- 下拉刷新列表视图
- 底部弹出操作面板
- 状态栏适配（安全区域）
