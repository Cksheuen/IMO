# Lavish 画板逻辑适配

源码核对：https://github.com/kunchenguid/lavish-axi/tree/ca4c59d5b3ef84ae7f6f7f93fcaa415ade8a9c73 。本次重新核对该固定提交，没有将未找到的旧调研记录作为已验证依据。

- `src/whiteboard-core.js` 的标签换行归一化直接适配进 `project/src/lib/logicGraph.ts`，补充中文宽度估算与自动换行；节点尺寸容纳全部文字。
- `src/whiteboard-frame.css` 的固定 frame 和 `whiteboard-frame.js` 的首次 fit、字体就绪后测量机制用于现有 CanvasViewport；缩放只作用 world，边界不随内容变化。
- 评审图以 JSON 节点/边为唯一来源，解释复用 HoverPopover；保留原有评论定位、单文件 HTML、页面原生滚动与 scoped detail。
- 未整体引入 Lavish 的 Excalidraw + Mermaid 转换、iframe postMessage、服务端场景存储和图形编辑器。它们组成独立编辑链，不能直接代替当前 review JSON 与评论协议。当前提供结构化关系图展示与导航，不宣称已支持 Mermaid 导入或自由手绘编辑。

来源许可与版权保留在 [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)，生成 HTML 同样携带许可说明。后续若扩展自由编辑，应另定义图形修改到 review JSON 的回写与冲突处理，不能让截图或浏览器内部场景成为另一份事实源。
