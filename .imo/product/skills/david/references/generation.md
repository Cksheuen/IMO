# 生成流程与 `pageHtml` 高保真还原

> 适用场景：agent 拿到 PRD / 技术方案 / 证据后，需要决定生成模式、编排 `pageHtml`、建树并渲染评审页时通读；遇到「页面该画成什么样、缺输入怎么办、改动如何预览、能否声称 1:1」类问题按节查阅。JSON 输出取舍（脚手架、归组、增量协议）见 [authoring-json.md](authoring-json.md)；树 / mapping / 画板交互见 [review-tree.md](review-tree.md)。

## 生成流程 15 步

1. 判模式：有证据走保真；无代码无设计走概念模式，直接做，不索要不需的输入（两种模式的定义见 [../SKILL.md](../SKILL.md)「两种生成模式」）。
2. 提取前按 [authoring-extraction.md](authoring-extraction.md) 划定业务/宿主范围，从设计资料 / PRD / 已确认对话 / 代码 / IDL / 运行证据列出必要元素与触点，确定所属功能和 JSON 落点；来源事实与提案分开，不能仅从旧 JSON 反推完整性。
3. 视口：用户给了硬件视口就锁定为预览容器约束。
4. 编排 `pageHtml`：自包含内联 CSS，无 CDN、不以截图充数；概念模式产出建议线框。每个可独立复制的 component 根与显式 drilldown 根样式自足（唯一类名前缀隔离、根承载字体/色彩，不依赖外层祖先选择器）。
5. **作者约束（overview 逻辑画板）**：overview 的逻辑画板必须真实表现组成 / 数据流 / 依赖，边的含义明确（标注调用 / 数据 / 依赖方向），不能画虚假的汇聚节点；灰 = 上下文、蓝 = 本轮改动、绿 = 结果，文字可读；复杂 UI / 逻辑进子节点或 PRD/TRD，不能在总览嵌整屏细节。
6. **作者约束（closed details 作 drilldown 入口）**：closed 原生 `<details>` 可作 drilldown 入口，父层只渲染 `<summary>`；进入时 clone 展开内容，返回时保持 closed；普通证据 `<details>` 不受此交互影响。
7. **字段单语义**：`requirement` / `change` 各承载单一摘要，`overviewSummary` 不同义改写原文；对应 `trd` 增量补充，不为空内容制造“详情”按钮；`field` 属性 / 摘要有不同原文时保留可达；行 meta 不能让需求列产生假详情入口。
8. **mappingIds 精确选取**：按节点职责精确选取 `mappingIds`，避免同一行在多层无增量重复引用。
9. 建树：overview 根 → components → children（≤8 层）；auto 默认 highlight（保留所在预览上下文）+ 过滤 mapping + deepDive，仅自包含复杂子树显式 drilldown 进 dock（居中阅读排版）；overview 常驻，返回 crossfade 与离场同步。
10. 写 mapping：每行 `requirement / change / api` 兼容必填，富信息进 `trd / cross`；按密度分层披露（overview 摘要 / component 职责 / node 逻辑），完整富内容走 scoped detail action。
11. 加锚点：根 component `data-component-id`；每递归节点 `data-review-node-id`；元素 `data-review-target` + 可读 `data-review-label`；字段 `data-api-field`（最小元素）。
12. **稳定定位**：component / node HTML 锚同时给 `data-review-target` 及可读 label；旧泛化 surface / 像素位置只能用于恢复场景并说明原框缺少稳定锚点或已变更，不能宣称精确找回；历史详情已删增量则不重开假弹窗。此禁令只约束**评论框的位置找回**，不约束视觉保真：存在 evidence 命中的真渲染截图或编译产物时，允许以其作为 1:1 视觉基准（见下文路径 B）。
13. 先核对来源与 JSON 的双向覆盖，对完整候选 spec 执行 parseReviewSpec（增量先合并，见 [authoring-incremental.md](authoring-incremental.md)），再渲染校验：`cd <canonical> && node scripts/render-review.mjs <review.json> <user-workspace>/<name>.html`（深度 / 锚点 / mappingIds / 字段命中失败即报错）。
14. 预览与 headless 验证：输出目录起 `python3 -m http.server`，curl 验证 200；用 `cd <canonical>/project && npm run test:drilldown` 断言锚点、点击与 drilldown 行为，**隔离测试不另开用户浏览器；处理已有评审反馈时可复用已授权的原生标签页**。必须在**本次实际生成的页面**上验证 component dock 与 drilldown 预览样式完整（克隆后字体/色彩/布局不丢失）——默认 sample 测试通过不能替代。反馈经 [本机评论服务](feedback.md) 的 CLI 读取，不依赖浏览器直连；磁盘生成 HTML 不含当前评论，显式剪贴板/文件导入导出仅作本机交换通道。
15. 走查：初始态、drilldown/FLIP、面包屑/Escape、字段高亮、评论恢复、reduced-motion。

## `pageHtml` 高保真还原规范

`pageHtml` 是**手工编排的高保真静态预览 HTML**，不是运行时 DOM 粗暴序列化，更严禁把截图塞进 HTML 当作页面。它依据真实代码、设计稿、接口契约与运行证据，重建一份结构真实、视觉高保真、可评论、字段可高亮的 review fixture。

### 两条还原路径（先选路径，再动手）

```
目标页面的真实组件代码是否已存在？
    │
    ├─ 是 → 路径 B：真渲染（像素级 1:1）
    │        编译真实组件 + 真实视口截图，作为视觉基准或评审证据
    │        工具：项目内 fronted-visual-snapshot 一类的渲染 skill
    │              （run_profiled_snapshot.py --recipe，recipe 声明
    │               target/data/viewport/style_contract）
    │        前提：已验证 profile + evidence 命中的视口预设
    │        注意：截图作证据引用或视觉基准，仍不塞进 pageHtml 主体
    │
    └─ 否 → 路径 A：CSS art 复刻（TRD/设计稿阶段的默认路径）
             手写自包含内联 CSS，布局/字阶/圆角/色值精确到设计稿实测值，
             媒体用多层渐变模拟。此时不得声称像素级 1:1。
```

设计稿与 CSS 导出并存时：**以设计稿图片判断结构，以 CSS 导出取精确数值**。Figma "copy as CSS layers" 的扁平导出中，父容器的 `display:none` 不会在子图层块内重复出现，判断可见性必须回溯祖先链——只按图层块自身判断会把隐藏的备选稿当成可见态。

### 输入依赖核查（缺失必须问，不得静默瞎猜）

| 缺失 | 影响 | 自行查找后仍阻塞时的确认内容 |
|---|---|---|
| 前端代码库 | 无法获得真实组件树与类名 | 是否提供代码路径，或基于推导结构继续 |
| 设计稿 / Figma / 截图 | 图标、渐变、阴影、精确间距会偏 | 是否补设计稿，或基于代码样式继续 |
| 后端契约 IDL/DTO | 字段类型与名称可能产生契约幻觉 | 是否提供 IDL，或显式标「契约待补」 |
| 真实运行数据 | 页面缺真实业务文案，影响可读性 | 是否有指定数据样本需注入 |

### 高保真硬性标准（路径 A 的验收线）

- **真实视觉容器**：移动端用真实业务视口还原首屏 Hero、Sheet 弹层或滚动卡片流、模块分割与吸底操作栏；业务导航与宿主安全区按所有权保留。系统时间/信号/电量默认不进入业务预览，完整外壳仅在用户要求或理解场景确需时单独呈现；坐标以业务区域核对，见 [范围提取](authoring-extraction.md)。严禁退化成与真实页面无关的通用 `page-header / page-body` 占位。
- **设计 token 化**：颜色、字体栈、圆角、关键尺寸集中声明为组件根上的 CSS 变量，不逐条硬编散落；值必须有设计稿或代码依据，禁止臆造。
- **媒体用渐变模拟，不用 emoji 占位**：基色 `linear-gradient` + `radial-gradient` 光斑 + `:before/:after` 伪元素纹理；每个媒体块给独立色调保持可辨识。emoji 仅用于确实是图标语义处。
- **字阶分级**：按设计稿的真实字号/字重/行高分级，不全页一个字号；字体栈显式声明目标产品字体并带 fallback，不裸用 `-apple-system`。
- **自包含内联样式**：`<style>` 置于 `pageHtml` 头部，无外部 CDN、无外链字体；图标用纯 CSS、内联 SVG 或 Unicode。
- **三层锚点完整度**：`data-component-id`（组件根）、`data-review-target` + `data-review-label`（每个独立业务卡片/按钮/指标项）、`data-api-field`（精准挂在渲染该字段的最小元素上，多字段空格分隔，严禁加在整个 section 上）。
- **契约缺口显式表达**：DTO 尚无的字段在 HTML 中显式展示 `—` / `契约待补` / 灰色占位，严禁伪造假数据。

样式取舍的默认值与 david pageHtml 的自包含例外（tailwind utility vs 内联 `<style>` + 唯一类名前缀）统一见 [authoring-components.md](authoring-components.md#样式与装饰取舍)。

## 高保真复刻与组件复用（对应 HARD-GATE 28）

高保真复刻的**首选路径是复用项目真实组件**，只有复用探测确认无对应组件时才降级到无代码 CSS art。每个 component root 用 `components[].source` 声明由来契约，消费者可直接判断「真渲染 / CSS 还原 / 概念示意」：

```yaml
source:
  kind: component | css-art | mockup   # 唯一取值
  codePaths: [<真实组件文件>]           # kind=component 必填（证据）
  probe: "<探测方式>"                   # 如 grep DataCard; 读取渲染分支
  fidelity: pixel-vs-real | structure | approx
```

**复用探测与验收步骤**（动手前先探测，禁止跳过直写 CSS art）：

1. 探测：按 PRD / 方案对象名与 mapping 已给 `codePaths`，在项目源码 grep 候选组件名，记录 `probe`（命令 / 命中断言）；同时确认该组件的真实渲染产物或运行路径是否可获得。
2. 选路径：探测到真实组件且其渲染产物可对照 → **path B 真渲染**（`source.kind=component`，页面挂真实组件结构与对应样式）；探测失败 / 组件不存在 → **path A 无代码 CSS art**（`source.kind=css-art`），并显式标注 `fidelity=structure` 或 `approx`。
3. 验收：path B → 页面渲染与真实渲染基准（运行产物 / 授权截图）逐项对照，误差定性说明；path A → 只验证结构层级 / token 化 / 文字可读，**禁止声称像素级 1:1**。任何 `fidelity=pixel-vs-real` 都要求 `kind=component` 且有真实对照基准，无证据即禁止（schema 校验强制）。
4. 契约缺口：先查询已有代码/设计/IDL/资料库；仍缺且阻塞当前任务时按输入核查表确认，非阻塞缺口标待补并继续。沿用概念模式与已有授权，不静默猜测；伪代码 / 概念内容标注 example/proposal。

`source` 字段规则、`renderEvidence` / `renderRecipe` 与 `npm run probe:components` / `npm run capture:evidence` / `npm run capture:component` 证据采集命令见 [review-schema.md](review-schema.md)「组件来源契约」「真实组件来源与证据」。

## 事实与提案分离

每条信息必须归入其一，且文案可区分：

- **source fact（来源事实）**：来自代码、设计稿、IDL/DTO、PRD、运行证据；附 `evidence[]` 或 `codePaths`。
- **proposal（提案）**：agent 提出的实现/视觉/契约建议。概念模式默认全部是提案；保真模式仅证据缺口处允许提案，且必须显式标注。

禁止把提案写成既成事实，禁止用字段名猜接口能力。后端接口缺失时的扁平契约提案（`apiContracts` + `status:"proposed"`）见 [authoring-data.md](authoring-data.md#扁平契约)。

## 改动预览的表达

- **UI 改动**：基于真实实现提供可深入的界面走查——从已实现源码重建界面评审节点，示例数据明确标注，保留同一 David 评审交互；不要只复述需求。
- **纯逻辑改动**：预览画系统上下文 / 模块作用 / 受影响节点的逻辑图，标清本轮改动在整体逻辑中的位置与修改的部分；不再把需求段落重写一遍。
- **深层实现**：用真实代码摘录或明确标注的伪代码具体解释关键分支（输入 / 条件 / 结果），而不是复述概述。
- **源码分段解析**：原源码保留一个代码块及连续行号；使用 `techPoints[].codeAnnotations` 标注行范围，hover/focus 时段内背景高亮与浮动解释卡联动，禁止拆成多个源码卡片或长期占用解释侧栏。
- **浏览器交付清理**：若原生页面残留自动化注入的指针层，先确认 DOM 来源并在交付前清理；不得把自动化覆盖层固化进评审产物或用业务 CSS 掩盖。
- 事实与提案 / 示例的区分在以上表达中同样适用。

新增 / 改动 / 删除的结构化表达（`changeBlock`）见 [review-tree.md](review-tree.md)「change block 改动表达」。

## 硬件视口约束

用户提供真实设备视口（如 `393×852 @3x`、安全区）时，`pageHtml` 的预览容器必须遵守该精确约束（宽高 / DPR / 安全区），并在评审中点名违反约束的设计（点击热区过小、文案截断、吸底遮挡等）。未提供时按通用移动端/桌面容器生成，不臆造机型；此时长 UI 用可滚动的预览窗口保持内容可读，不把整页压成极小文字——有设备约束时仍以真实视口为准。
