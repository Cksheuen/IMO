# 渲染与交互契约

维护对应能力时按 HARD-GATE 编号读取；这些是兼容契约，不要求每次生成或读方案全量加载。编号保留，不重新编号。

## HARD-GATE 9

多页 Overview 先按当前页明确的 HTML / scene 组件归属过滤，并使用 `pages[].overview` 的工程落点摘要；不得展示其他页面的脚手架与长正文。Overview 必须按 component 分组：首列合并 component 入口与相关 PRD 行，组间分隔/色调区分；根 component 按钮只在表内（th 保留 rowheader，单元格内真实 button 占满内容区）；预览中的普通 component 根仍支持点击进入详情。hover/focus 仅高亮同组 surface，不导航、不 resize、不影响其他组。

## HARD-GATE 10

Prev/next 只遍历当前层 siblings（root 为 components，嵌套为父节点 children），显示当前层计数；无 wrap，边界/单 sibling disabled。nested 返回上一级、root 返回总览，Escape 同语义，breadcrumb「总览」显式退出；highlight 用最近复杂祖先 preview，跨 sibling 恢复正确 preview container。

## HARD-GATE 13

Overview 常驻：详情访问不卸载，仅隐藏/inert；返回 crossfade 与离场场景/FLIP 同时开始；无 mount-after-delay、无多余 flushSync、无人为顺序空白延迟。

## HARD-GATE 15

富信息渐进披露：overview 短摘要（无 inline 代码块/长字段列表）、component 职责/关键改动/依赖、node 逻辑/state/证据，短正文与少量列表在当前层直接显示，代码/复杂内容经 scoped detail action 查看；原始数据保留可达，不以 CSS 裁切冒充层级，富详情使用无蒙层非模态面板，按 dock 实际边界留出左侧预览，评论栏按钮高于普通富详情且可操作；框选或填写反馈期间隐藏该按钮，退出后恢复原展开状态。展开/折叠按钮位于右上角，不覆盖评论条目或顶栏工具；打开富详情不裁切预览；legacy 摘要仅 fallback，无证据富内容标注 example/proposal。

## HARD-GATE 16

auto 保留上下文：默认 highlight（保守缩放、不裁切预览）；drilldown 仅作者显式指定且子树自包含、有真实可读性/信息增益，children 数量不是理由；附近上下文小或耦合时优先 highlight。

SVG 预览克隆必须为内部 clip/mask/paint/use 片段引用分配独立 ID，不能引用隐藏原页或同名图标的 defs；原始 SVG 和业务锚点保持不变。

## HARD-GATE 18

居中阅读排版：prose 左对齐，短内容居中，高内容顶部可达 + 滚动；节点进入无陈旧滚动偏移；评论导航仍恢复目标。

## HARD-GATE 29

多页面与画板交互：详情形态由 `pageInteraction` 纯函数解析——显式 drilldown/highlight 保持原语义（权威优先），`auto` 缺省仍 highlight（向后兼容）；复杂节点（`node.canvas:true` 或 `magnifyOnComplex` 子树深度达标，`pages[].kind=canvas` 标识画板页）→ canvas 等比放大 / 深层画板，普通节点 → 高亮锚点不裁切；跨页导航用单行横向滚动入口（按钮不压缩、标题不换行，当前项随翻页/resize 在条内可见）与 hover 翻页按钮，`next/prev` 无 wrap、边界 disabled；详情进入压 history 栈、`Escape`/返回沿栈回退一层；键盘 `ArrowRight/ArrowLeft`=翻页、`Escape`=返回；状态上屏前必须过 `validatePageViewState`。

## HARD-GATE 31

真实画板：`screen`（含缺省、未声明 graph）与 UI component 使用原生滚动；UI 宿主透明，不额外绘制底板/边框/阴影/纹理或上一页残影；逻辑 `canvas`、显式 canvas 节点和补充逻辑板支持 wheel 光标锚点缩放（0.25–3）与拖拽平移，>5px 拖拽必须抑制节点点击、≤5px 保留点击（节点跳转/下钻/overlay 语义不变）；overview 与 dock 变换独立，跨页重置 overview、进详情重置 dock、返回恢复 overview；框选模式（body.david-gc-mode）下全部手势让位框选层；坐标变换走 `canvasGeometry` 纯函数 + `useCanvasTransform`，`CanvasTransformContext` 供框选反算 canvasPoint；reduced-motion 无过渡，FLIP/常驻 inert/page stack/dock DOM 契约不得回退。

## HARD-GATE 35

基础组件库唯一来源：新按钮/弹层/折叠/标签/工具条走 `src/components/ui/`（dv-ui- 前缀、复用主题 token），不得在业务组件内重复实现等价控件或新造前缀；富文本渲染只从 `../lib/richContent` barrel 导入。

## HARD-GATE 36

展示层纯结构重构：目录拆分（richContent/、comment/、feedback/、canvas/ 等）必须保持行为、DOM 结构、类名与 `data-review-*` / `data-feedback-*` / `data-component-id` 锚点不变；评论 author 徽标经 `comment/CommentAuthor` 组件化输出，禁止退回正文文字前缀；删除旧文件时同步更新脚本中显式带扩展名的 ssrLoadModule 路径。

## HARD-GATE 44

首帧布局：预览容器模型、最终占位与 TRD 阅读边界在绘制前确定；FLIP 仅改变视觉位移/缩放，不把动画中 rect 作为列宽、不在动画结束后切换容器。评论首次读取时预留其默认空间，首个快照到达不能再挤动正文，确认空列表后才释放；checking 保持不可写且不显示假离线提示。普通/滚动/下钻/reduced-motion、冷启动延迟响应与 resize 都要验证；顶栏补充入口按当前页真实锚点或 scene 归属显示，同类多页不混列且入口均可达。

## 对应验证项

- [ ] Overview 常驻：进详情不卸载（隐藏/inert），返回 crossfade 与离场 FLIP 同步开始；无 mount-after-delay / 多余 flushSync / 人为空白
- [ ] 分层去重：行级 meta（chips/codePaths/cross）每 surface 只一次，dialog header 与正文不重复同一段摘要/口径/元信息；`reviewBrief.changeType` 与状态分离且只一次；`api.changed=false` 隐藏 API 列与“查看接口”、全 false 两列、mixed 跨列（判据唯一走 `rowApiChanged`）；多证据默认折叠可恢复；`CompactRef` 省略显示但 hover/focus 读全、点击复制
- [ ] auto 节点默认 highlight 且预览不裁切；drilldown 均为显式指定的自包含复杂子树；children 数量未被当作 drilldown 理由
- [ ] Overview 分组表：首列 component 合并入口、组内 hover/focus 与预览联动；根按钮只在表内，无底部重复 strip，hover 不导航/resize
- [ ] Prev/next 按当前层 siblings 遍历并显示计数，边界/单 sibling disabled；返回/Escape/breadcrumb 语义正确，跨 sibling 恢复正确 preview container
- [ ] Custom `overview.mapping` 仅按唯一 raw/scoped id 关联；未命中/歧义行保留为中性「整体说明」，`resolveOverview` 旧接口描述不变
- [ ] 根 component 点击 FLIP 打开 dock（居中阅读排版）；显式 drilldown 子节点替换/放大 dock 内容，面包屑 / Escape 正常
- [ ] highlight 节点点击高亮锚点且 dock mapping 过滤到该节点行，deepDive 展示
- [ ] `prefers-reduced-motion` 无动画；HTTP 预览 200
- [ ] 可独立复制根样式自足：dock 克隆 component 根、drilldown 替换子树后字体/色彩/布局不丢失（唯一类名前缀、根承载基础样式，无外层祖先依赖）；长 UI 无硬件约束时可滚动预览、文字可读不压缩；本次实际生成页的 component/drilldown 样式已验证（非 sample 替代）
- [ ] 多页面状态机：`npm run test:page-interaction` 全绿（auto 缺省 highlight 与旧交互一致、canvas 仅在声明或复杂度达标出现、prev/next 边界无 wrap、enter/leave/back 返回语义、ArrowLeft/Right/Escape 键盘、`validatePageViewState` 拒绝非法态）；单页 spec 走旧路径
- [ ] 组件库与分层重构：`node scripts/test-a1-refactor.mjs` 全绿；新交互面复用 `ui/`；richContent/comment/feedback/canvas 目录拆分后行为、DOM 类名、锚点与 author 徽标无回归
- [ ] openQuestions 待澄清页：顶层条目（含 prd/prdRef、design/designRef、conflict、options、recommendation）由独立待澄清页承载且可渲染（`npm run test:open-questions` 全绿，含合法/非法 fixture、两栏对照与 resolved 计数）；冲突 / 无证据内容不混入组件正文
