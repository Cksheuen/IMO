# 评审信息展示

## 紧凑评审布局

- 右上角提供“复制评审上下文”，包含实际页面地址、标题、slug、源码位置（若提供）、反馈存储键与条目数，以及增量处理方式；不复制整份历史。维护操作默认收进“工具”菜单。
- 对独立逻辑画板可在 pageHtml 容器声明 `data-review-layout="aligned-components"`，其直接子组件按 `data-component-id` 与对应 TRD 分组对齐；可选尾部证据使用独立的 `data-review-overview-footer` 子元素。桌面宽度至少 1100px 启用，窄屏和未声明的页面保留正常布局。
- 不复制总览画板；未变化的 pageHtml 保持 DOM 节点，进入和返回时保留布局。展开预览不继承总览的临时高亮状态。
- 代码段高亮沿用暗色源码配色，以柔和背景过渡提示范围；减少动态效果时关闭过渡。

## Mapping 行（三列 TRD）

每行 mapping 独立回答「为什么改 / 改什么 / 数据从哪来」：

- **浅层专用摘要**：可选 `overviewSummary{requirement?, change?, api?}`，只供总览使用；每项为非空字符串，最长 240 字符，通常用一句简短概括，不铺完整 IDL 路径。不得用它覆盖原始 `requirement / change / api / trd`，组件和详情窗继续读取完整内容。
- **兼容必填**：`requirement` / `change` / `api{summary, fields[]}` —— 旧 tech-review 消费方的降级契约，必须保留。
- **富结构（可选）**：`trd.productDesign|technical|apiChange`（`positioning` / `sections` / `modules` / `techPoints` / `pseudoCode` / `items` 等）、`reviewBrief` chips、`cross` 跨模块折叠卡。
- **富信息渐进披露**（可达不降级，但不在每层全量展开）：
  - overview：结论/摘要——短而准的逐列摘要，无 inline 代码块、无长字段列表。
  - component：职责 / 关键改动 / 依赖。
  - node detail：相关 rationale、logic、state/edge cases、API 依赖与证据。
  - 完整富内容（`trd` 结构、代码块、字段全表、`cross`、行 metadata）：通过可读的 scoped detail action（独立 dialog，自带作用域关闭，非全局导航）查看；snippet 解释其角色，不逐行铺陈。
  - 行级 meta（chips / codePaths / cross）每 surface 只渲染一次；`reviewBrief.changeType` 与 `api.changed` 的展示规则见 [../SKILL.md](../SKILL.md)「展示分层与去重」。
  - 信息层级 ≠ 预览裁切：禁止用 CSS clipping/截断冒充层级披露；预览缩放保守，打开富详情不裁切、不改变预览；原始数据完整保留且随时可达，`requirement / change / api` 兼容摘要仅作 fallback。输入中的独立事实与证据保持可达；已确认同义内容可合并到唯一承载并保留来源，不因字段可选就重复填充；无真实源码/IDL 证据的富内容必须显式标注 example/proposal，绝不伪造已确认契约。
- `api.fields[].target` 命中 `data-api-field` / `data-review-target` token；`data-api-field` 挂在渲染字段的最小 HTML 元素上，多字段空格分隔。
- 扁平契约引用：后端接口缺失时先在顶层 `apiContracts` 提案、行内用 `mapping.api.contractIds` 引用，规则见 [authoring-data.md](authoring-data.md#扁平契约)。
- 完整嵌套示例、`MappingRow` / `DeepDive` / `TrdColumnContent` 类型与 `api.changed` / `reviewBrief.changeType` 规则见 [review-schema.md](review-schema.md)。

## change block 改动表达（对应 HARD-GATE 32）

方案评审页面向技术读者，「方案设计」必须显式表达两类信息：**完全新增内容**说明新增原因与作用；**改动/删除内容**给出改动前后对比。可选 `changeBlock` 承担这一表达，挂载点为 `components[].mapping[].changeBlock` 或 `trd.{productDesign,technical,apiChange}.techPoints[].changeBlock`。

- 结构：`{ kind: add|modify|remove, rationale(必填,≤800字符), before?: {lang?, code?|text?}, after?: {lang?, code?|text?}, impact? }`；一致性：add 禁 before 必填 after、remove 禁 after 必填 before、modify 双侧必填；每个 side 的 code/text 二选一；未知字段拒绝。校验真源 `project/src/lib/changeModel.ts`（`validateChangeBlock`），经 `parseReviewSpec` 与两个 `render-review.mjs`（根 / project 手工镜像，必须同口径）双重强制。
- 渲染：`DiffCodeBlock`（左 before 暗红 − 行标 / 右 after 暗绿 + 行标，中间 2px 竖线，代码沿用暗色配色与行号、缺侧斜纹占位「新增内容/删除内容」、<900px 上下堆叠）+ `ChangeRationale`（kind 徽标 + rationale 正文 + impact 默认折叠）。样式自包含（`dv-diff-`/`dv-change-` 前缀，满足 dock 克隆样式自足）。
- 与 codeAnnotations 分工：`codeAnnotations` 解释**现有代码**（单块源码 + 行范围 hover 解释卡，适合新增内容的逐行讲解）；`changeBlock` 表达**新增原因与前后对比**（徽标 + rationale + git 风格双栏），二者不可互相替代。
- 渲染唯一走 `renderChangeBlock`（`src/lib/richContent/change.tsx`）：add 只渲染 after+rationale，remove 只渲染 before+rationale，modify 双栏；只允许在 change 列与技术要点接线，禁止串到 requirement/api 列或在每层重复。
- 完整三例（add/modify/remove 可渲染 JSON）见 [review-schema.md](review-schema.md)「改动块 change block」章节；可渲染样例 `examples/change-blocks.example.review.json`。
