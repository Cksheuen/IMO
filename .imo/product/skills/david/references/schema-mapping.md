# MappingRow 类型

### MappingRow

- 可选 `overviewSummary{requirement?, change?, api?}`：字段为非空字符串且不超过 240 字符，拒绝其他键。`requirement/change` 仅兼容旧 JSON，新生成直接使用行级摘要。浅层 API 只显示显式 `overviewSummary.api`，缺省时不从字段表反推摘要，并自动省略该行的 API 列；完整契约仍在功能详情。
- 兼容必填：`id`、`requirement`、`change`、`api{summary?, fields?}`。
- 富结构可选：`title`、`codePaths`、`reviewBrief`、`d2c`、`trd{productDesign, technical, apiChange}`、`cross`。
- `reviewBrief.changeType?`：改动性质短标签（新增 / 修复 / 重构 / 验证 等），与 `status`（已验证 / 待人审）分离；渲染为独立标签，每 surface 只出现一次。
- `api.changed?`：显式 `false` 表示本功能点无接口改动——隐藏 API 列内容与“查看接口”入口，全部行都为 false 时总览 / 组件表切两列，mixed 行用跨列布局；缺省 / `true` 保持旧 JSON 兼容（照常展示）。判据唯一走 `rowApiChanged`，禁止用“无接口改动”文案正则猜测。
- `trd.*` 为 `TrdColumnContent`：`heading / summary / points / bullets / pseudoCode / codeLabel / positioning / sections / modules / techPoints / head / endpoint / beId / status / items / fields`。
- 新生成的 `productDesign/technical` 不填写 `heading/summary`；功能名称与摘要统一由行级 `title/requirement/change` 承载。旧列标题仍可读，详情只展示一次，不在头部和正文重复。
- `api.fields[]`：`name`（规范路径，一字段一行）、`type`、`meaning`、`target`（命中 `data-api-field` / `data-review-target` token，多 token 空格分隔）。
- 富信息渐进披露（可达不降级）：overview 结论/摘要（无 inline 代码块、无长字段列表）→ component 职责/关键改动/依赖 → node 逻辑/state/API 依赖/证据 → 完整富内容（`trd` / `reviewBrief` / `cross` / 字段全表 / 行 metadata）经可读的 scoped detail action 查看；信息层级 ≠ 预览裁切，禁止 CSS clipping 冒充层级，原始数据保留可达；`requirement / change / api` 摘要仅作 fallback。输入中的独立事实与证据保持可达；已确认同义内容可合并到唯一承载并保留来源，不因字段可选就重复填充；无真实源码/IDL 证据的富内容必须显式标注 example/proposal，绝不伪造已确认契约。
- 分层去重（结构职责，非模糊语义去重）：行级 meta（`reviewBrief` chips / `codePaths` / `cross`）每 surface 只渲染一次——component/node 在行 header 与行尾 cross 折叠区，scoped detail 在 header meta chips，overview 级 detail 经 `renderRowExtras` 补齐；禁止把行级 meta 复制进每一列，禁止 dialog header 与正文重复同一段摘要/口径/元信息。
- 多证据默认折叠：`codePaths` > 2 条、deepDive codePaths > 4 条默认折叠（`<details>`），展开后完整可读；`evidence` 默认折叠。伪代码/正文细节不是证据文件列表，不得误折叠。
- 紧凑引用：文件路径/长标识用 `CompactRef` 省略显示，hover（title）或 keyboard focus 读全，点击复制完整值并反馈；正文段落正常换行、代码块保留滚动与全文。引用可省略但原文可达，正文不得靠裁切隐藏。


`techPoints[].graph`：结构化关系图，节点/边与说明格式见 [tree-canvas.md](tree-canvas.md)。Runtime parser 与两个 renderer 共用 `isValidLogicGraph` 校验；图形属于富详情，不被当成短文内联。

`technical.codeFlow`：代码关系导航，格式同 LogicGraph，node id 引用带代码的 `techPoints[].id`。可另加说明明确的上下文节点；每份代码必须有节点，运行时与两个 renderer 共用 isValidCodeFlow 校验。详见 [tree-canvas.md](tree-canvas.md)。
