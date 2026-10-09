# 节点与总览类型

### ReviewNode（递归节点）

| 字段 | 规则 |
|---|---|
| `id` | 全局唯一（含 components 根） |
| `label` | 非空字符串 |
| `interaction` | `highlight \| drilldown \| auto`；缺省 `auto`：保留上下文，默认 highlight（不放大、不裁切预览）；drilldown 仅作者显式指定，要求子树自包含且有真实可读性/信息增益，children 数量不是理由 |
| `target` | 锚点名；缺省用 `id`。每个递归节点必须在 pageHtml 有 `data-review-node-id="<target||id>"` |
| `mapping` / `mappingIds` | 互斥；`mappingIds` 非空且每项必须命中所属 root component 的 `mapping[].id` |
| `children` | 递归，嵌套深度 ≤ 8 |
| `deepDive` | 见下 |

> 根 component（`components[]`）的锚点是 `data-component-id="<id>"`（app 据此 FLIP 打开 dock，居中阅读排版）；`data-review-node-id` 校验只作用于递归 children，不校验根。

**交互模型**：Overview 渲染按 component 分组的表，首列合并 component 入口与相关 PRD 行，组间分隔/色调区分；根 component 按钮只在表内，无底部重复 strip。hover/focus 任一相关行、首列入口或页面预览 component，仅高亮同组对应 surface，不导航、不 resize、不影响其他组。表内根 component 点击 → FLIP 打开 dock（居中阅读排版，非整页接管、不仅角落）；dock 内 highlight 节点（auto 默认）点击 → 高亮锚点 + mapping 表过滤到该节点行（`resolveNodeMapping`：自带 `mapping` → `mappingIds` 过滤 → 根全部行）+ deepDive，预览保留所在容器与附近上下文（保守缩放，不裁切），逻辑过滤与面包屑仍可用；显式 drilldown 节点（作者指定的自包含复杂子树）点击 → 替换/放大 dock 内容为该子树。Prev/next toolbar 只遍历当前层 siblings（root 为 components，嵌套为父节点 children），显示当前层计数，无 wrap，边界/单 sibling disabled；nested 返回上一级、root 返回总览，Escape 同语义，breadcrumb「总览」显式退出。highlight 节点使用最近复杂祖先 preview；跨 sibling 导航恢复正确 preview container。

**行为约束**：

- **overview 常驻**：进入任何 component / 节点详情时 overview 不卸载，仅隐藏并置 inert；返回时 crossfade 与离场场景/FLIP 同时开始，禁止 mount-after-delay。仅在必要时于 paint 前测量；无多余 `flushSync`、无人为顺序空白延迟。
- **居中阅读排版**：所有层级（overview、inspector、各级 dock 预览）构图/预览居中；prose 左对齐；短内容居中，高内容顶部可达且可滚动；进入节点不带陈旧滚动偏移；评论导航仍恢复目标位置。
- **克隆样式自足**：dock 只克隆 component 根节点、drilldown 替换为子树，不携带外层祖先；每个可独立复制的 component 根与显式 drilldown 根必须样式自足（唯一类名前缀隔离、根承载字体/色彩，不依赖 `.ancestor .child` 式外层选择器），并在本次实际生成页验证克隆后样式完整。
- **评论与反馈（唯一入口）**：评论与反馈统一走 David 外观框选反馈（appearance-selection），唯一活动数据源为本机评论服务持有的 `david-feedback/v1`，评论栏历史接入同一数据源；旧 `tech-review:*` 存储不读取、不迁移（非活动来源）；不再有被动业务批注 / 文字划选评论，也不存在 `pendingCommentTarget` 待评论状态锁。外观选择上下文 schema 以 `project/src/lib/globalSelection.ts` 与 `project/src/lib/davidFeedback.ts` 为准。
- **closed details 作 drilldown 入口**：closed 原生 `<details>` 可作 drilldown 入口，父层只渲染 `<summary>`；进入时 clone 展开内容，返回时保持 closed；普通证据 `<details>` 不受此交互影响。
- **字段单语义**：`requirement` / `change` 各承载单一摘要，`overviewSummary` 不同义改写原文；对应 `trd` 增量补充，不为空内容制造“详情”按钮；`field` 属性 / 摘要有不同原文时保留可达；行 meta 不能让需求列产生假详情。`mappingIds` 按节点职责精确选取：父节点只声明自身组合职责，子功能放入 `children`。列表默认显示当前层自身与直接子节点，更深功能进入对应父节点后查看；兼容旧数据显式跨层共用同一行。避免同一行多层无增量重复。
- **稳定定位**：component / node HTML 锚同时给 `data-review-target` 及可读 `data-review-label`；旧泛化 surface / 像素位置只能恢复场景并说明原框缺少稳定锚点或已变更，不宣称精确找回；历史详情已删增量则不重开假弹窗。
- **功能行阅读状态**：component/node 的功能行可折叠，首次只展开第一项；每个页面、组件与节点分别保存展开状态和 inspector 滚动位置，层级返回时恢复。功能节点内只有一行的叶子功能直接在父层展开完整需求、实现和 API，不要求再进入内容完全相同的一层；历史节点锚点仍可定位。反馈定位到折叠行时先展开再滚动。
- **渐进披露**：overview 短而准的逐列摘要（无 inline 代码块/长字段列表）；component 职责/关键改动/依赖；node 逻辑/state/API 依赖/证据；完整富内容经 scoped detail action（独立 dialog、自带作用域关闭）查看。信息层级 ≠ 预览裁切：禁止 CSS clipping 冒充层级，原始数据保留可达。
- **整页外观反馈**：单一全局捕获工具覆盖整个渲染后 HTML（shell/按钮/留白/dock/PRD/dialog），按可见最上层命中并保留完整视口矩形；结果写入 `david-feedback/v1` 的 `scope.selection`。形状见 `project/src/lib/globalSelection.ts`，严格校验见 `project/src/lib/davidFeedback.ts`。

### DeepDive（全部为可选字符串数组）

`summary`（**数组**，不是字符串）、`codePaths`、`logic`、`state`、`edgeCases`、`tests`。render 校验任一字段非字符串数组即失败。

### Overview

`overview.mapping[]` 为整页级行；缺省时 `resolveOverview` 聚合每个 component 的**全部** mapping 行，行 id 加作用域前缀 `` `${component.id}:${row.id}` ``（重复追加 `#n`；纯函数，不改输入）。Public schema 不变：显式 `overview.mapping` 仅按唯一 raw id 或上述 scoped id 关联，未命中或歧义行保留为中性「整体说明」，不猜测、不丢弃；`resolveOverview` 接口描述保持旧契约。
