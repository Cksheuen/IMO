# 页面、交互与 scene

## 多页面与画板交互（HARD-GATE 29）

- `pages[].kind`：`screen`（缺省）或 `canvas`（逻辑图画板页）。
- `ReviewNode.canvas`：布尔；复杂节点进入等比放大 / 深层画板。
- 详情形态解析与页面/详情两级状态机见 `project/src/lib/pageInteraction.ts`：`resolveDetailKind`（显式 drilldown/highlight 权威优先，`auto` 缺省 highlight，canvas 仅在声明或复杂度达标时）、`enterDetail / leaveDetail / back`（history 栈返回）、`nextPage / prevPage`（无 wrap、边界 disabled）、`pageTransition`（ArrowLeft/Right 翻页、Escape 返回）、`validatePageViewState`（pageIndex / detail.kind / ref / depth 数据校验）。
- 页面根元素建议挂 `data-page-id="<page.id>"`（页面级锚点；评论按 pageId 过滤已使用此语义）。
- 向后兼容：单页 spec（无 pages）等价 `[{ id: "default", label: "页面" }]`；旧节点无 `canvas` 时行为不变。

## 页面交互与逻辑图

页面可声明触点关系，HTML 触点通过 `data-review-interaction-source` 绑定：

```json
{
  "id": "list",
  "label": "列表页",
  "interactions": [
    {
      "source": "product-item",
      "trigger": "click",
      "action": "navigate",
      "targetPageId": "detail"
    }
  ]
}
```

`navigate` 必须有 `targetPageId`；`detail` / `highlight` 必须有 `targetNodeId`；`show` / `hide` / `toggle` 必须有 `targetElementId`；`close` 可省略目标并关闭当前 overlay。目标页不存在时 `parseReviewSpec` 拒绝该 spec。overlay 目标 HTML 使用 `data-review-element-id`（也兼容 `data-review-overlay-id`、`data-scene-id` 或稳定 `id`），触点使用 `data-scene-id` 或 `data-review-interaction-source`。

弹窗 / sheet 的推荐写法：

```json
{
  "source": "open-sheet",
  "trigger": "click",
  "action": "show",
  "targetElementId": "share-sheet"
}
```

关闭按钮可声明 `{ "source": "close-sheet", "trigger": "click", "action": "close" }`，或直接在 HTML 上使用 `data-review-overlay-close`。React 负责状态和回退，agent 只需提供锚点及 CSS 显隐态。

遮罩层可以在自身元素上添加 `data-review-overlay-backdrop`，点击遮罩会关闭当前 overlay；弹窗内容应作为遮罩的同级元素，或使用 `data-review-overlay-close` 明确标记关闭按钮，避免点击内容区域误触关闭。

`trigger: "keyboard"` 在可聚焦触点上响应 Enter/Space；`trigger: "hover"` 推荐只使用 `show/hide`，鼠标离开 page 或 dock 时 React 自动清理 hover overlay，避免悬浮弹层残留。

逻辑画板可声明 `graph.nodes` 与 `graph.edges`。节点状态使用 `context / changed / result`，边类型使用 `data / control / dependency`；边必须引用已声明节点。运行时会把 graph 渲染为可点击 SVG 画板，节点点击进入对应 canvas 详情。

## 画板语义层（scene）

`pages[].scene` 是画板 HTML 的结构化语义补充，和 `pageHtml` 并存。`scene.components[]` 的 `id` 应与 HTML 元素的 `data-scene-id` 对应；`componentId` 可连接 `review.components[]` 根组件，运行时会补齐 `data-component-id`；`mappingIds` 连接 TRD 行，`nodeId` 连接评审树节点，`source` 记录真实 React 组件来源，`props/state` 标记本次预览使用的输入和状态。页面交互的 `interactions[].source` 可直接引用 `data-scene-id`，运行时由 React 统一执行；旧页面仍可使用 `data-review-interaction-source`。

## 技术点的临时预览

TechPoint 可选 preview: { overlayId: string }，引用 pageHtml 已有的 data-review-overlay-id。overlayId 必须非空且不超过 120 字符，未知 preview 字段被拒绝。选择技术条目会打开该条目的详情与临时预览，详情关闭后恢复前一状态；未声明 preview 的旧技术点保持普通详情行为。


## 当前页概览

`pages[].overview` 可填写 `title` / `summary` 字符串，用一两句话说明该页工程落点。概览按本页 HTML 的 `data-component-id` 或 `scene.components[].componentId` 选择组件；全局说明不混入其他页，正文与来源仍保留在组件 mapping。单页旧格式保持兼容。
