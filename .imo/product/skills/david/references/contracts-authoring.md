# 作者与数据契约

维护对应能力时按 HARD-GATE 编号读取；这些是兼容契约，不要求每次生成或读方案全量加载。编号保留，不重新编号。

## HARD-GATE 1

JSON 驱动；模板不硬编码业务内容。

## HARD-GATE 2

事实/提案分离；缺口显式标记，不猜契约。

## HARD-GATE 3

根 component 必有 `data-component-id` 锚点；递归节点必有 `data-review-node-id` 锚点；树深 ≤ 8；id 全局唯一。

## HARD-GATE 4

mapping 三联动互不「见上文」；`requirement / change / api` 兼容字段必填。

## HARD-GATE 5

字段级锚点：`data-api-field` 挂最小元素。

## HARD-GATE 6

单文件自包含；不把截图当页面；不加载外部 CDN。

## HARD-GATE 11

保持向后兼容：default rows 仍来自现有 `components.mapping`；custom `overview.mapping` 仅按唯一 raw/scoped id 关联，未命中/歧义行保留为中性「整体说明」，不猜测、不丢弃；保留旧 `resolveOverview` 接口描述。本轮新增可选字段（`reviewBrief.changeType`、`api.changed`）缺省即旧行为，旧 JSON 无需改动。

## HARD-GATE 19

可独立复制的 component 根与显式 drilldown 根必须样式自足（唯一类名前缀隔离、根承载字体/色彩，不依赖不随 clone 保留的外层祖先）；未指定硬件尺寸时长 UI 用可滚动预览窗口保持可读，不把整页压成极小文字；必须在本次实际生成页验证 component/drilldown 样式，sample 测试通过不替代。

## HARD-GATE 20

作者约束：overview 逻辑画板真实表现组成/数据流/依赖、边含义明确、不画虚假汇聚；灰上下文/蓝改动/绿结果、文字可读；复杂 UI/逻辑进子节点或 PRD/TRD，不在总览嵌整屏。closed 原生 `<details>` 可作 drilldown 入口，父层只 summary，进入 clone 展开、返回保持 closed，普通证据 details 不受影响。

## HARD-GATE 21

字段单语义：已有 mapping 能表达职责、逻辑和状态时，不再生成同义 deepDive 摘要/逻辑/状态块；技术正文不列常规尺寸、色值、装饰层与样式代码，交互/状态/数据事实用简短条目表达。`requirement`/`change` 单一摘要，`overviewSummary` 不同义改写；对应 `trd` 增量，不为空内容制造详情按钮；field 属性/摘要有不同原文时保留可达；行 meta 不让需求列产生假详情。`mappingIds` 按节点职责精确选取，避免同一行多层无增量重复。

## HARD-GATE 22

稳定定位：component/node HTML 锚同时给 `data-review-target` 及可读 label；旧泛化 surface/像素位置只能恢复场景并说明原框缺少稳定锚点或已变更，不宣称精确找回（仅约束评论位置找回，不约束视觉保真）；历史详情已删增量则不重开假弹窗。

## HARD-GATE 23

高保真还原：先按「组件代码是否已存在」选路径（B 真渲染 / A CSS art），设计稿与 CSS 导出并存时以图判结构、以 CSS 取数值，判可见性须回溯祖先链；缺代码/设计稿/IDL/数据先查已有资料，仍缺且阻塞时按输入核查表确认；沿用已有授权与概念模式，不静默瞎猜；路径 A 必须满足手机容器真实层级、token 化、渐变模拟媒体（禁 emoji 代替媒体）、字阶分级与显式字体栈、自包含内联样式、三层锚点、契约缺口显式表达，且不得声称像素级 1:1。

## HARD-GATE 28

高保真复刻优先复用真实组件：动手前先按候选名 / `codePaths` grep 探测（记录 `probe`），探测到可对照渲染基准则走 path B（`components[].source.kind=component`），无对应组件才允许 path A（`kind=css-art`）；每个 component 必须带 `source` 由来契约，`fidelity=pixel-vs-real`（像素级 1:1 声明）强制要求 `kind=component` 且 schema 校验拒绝其余情况——**无真实组件证据不得声称 1:1**（与第 23 条并存，组件复用在先、CSS art 是降级）。

## HARD-GATE 32

改动表达规范：新增/改动/删除必须用 `changeBlock` 显式表达——add 只给 after+rationale（禁 before），modify 必须双侧对比，remove 只给 before（禁 after）；rationale 必填 ≤800 字符，code/text 二选一，未知字段拒绝；`codeAnnotations` 解释代码不承担前后对比，可挂到 before/after 的 code 上分别提供行级 hover 注释（text 侧禁用）；一致性由 `parseReviewSpec`（changeModel）与两个 `render-review.mjs` 同口径强制，非法即拒绝；渲染唯一走 `renderChangeBlock`（仅 change 列与 techPoint），组件样式自包含（dv-diff-/dv-change- 前缀）。

## HARD-GATE 37

埋点一体化：埋点必须与触发它的组件/字段同处表达——pageHtml 用 data-track-event 标记、富文本代码块埋点行用「~ 」前缀特殊高亮且默认折叠；禁止埋点脱离组件单列章节。

## HARD-GATE 38

不确定内容隔离：IDL 字段缺口使用绑定对应位置的 Agent 评论（有序字段清单），并在 API 契约以 provision 标识来源与缺失状态；不重复写 openQuestions。其他 PRD/设计稿/实现不一致或无证据的不确定点必须进顶层 openQuestions（含 PRD 摘录与位置帮助理解），由待澄清页供用户 review；禁止混入组件正文猜测或当事实。

## HARD-GATE 39

扁平契约与迁移：后端接口缺失时先以 apiContracts（status:"proposed"）列出最小诉求，由 mapping.api.contractIds 引用；真实接口到位保持契约 id 稳定。字段改名/改结构时同步更新受影响字段锚点、代码/adapter 与说明，并核对消费者；字段不变的 status/endpoint 更新可只改 contract。proposed 必须显式标注，禁止伪造 confirmed 契约。

## HARD-GATE 40

JSON 输出取舍与增量：脚手架/常规配置/依赖按 references/authoring-json.md 取舍输出；同组件的数据结构/埋点/结构同组，不另建仅汇总数据字段的 component；数组须给出元素类型与字段，不能只写 array；样式默认 tailwind、mock 不铺陈、不写装饰性 class（david data-* 锚点与 pageHtml 自足前缀类名除外）；增量修改只给定位片段不全量重发；先合并到候选完整 spec 再解析，结构校验不替代来源覆盖与字段定位检查。

## 对应验证项

- [ ] render 校验通过（深度、锚点、mappingIds、字段 target 命中）
- [ ] 作者约束：overview 逻辑画板真实表现组成/数据流/依赖、边含义明确、无虚假汇聚；灰/蓝/绿配色、文字可读；复杂 UI/逻辑进子节点或 PRD/TRD，总览无整屏细节；closed details 作 drilldown 入口时父层只 summary、进入 clone 展开、返回 closed，普通证据 details 不受影响
- [ ] 字段单语义与 mappingIds：`requirement`/`change` 单一摘要、`overviewSummary` 不同义改写；`trd` 增量对应、无空内容详情按钮；field 不同原文保留可达；行 meta 不产生假详情；`mappingIds` 按节点职责精确选取、无多层无增量重复
- [ ] 高保真还原：已按「组件代码是否已存在」选定路径并说明；设计稿存在时以图判结构、以 CSS 取数值，可见性判断已回溯祖先链；输入缺失已向用户确认；路径 A 满足手机容器真实层级 / token 化 / 渐变模拟媒体（无 emoji 代替媒体）/ 字阶分级 / 显式字体栈 / 自包含内联样式 / 三层锚点 / 契约缺口显式表达，且未声称像素级 1:1
- [ ] 富信息渐进披露：overview 短摘要无 inline 代码块/长字段列表，component 职责/依赖，node 逻辑/证据；完整富内容经 scoped detail action 可读查看，原始数据可达；无 CSS 裁切冒充层级，打开富详情不裁切预览；无证据富内容标注 example/proposal
- [ ] 三列 TRD 桌面并排、窄屏堆叠；兼容字段降级可渲染
- [ ] 组件来源契约：`npm run test:david-model` 全部通过（含 `components[].source` 合法通过 / `kind=component` 无 codePaths 拒绝 / `css-art` 声称 `pixel-vs-real` 拒绝 / `pages[].kind` 与 `node.canvas` 校验 / `collaboration` 清单 pageId/nodeId 唯一性与 owner 缺省拒绝）；复刻走查：选了 path B 或 path A 并给出 `probe` 与 `fidelity`，无用例断言为无证据 1:1
- [ ] change block：add/modify/remove 三种 kind 在 `examples/change-blocks.example.review.json` 可渲染；非法块（add 带 before / modify 缺侧 / 超长 rationale / code+text 并存）被 `parseReviewSpec` 与两个 `render-review.mjs` 拒绝；逐行双栏 diff、真实增删与对侧空行、窄屏横向滚动、rationale/impact 展示正确；`node scripts/test-change-block.mjs` 全绿
- [ ] apiContracts 扁平契约：proposed 契约显式标注、`mapping.api.contractIds` 引用可解析；契约面板与代码富文本并排且代码未展开也常驻、字段与 pageHtml `data-api-field` hover/点击双向高亮（`npm run test:api-contracts` 全绿，含 chromium hover/click 联动）；confirmed 迁移保持 contractId，字段变化同步关联 token/消费者且实际定位可用
- [ ] 埋点一体化：pageHtml `data-track-event` 挂在触发元素；富文本「~ 」埋点行特殊高亮且默认折叠（`npm run test:track-markers` 全绿）；埋点与触发组件/字段相邻，无独立埋点章节
