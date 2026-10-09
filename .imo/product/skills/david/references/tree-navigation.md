# 评审树与页面导航

## 评审树模型

- **根 = overview**：`overview.mapping[]` 是整页级三联动行；缺省时由 `resolveOverview` 聚合**每个 component 的全部 mapping 行**，行 id 加作用域前缀 `` `${component.id}:${row.id}` ``（重复时追加 `#n` 后缀；纯函数，不改输入）。
- **递归 children**：`components[].children[]` 为 `ReviewNode`，嵌套深度 ≤ 8，node id 全局唯一。
- **interaction**：`highlight | drilldown | auto`（缺省 `auto`）。**auto 保留上下文**：默认 `highlight`，节点留在所在预览内（保守缩放，不放大、不裁切）；`drilldown` 只能由作者显式指定，且要求子树自包含、复杂度足以带来真实可读性/信息增益——children 数量本身不构成 drilldown 理由（`resolveInteraction`）。附近上下文很小或强耦合时（筛选器与视频列表/卡片等）优先 highlight。
  - **根 component**：点击先 FLIP 打开 dock（居中阅读排版，不是整页接管、不仅角落）；app 通过 `data-component-id="<id>"` 定位根元素。dock 只克隆该根节点（drilldown 时替换为子树），不携带外层祖先——每个可独立复制的 component 根与显式 drilldown 根必须**样式自足**：优先唯一类名前缀隔离，字体/色彩等基础样式承载在根上，不依赖不会随 clone 保留的外层祖先选择器（如 `.eqr2 .ql`）。
  - **highlight（auto 默认）**：点击高亮锚点，并把 dock 内 mapping 表过滤为该节点相关行（`resolveNodeMapping`：自带 `mapping` → `mappingIds` 过滤根行 → 否则根全部行），细节同时展示 `deepDive`（`summary[] / codePaths[] / logic[] / state[] / edgeCases[] / tests[]`，全部字符串数组）；预览保留所在容器与附近上下文，逻辑过滤与面包屑仍可用。
  - **drilldown（显式）**：仅作者显式指定的自包含复杂子树；在 dock 内点击后**替换/放大 dock 内容**为该子树视图；面包屑 = 根到当前节点路径（`buildBreadcrumb`），Escape 逐级返回、根级再按收起 inspector。
- **overview 常驻**：进入任何 component / 节点详情时 overview 不卸载，仅隐藏并置 inert；返回时 crossfade 与离场场景/FLIP **同时开始**，禁止 mount-after-delay。仅在必要时于 paint 前测量；不得引入多余 `flushSync` 或人为顺序空白延迟。
- **居中阅读排版**：所有层级（overview、inspector、各级 dock 预览）构图/预览居中；prose 左对齐；短内容居中，高内容顶部可达且可滚动；进入节点不带陈旧滚动偏移；评论导航仍恢复目标位置。
- **节点锚点（硬规则）**：根 component 元素必须携带 `data-component-id="<id>"`；每个递归 child 必须在 `pageHtml` 中存在 `data-review-node-id="<target||id>"` 锚点，否则 render 校验失败（校验只强制递归节点的 `data-review-node-id`，不校验根的该属性）。
- **节点 mapping**：`node.mapping`（自带行）与 `node.mappingIds`（引用根 component 的 mapping 行）互斥；`mappingIds` 必须命中根 mapping。解析顺序见 `resolveNodeMapping`。

## 多页面与画板交互（对应 HARD-GATE 29）

`pages[]` 定义可导航页面集合（页面根建议挂 `data-page-id="<page.id>"` 作页面级锚点；无 pages 时单页 `default` 保持旧行为）。详情形态由 `resolveDetailKind`（`project/src/lib/pageInteraction.ts`）纯函数解析：

- 显式 `interaction=drilldown / highlight` 保持原语义（权威优先）；`auto` 缺省仍解析为 highlight（旧行为不变）。
- 复杂节点（声明 `canvas:true`，或开 `magnifyOnComplex` 且子树深度达标）→ **canvas 等比放大 / 深层画板**；普通节点 → 高亮锚点（保守缩放、不裁切预览）。
- 逻辑图节点（canvas 页内的图中节点）hover 显示浮层（overlay），复杂节点点击进入深层画板。

**状态机与导航**（纯函数基准在 `pageInteraction.ts`）：

- 当前页保持主体上位；跨页入口为单行横向滚动列表，按钮不压缩、标题不换行，保留已访问 / 相邻页状态；键盘翻页和 resize 后当前项在条内可见，不滚动正文。hover 翻页按钮的 `next/prev` 无 wrap、边界 disabled，与 overview 的 prev/next 语义一致。
- 详情进入把当前态压入 history 栈（`enterDetail`），`Escape` / 返回沿栈回退一层（`leaveDetail` / `back`），root 无详情时 `Escape` 为 no-op。
- 键盘：`ArrowRight`=下一页，`ArrowLeft`=上一页（边界 no-op），`Escape`=返回。
- 每个状态上屏前经 `validatePageViewState` 校验（pageIndex 越界 / detail ref 空 / kind 非法 / depth<1 一律拒绝）。
- 向后兼容：单页 spec、无 `canvas` / `source` / `collaboration` 的旧 spec 走旧路径，不新增必填字段。

`pages[].kind`（`screen` 缺省 / `canvas`）、`ReviewNode.canvas`、`pages[].interactions[]` 触点 JSON（`navigate` / `detail` / `highlight` / `show` / `hide` / `toggle` / `close` 的目标必填规则）与逻辑画板 `graph` 声明见 [review-schema.md](review-schema.md)「多页面与画板交互」「页面交互与逻辑图」。

### 页内 overlay 弹层（sheet / 分享面板 / 全屏等）

预览中**作者 inline `<script>` 不会执行**（pageHtml 经 `dangerouslySetInnerHTML` 注入），且 frame 对落在 `[data-component-id]` 内的点击统一 `preventDefault`——因此作者不能靠自定义 JS 或 CSS `:checked` label hack 做弹层交互（label 的默认勾选会被 frame 吞掉）。需要页内点击弹出/关闭的浮层，用**声明式 overlay 触点**，david 负责切换 class，作者零 JS：

- 触点：任意元素加 `data-review-overlay="<id>"`（可挂在带 `data-component-id` / `data-review-node-id` 的元素上，david 在 component 兜底拦截之前优先放行 overlay 触点）。
- 目标弹层：对应元素加 `data-review-overlay-id="<id>"`，david 点击触点时 toggle 该元素的 `is-overlay-show` class；同一时刻只保留一个 overlay 打开。
- 关闭：遮罩/关闭按钮本身可挂 `data-review-overlay-close`，或继续挂 `data-review-overlay="<id>"` 再点一次关闭；也可在 `pages[].interactions[]` 声明 `action:"close"`。跨页、替换 dock 与 Escape 会由 React 自动清理当前 overlay，避免打开后无法回退。
- 遮罩层自身可挂 `data-review-overlay-backdrop`，点击遮罩关闭当前 overlay；弹窗内容不要嵌在该遮罩元素内，或改用显式 `data-review-overlay-close`，避免内容点击误关闭。
- 外观：弹层的定位、显隐动画、遮罩全部由作者 CSS 控制——只写 `[data-review-overlay-id="x"]{ 默认隐藏 }` 与 `[data-review-overlay-id="x"].is-overlay-show{ 显示态 }` 两条规则即可。
- 复杂交互只在 JSON 声明意图：`show / hide / toggle / close` 搭配 `targetElementId`，agent 不在 `pageHtml` 内编写 JS；React 维护状态并把 `is-overlay-show` 应用到 page 与 dock 中对应元素。
- `trigger:"keyboard"` 在可聚焦触点上响应 Enter/Space；`trigger:"hover"` 推荐只声明 `show/hide`，离开 page/dock 时自动回退关闭，避免悬浮层卡住。
- 跨整页切换（不是页内浮层）仍走 `data-review-page` 跨页机制（见上）；overlay 用于「不离开当前页」的 sheet/popover/fullscreen-overlay。

## 原生行为与画板交互边界

- 普通 component 根点击进入详情；5px 以内保持点击，超过阈值才平移并取消本次点击。GraphOverlay 与页面内容处于同一 stage/world。
- 声明式 detail/highlight 保留原生 checkbox、summary、link、form 的默认动作和冒泡；原生键盘激活使用浏览器生成的 click。默认动作完成后再建立或切换 dock 克隆。
- 原生 input/select/details 状态以常驻 source DOM 为准，dock 的编辑同步回 source；返回或跨组件切换不丢失。显式 drilldown 的 details 根仍仅在克隆中自动展开，source 保持原状态。
- 框选以当前 surface 的实时原点、user transform、outer/inner scale 与原生滚动量反算；FLIP 使用视觉矩形，dock 布局使用自然尺寸。
