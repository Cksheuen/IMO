# review spec JSON 编写入口

生成或局部修改 review JSON 时先读本页，再按任务加载下表中的文件。字段类型以 `project/src/types/review.ts` 和 `parseReviewSpec` 为准；本组文件规定信息取舍，不新增 review schema。

## 按任务读取

| 当前任务 | 读取规则 |
|---|---|
| 首次提取、补设计资料、检查遗漏 | [authoring-extraction.md](authoring-extraction.md)：业务边界、来源与双向覆盖检查 |
| 改字段、数据状态、接口或待澄清项 | [authoring-data.md](authoring-data.md)：职责判定、子字段、apiContracts、openQuestions、字段迁移 |
| 改功能、交互、组件选型或正文组织 | [authoring-components.md](authoring-components.md)：组件归组、复用选择、触点闭环、代码注释、埋点与样式取舍 |
| 新建项目、改构建配置或准备事项 | [authoring-preparation.md](authoring-preparation.md)：preparation、资料预填、脚手架裁减 |
| 修改已有 JSON、处理评论、升级模板 | [authoring-incremental.md](authoring-incremental.md)：锁定数据源、引用检查、候选合并校验 |

首次生成先完成提取检查，再加载本次实际涉及的规则；增量任务只对受影响功能及其引用执行检查。完整类型查 [review-schema.md](review-schema.md)，预览还原查 [generation.md](generation.md)，树交互查 [review-tree.md](review-tree.md)。

## 信息收录与唯一归属

对每条候选信息先问：是否解释本次产品行为、实现决策、数据契约或必要待确认事项？有无来源？已有哪个字段承载？

- 无评审用途：不输出。常规配置、装饰、完整 Mock、执行日志和核查表不因“已收集”就进入正文。
- 面向技术读者筛选信息：只保留会影响实现决策、状态/交互、契约或验收的事实。已说明“后端配置标题与顺序”，无需再补“前端不硬编码”；已说明条件为 true 时显示箭头，无需再重复否定分支。真实异常、权限和数据边界仍需保留，不能为精简删除关键行为。
- 同义信息：复用已有承载，不给每个可选字段填一遍。原始证据保留可追溯，不要求在 JSON 中复制全文。
- 独立增量：放到所属功能的详情。短文与少量列表直接显示，不制造空详情或只有一句话的中间层。
- 来源缺失或冲突：按数据规则标记 proposed / openQuestions；已能自行查明的内容先查，不重复向用户索取。

| 信息职责 | 唯一主要承载 |
|---|---|
| 功能名称、需求目的、实现摘要 | `title` 命名功能；`requirement` / `change` 各一条，供总览和详情共用 |
| 产品行为、实现与状态规则 | 所属 mapping 的 `trd.productDesign` / `trd.technical`；有独立增量才扩展 deepDive |
| 契约与具体字段 | `apiContracts` + `mapping.api.contractIds`；已有独立概述才写 `api.summary` |
| 前后改动、逐行解释 | `changeBlock` / `codeAnnotations` 分工，不在代码外重复同义说明 |
| 待创建项、缺少资料 | `preparation.tasks` / `preparation.fields`；不放进需求列 |
| 需人决定的证据冲突 | 顶层 `openQuestions`；正文引用其 id，不复制猜测 |

同一组件的数据、交互、埋点与结构在同组表达。浅层不需要 API 摘要时省略 `overviewSummary.api`，完整契约仍在功能详情；`api.changed:false` 只表达实际无接口改动，不能用它隐藏仍需评审的契约。

### 精简正文与生成字段

- `requirement` 写用户操作及结果，`change` 写实现动作与责任模块。默认各一句；条件分支放所属详情，接口字段放契约。用户纠正过的排除项、调研过程和执行范围说明留在评论或来源记录，不逐条改写成产品需求。
- “取消不保存”“历史撤销后不自动弹”等会改变用户结果的规则属于必要行为，保留在对应分支；“不接入其他需求”“不能额外实现某方案”等工作指令不进入正文。
- 新生成 JSON 省略 `overviewSummary.requirement/change`、`trd.productDesign.heading/summary`、`trd.technical.heading/summary`：功能名由 `title` 承载，摘要由 `requirement/change` 承载，独立细节用 `sections/techPoints` 的小节标题和正文承载。这些旧字段仅用于兼容读取。
- `overviewSummary.api` 仍可控制浅层接口摘要；独立接口信息保留在 `apiContracts` 或 `trd.apiChange`。不把字段名相似当作可以删除事实的证据。
- 清理已有 JSON 时先对照同一功能的标题、摘要和正文，合并同义内容；独立事实移入所属详情，保留代码、契约、来源和稳定 id。相似度只用于定位候选，不自动删除。

## 写入前的收录边界

- 原始资料未提供 endpoint/method/请求参数时省略这些可选项；`proposed` 标记不授权凭空补齐协议。只有用户要求讨论接口设计时才提出有理由的候选，不把线框授权扩大为接口设计授权。
- 字段 required/type 依证据或明确的提案设计填写；图标数据与“是否显示图标”不是同一语义，不能为简化类型丢掉所需数据。FE 交互态不自动进入后端字段。
- 已由 `apiContracts` 承载的字段不再原样复制进 `api.fields` 或静态字段表；仅有独立原文、不同语义或必要的旧 target 定位时保留。不能把仍含初始状态等契约需求的行标为 `api.changed:false` 来裁掉 API。
- 同一 mapping 已完整表达功能时，不给它再造两个同义根/子节点或“入口/内容”中间层。业务操作只有独立规则或数据才拆行；锚点数不等于功能点数。
- 未知信息不是已确认缺省行为：待确认的空值视觉不等于后端允许空值；设计没要求的“复制即关闭”等交互不能自动启用。

## 完成判据

先做来源与 JSON 的双向核对，再对完整候选 spec 执行 `parseReviewSpec` 和渲染验证。增量片段先合并再校验，不把片段冒充完整 spec。结构合法、编写审计零提示，都不证明必要字段或业务行为已经提取完整。
