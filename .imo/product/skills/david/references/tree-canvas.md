# 画板与选区

## 真实画板：平移 / 缩放 / 节点导航（对应 HARD-GATE 31）

评审预览（overview 画板与组件 dock 预览）是**可平移、可缩放的真实画板**，不是静态截图容器：

- **预览类型**：`kind: screen` 的原生手机页面与 UI 组件保留 wheel / touch 正常滚动和原生控件行为，不显示画布缩放工具。逻辑 canvas、显式 `canvas: true` 节点和补充逻辑板继续使用画板手势。
- **UI 外观**：原生 UI 预览的宿主透明，无额外底板、边框、阴影、纹理或上一页残影；组件自己的视觉样式与排版容器保留。逻辑 canvas / graph 仍使用画板表面。
- **手势**：逻辑画板内 wheel = 以光标位置为锚点缩放（scale 钳制 0.25–3）；左键拖拽空白或 Space+拖拽平移；指针按下到位移 ≤5px 视为点击（既有节点/组件/overlay 点击语义不变），>5px 进入平移且本次 click 必须被捕获抑制，绝不允许拖拽误触发节点跳转/下钻。Space+拖拽在 button/a/summary/input/contenteditable 等交互目标上不武装。
- **控件**：每个画板表面提供 −/当前缩放比/＋、适应内容（overview）、重置 100%；逻辑详情图与 dock 的控件放在画板右侧的独立纵列，不额外占用下方高度；控件类名前缀 `dv-canvas-`，pill 容器 pointer-events 透传，不拦截下层普通点击。
- **两个表面独立变换**：overview（`.dv-canvas-stage > .dv-canvas-world > .dv-canvas-host`，React 控制 transform）与 dock 预览各自持有独立 transform；dock 的用户变换复合在命令式 clone 上。dock DOM 契约不变：transform/fullpage 模型 clone 是 `.component-dock` 直接子节点；viewport/canvas 模型直接子节点是 `.component-dock-scroll-content`、clone 在其内。
- **重置策略**：跨页重置 overview transform；进入详情/切换组件/下钻节点重置 dock transform；返回 overview 时恢复 overview 自身 transform（控制器不卸载）。
- **让位框选**：整页外观框选激活时 body 带 `david-gc-mode`，画板一切手势（含非 passive wheel）停用，事件交给框选层。
- **纯函数契约**：坐标变换在 `project/src/lib/canvasGeometry.ts`（screenToCanvasPoint/canvasToScreenPoint/clampScale/zoomAtPoint/fitTransform 与 dock 多层复合），手势在 `project/src/hooks/useCanvasTransform.ts`；`CanvasTransformContext` 在 App 注入当前 surface transform，供外观框选反算 canvasPoint（null 时省略）。
- FLIP 动画、overview 常驻 inert、居中阅读排版、page stack、overlay（data-review-overlay*）、reduced-motion 即时变换均不得回退。

## 框选评论的深度位置上下文（对应 HARD-GATE 33）

外观框选评论在 v1 浅层字段（surface/rect/targets/scene/detail）之外，可选携带 `context` 深度现场对象（`scope.selection.context`），让 agent 不回看页面也能读全框选位置：

- `anchorChain`：命中元素向上 ≤8 层收集的最近 `data-component-id` / `data-review-node-id` / `data-review-target`，以及链路 `data-api-field`（空格拆分、去重、≤16 项）并集。
- `textSnippet`：命中元素文本压缩空白后 ≤120 字符；`heading`：最近 h1-h6 / `<summary>` / `[summary]` / `data-review-label` / `aria-label`，≤160 字符。
- `mapping`：落在三列 TRD 区域时的行标识（rich-detail 的 `data-david-row-id` → `data-trd-row` → `data-mapping-id`）与列（requirement/change/api；行内无列标记兜底为 `trd` 整行，不编造列名）。
- `scene`：phase/pageId/componentId/nodeId 与富详情是否打开（`detailOpen`）；`canvasPoint`：仅当框选中心落在画板 stage 内时经 CanvasTransform 反算的逻辑坐标，否则省略；`domPath`：tag+类名链 ≤5 层、≤200 字符。
- `context` 为 v1 可选扩展，旧数据无此字段照常解析；严格 schema 校验（未知字段拒绝、长度上限、有限数坐标且 |x/y|≤1e9、枚举合法），非法输入 422；取不到的字段一律省略，禁止编造锚点或坐标。反馈面板把 context 渲染为可读 chips，agent 读评论 JSON 同样可得全现场。

评论入口、数据源与 agent 读法见 [feedback.md](feedback.md) 与 [agent-readable-html.md](agent-readable-html.md) 第 5 节。

## 技术正文复用逻辑画板

`techPoints[].graph` 使用共享 `CanvasViewport`、`useCanvasTransform`、`CanvasControls` 与 `HoverPopover`。画板默认采用紧凑 260px 高度上限（多代码导航为 240px），右侧独立工具列；外框固定，图形仅在内部平移/缩放，初次打开、字体加载和视口 resize 适应完整内容；所有节点保留全文，长标签撑开节点。screen 页的原生滚动不受影响。

```json
{"title":"控制关系","graph":{"nodes":[{"id":"page","label":"页面状态","description":["持有生效条件并请求列表。"]},{"id":"filter","label":"筛选组件","status":"changed","description":["读取受控 value，通过 onChange 提交草稿。"]}],"edges":[{"from":"page","to":"filter","label":"groups / value","kind":"data"}]}}
```

节点 id 唯一；边引用已有节点；status 为 context/changed/result，kind 为 data/control/dependency。可选 column/row 必须一起给非负整数（0–30），缺省按三列蛇形排列。复杂分支显式安排网格位置；边标签保持简短。完整说明放 description 字符串数组；不用代码块画图，不注入脚本。图仅在完整详情出现，来源 JSON 保留全部结构。

Lavish-axi 的多行标签归一化、固定 frame、字体就绪后 fit 机制已适配；详见 [lavish-integration.md](lavish-integration.md)。

逻辑画板入场先确定最终布局与 fit，原地 opacity 淡入；自动 fit/字体就绪/resize 不启动位移或缩放过渡。用户主动点击缩放仍可有原有过渡。逻辑页切换和补充逻辑板首次打开也遵守该规则；原生 UI 预览的 FLIP 不受影响。

### 短画板与多代码关系

- Dock 以源组件自然尺寸、视口和评论栏实际边界决定布局。横向画板（宽不小于高）或横排时高度不超过可用高度 42% 的短组件，只要扩宽后的完整预览仍能留出 20px 间隔和至少 320px TRD 阅读区，就使用画板在上、TRD 在下；不再用固定高度占比否决仍放得下的横向画板。普通长屏继续左右排列。用户缩放不改变外框，resize/评论栏切换按同一规则重算，富详情与 TRD 共用最终边界。
- 上下布局中，预览右侧扣除缩放工具与评论栏后仍有至少 340px 宽、180px 高时，当前技术详情的 graph/codeFlow 移入右侧共用画板区，正文只保留说明、代码与契约。复用同一份交互图，不克隆或重复渲染；多图依作者顺序可滚动访问。缩放、节点说明、代码多选与评论的 row/component 归属保持有效；空间不足自动回正文，代码选择不丢失。
- `trd.technical.codeFlow` 复用 `LogicGraph`。每个代码 `techPoints[]` 提供稳定 `id`，关系图用相同 node id 引用；代码节点必须全部可达。允许带 description 的外部上下文节点，点击只解释职责。关系必须显式编写，边用 label 区分调用、数据和引用，不能按顺序猜调用。
- 渲染顺序为关系图、当前选中代码、必要的独立说明。节点默认支持多选：点击或键盘激活追加选择，再次激活取消；下方按作者顺序展示所选代码，可取消全部。纯上下文节点不改变选择，拖拽不会误选；冗余代码解读应合入相应语义注释；原始代码和原有评论保留。新评论携带稳定 tech-point target，旧评论按所属行内的代码片段/标题恢复选择。

```json
{
  "techPoints": [
    { "id": "caller", "title": "调用方", "pseudoCode": "await save();" },
    { "id": "save", "title": "保存函数", "pseudoCode": "async function save() { return persist(); }" }
  ],
  "codeFlow": {
    "nodes": [{ "id": "caller", "label": "调用方" }, { "id": "save", "label": "保存函数" }],
    "edges": [{ "from": "caller", "to": "save", "label": "await save", "kind": "control" }]
  }
}
```
