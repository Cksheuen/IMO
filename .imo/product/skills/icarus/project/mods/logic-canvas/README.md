# logic-canvas

logic-canvas migrated from current David source

- 源码：`src/`；运行包：`dist/index.mjs`。
- 构建：在 Icarus workspace 执行 `npm run build -- logic-canvas`。
- 独立 ZIP：`npm run mod -- pack mods/logic-canvas --out /absolute/logic-canvas.zip`。
- 输入与插槽：[David 模块契约](../../../references/david-mods.md)。
- 原始文件归属：[来源清单](../../packages/david-source/source-manifest.json)。

源码开发依赖 workspace 中的共享原语；发布包只需 mod.json 声明的运行时依赖。请用 Icarus pack/release，避免将开发 package.json 直接作为 npm 发布包。

公开源码入口：`src/public.ts`，包含原 LogicCanvas、图校验与 `graphReadingOrder`。独立插槽支持 `nodeBadges: {nodeId: "标签"}`；标签绝对定位，文字在节点中央独立排版。复合消费者声明 `icarusBuild.composes: ["logic-canvas"]`。

`foldable: true` 在独立 HTML 插槽启用收缩按钮；源码消费者可通过公开入口使用 `FoldableLogicCanvas`。收缩后通过 Portal 在页面视口左上角 fixed 展示，只绘制当前选中节点及它们之间的边，重新适配可视区域，不占正文排版高度；再次点击恢复完整图。收展使用等比 FLIP，遵循减少动态效果设置。浮层不受正文滚动或容器裁切影响；`compactAvoid` 由宿主提供需避让按钮的矩形，画板选中 ID 由调用方维护。宿主可通过 `active` 隐藏已失效上下文的浮层。
