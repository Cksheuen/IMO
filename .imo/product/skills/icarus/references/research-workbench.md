# 按业务链路组织调研

在写研究内容前先读 [以读者理解为验收目标的研究规范](understanding-oriented-research.md)。研究页的验收目标是读者能够复述“输入从哪里来 → 如何变化 → 输出是什么 → 最后在哪里可见 → 失败时怎样”，不能只依赖画板箭头或 hover 说明。

需要解释业务链路、架构或概念时使用 `research-workbench`。需要 TRD 映射表、页面组件钻取和方案决策时使用 `review-workbench`。二者是不同的页面主体，不在同一页同时挂载。

研究工作台使用原 David 的 LogicCanvas、CodeBlock、CommentRail、SelectionList、框选与反馈 hooks；仅新增研究组合布局。不要以普通 HTML 方块模拟 LogicCanvas，也不要以 pre 标签模拟富代码。每个图节点填写 `description: string[]`，代码按语义段填写 `annotations`；否则原组件没有可显示的悬停说明。

```html
<div data-icarus-research-workbench>
  <script type="application/json" data-icarus-props>
    {
      "schema": "icarus-research/v1",
      "slug": "research-topic",
      "title": "业务调研",
      "pages": [
        {
          "id": "entry",
          "label": "入口",
          "questions": [
            {
              "id": "display",
              "title": "什么条件下显示？",
              "answer": "条件满足时显示入口卡片。",
              "findings": ["完整条件由源码和接口证据支持。"],
              "graph": {
                "nodes": [
                  {
                    "id": "gate",
                    "label": "显示条件",
                    "column": 0,
                    "row": 0,
                    "description": ["接口对象存在才进入列表。"]
                  }
                ],
                "edges": []
              },
              "explanations": {
                "gate": {
                  "title": "显示条件",
                  "layer": "frontend",
                  "inputs": ["接口返回的 prompt 对象"],
                  "outputs": ["visible 布尔值"],
                  "summary": "按对象存在性判断是否显示入口。",
                  "codeIds": ["check"]
                }
              },
              "codes": [
                {
                  "id": "check",
                  "title": "条件判断",
                  "language": "JavaScript",
                  "code": "const visible = Boolean(prompt);",
                  "annotations": [
                    {
                      "startLine": 1,
                      "endLine": 1,
                      "title": "对象门槛",
                      "bullets": ["以接口对象存在与否判断。"]
                    }
                  ]
                }
              ],
              "evidence": []
            }
          ]
        }
      ]
    }
  </script>
</div>
```

同一业务链路放在一个 `question.graph`，不要按前端、后端或拆开的子问题建立切换 tab。四类主议题仍可由 `pages` 区分；页面仅有一个 question 时自动隐藏子 tab。旧多问题数据仍兼容。

`answer` 是短结论；`readingGuide?: string[]` 是结论下默认可见的连贯正文，每段可直接评论。不点画板也要能读懂用户给出的实例；节点点击再展开代码与局部细节。`details` 继续放非必读的补充说明。

正文较长时用 `readingSections?: [{id, title, paragraphs?, items?, table?}]` 替代连续长段，工作台通过 `rich-content` 公共入口渲染。`table` 是 `{headers: string[], rows: (string | {text, href})[][]}`；文字支持安全的 `<code>`、`<strong>` 行内标记。节点的 `inputSources` 使用相同结构，在入参契约旁说明字段来自哪个文件的哪段逻辑。来源行应包含函数名、文件行号链接及简短赋值/回退说明。旧 `readingGuide` 继续兼容，迁移时用 `targetAliases` 保留原段落选区。

节点所有的 `cases` 在对应出参处直接显示。选中所属节点或其出参时定位到示例，不默认藏入关闭的折叠区；未选中和无关节点不显示该示例。验证必须检查示例与 JSON 的实际可见性、场景切换和视口位置，不能只检查 DOM 数量。

每个节点通过 `explanations[nodeId]` 拥有独立解释：`{title, layer, inputs, outputs, summary, codeIds, findings?, evidence?, cases?}`。`layer` 为 `frontend | backend | contract | infrastructure`，用于显示标签；入参和出参必须是非空字符串数组，显示在正文开头。前端、后端等标签显示在画板节点右上角，节点高度随标签调整，解释标题不重复标签。按职责划分节点，一个节点可拥有多个相关源码片段；同一 question 内一段源码只能属于一个节点，不能多个节点重复指向同一整块解释。每个节点（包括无代码节点）都要有解释，缺项、悬空或重复归属会校验失败。追踪真实请求、服务和字段来源；动态配置、未定位的中间链路与未执行的线上结果明确标注，不能用推测连接冒充源码证明。

每个执行节点的正文至少补足四件事：它接收的真实字段、这一步改变了什么、下游实际拿到什么、页面或运行时最终展示什么。容易混淆的字段就近对照其来源、具体值和用途；配置源、运行时 RPC、响应字段和 UI 文案不能合并成一句“由后端下发”。

入参、出参可以提供 `contracts: { inputs, outputs }`，每项是 `{language, code, annotations}`，复用原 CodeBlock 展示类型及字段悬停说明。两项必须同时提供，代码与批注按原校验规则检查；已有 `inputs` / `outputs` 字符串数组供旧内容回退。新研究内容优先使用有类型的契约；忠实保留可选性和真实字段类型，组合描述标为“节点类型摘要”，不要冒充完整 SDK / IDL 或凭空新增接口字段。每个参数的 hover 仅说明简短含义，生产/读取/消费位置放在关联源码及证据中；区分调用入参、依赖配置、返回值及写入副作用。抽象字段名应标明对应的源码语义。选区锚点为 `contract:<nodeId>:inputs|outputs`，评论定位会恢复节点后定位对应契约。

点击节点可多选，再次点击取消；不在画板顶部重复提示或提供额外清空按钮。画板可向左收起；画板与评论栏收展时正文宽度平滑过渡，减少动态效果模式取消动画。右侧按画板有向链路顺序展示多个原 CodeBlock 与解释。切换页面/问题/图时清除选择。`nodeCode` 是旧数据兼容方式；新数据使用 `explanations`。旧代码多节点绑定会去重显示，并明确入参与出参未标注。

`pages[].id` 与页内 question id 稳定且唯一。`aliases` 保存旧 question/component id；`targetAliases` 将迁移后的旧 `logic:*`、`code:*` 等 target 映射到当前 `node:*` / `code:*` 等真实锚点。评论定位先恢复所属页面和全部选中节点，再定位目标；被移除且无有效映射的目标提示失效。可选 `dependencyGraph` 仅用于实际文件引用关系，禁止将运行时顺序冒充 import；与逻辑图复用画板。缩放工具浮在完整画布上，不占用单独布局列。正文代码保留完整函数与缩进，来源随节点提供。

问题可以有 `cases: [{id,label,note,payload,previewHtml?}]`。显示条件、样式、Mock 和边界情况放在同一问题；提供可查看、下载的具体 JSON，注明示意预览与已验证运行结果的差别。预览 HTML 只能来自用户授权的本地可信内容，不接受评论内脚本。

正文优先于画板承载读者必须理解的语义。主画板只表达模块边界、分支和交接；子画板只展示自己的链路。不要让读者通过箭头方向猜测字段含义、fallback 条件或 UI 位置。

工作台只显示一组页面 tab、问题切换、左侧画板、右侧解释与评论栏。缩放属于画板。反馈面板保留选区、修改意见与提交；已有条目由评论栏统一显示。删除评论需要确认，删除选区支持失败后重试；操作通过默认本机通道落盘。删除记录在本机 journal 保留，以防旧请求恢复；不是物理擦除。旧 David 服务未声明 `feedback-delete` 能力时，不展示不受支持的删除操作。

```bash
icarus mod install /absolute/research-workbench.zip
icarus attach /absolute/source.html /absolute/review.html --mods research-workbench --no-auto
```

独立包包含原 React 组件和样式，不依赖本机 David 源码或额外 React provider；关闭此 mod 后回到 HTML 内核。工作台组合内的原组件不受同名独立 mod 开关控制。评论交给 Agent 修改后保持 open，由用户复核。

仓库验收：`npm run test:research` 使用通用 fixture；生成或更新研究产物后先运行 `npm run validate:research -- /absolute/research-spec.json`（也支持直接校验 `source.html`），再执行 `node tests/research-workbench.mjs /absolute/research-spec.json` 回归当前研究产物（单链路与旧多问题结构均支持）。发布隔离验收覆盖 npm/ZIP 独立安装。校验失败时研究 iframe 会显示具体错误，评论仍保留在 Icarus 本机服务中，不再静默留白。

代码批注按语义段划分：一次条件判断、对象创建、配置读取、赋值或一次独立调用各自说明本段职责。不要把多阶段函数全部标成一个 annotation，也不要在每个局部批注里重复整条业务链；单一职责的短包装函数才可整体说明。对象新建、指针引用、缓存复用、数据获取需按源码分清。内部配置链接应记录查询站点、命名空间和 key；查询受权限限制时明确缺口，命名空间导航入口不能冒充已获取的配置详情 URL。

### 类型定义、资源说明与语义颜色

参数 `contracts` 的 hover 只写简短含义，不堆叠来源路径或解释性注释。复杂类型的真实定义直接追加到对应 `contracts.inputs.code` / `outputs.code` 中，和入参／出参共用一个 CodeBlock；每个类型定义前用 `// 定义来源：文件:行号` 标明来源。保留简短字段 annotations，并按拼接后的实际行号偏移。不要再单开“复杂类型定义”代码组件；`definitionIds` 仅兼容旧数据。迁移旧定义时用 `targetAliases` 将旧 `code:<id>` 映射到对应 `contract:<node>:inputs|outputs`，保留评论定位。

节点可携带 `resource: { kind, title, description, fields: [{ label, value }], notice?, href?, linkLabel?, afterCodeId? }`，用统一资源卡片展示配置、存储或其他依赖。通过 `afterCodeId` 把卡片放在直接消费该资源的代码块下方，方便就近对照；直接显示名称等基础信息，不重复堆叠概念介绍或核验过程。`description`、`notice` 可省略；必要的来源和权限边界放在“来源与边界”中。不为一张资源信息卡额外拆出图节点。提供 `href` 后，资源名称与明确的跳转链接在新页打开对应平台；仅允许 HTTP(S) 地址。真实值无法读取时在 `notice` 说明，不编造配置值。

问题可携带 `highlights: [{ kind: "tcc", label: "TCC 配置", tone: "violet", tokens: ["tcc.Conf.PromptCandidates()"] }]`。规则按字面 token 匹配；同位置重叠取较长 token，顺序用于打破同长平局。`tone` 支持 `violet/blue/green/amber`，最多 16 个唯一分类，每类最多 24 个 token。分类名无需改动 React；例如增加 `rpc-call` 即可标识 RPC 调用。高亮不改动代码文本、复制内容或注释行号。

### 函数关系与源文件行号

需要解释多函数协作时，可在节点的 `functionGraph` 中提供原 LogicCanvas 图。每个函数节点的 `id` 必须对应本节点 `codeIds` 中的源码；点击可多选并显示相应代码。`groups: [{ id, label: "目录/文件.go", nodeIds: [...] }]` 给同文件的函数加外层边框；每个函数只能归属一个分组。边须区分直接调用（control）、数据传递（data）和配置/模块依赖（dependency），不能把先后执行冒充直接调用。旧评论定位会恢复函数选择。

`ResearchCode.lineNumbers` 和契约的同名字段可提供逐显示行的真实源文件行号。数组长度与 `code.split("\n")` 相同；`null` 显示为 `—`，用于说明文字、合成摘要或无法对应的摘录行。必须核对实际源码，不能仅凭片段起点给改写/拼接代码连续编号。`annotations` 和 `data-line` 仍按片段的相对行定位，不因展示原始行号而偏移。

主逻辑画板可用标题旁的左箭头收起，在左边缘用右箭头展开。收起时保留选中节点、函数与已展开内容；定位画板节点时自动展开。中间正文填满可用宽度，评论栏收起释放的宽度优先给正文，不保留最大宽度空白；窄内容区域自动改为上下排布。

主图解释和函数源码均按有向边的上游→下游排序，独立分支按画板位置排序；循环关系按位置稳定展开。排序与点击先后无关。

## 服务依赖和字段转换

- `explanations[nodeId].resources` 支持多个资源卡；`afterCodeId` 必须属于当前节点。资源卡由独立 `resource-cards` mod 提供，旧 `resource` 仍兼容。
- `serviceTags` 最多四个，例如 `PSM / TCC / RDS / FaaS`，与前后端标签并列。
- `handoffs` 必须对应真实图边，明确 `mapping`、额外的 `extraInputs` 和 `kind: data / control / dependency`。不要将持久化关联画成同步调用，也不要把前一节点整份输出当下一节点全部输入。
- `transformations` 用 `input / operation / output` 描述节点内变换。多函数逻辑补 `functionGraph`，用 `entryFunction` 标记和默认选择对外主函数；其他阶段的导出函数不能画成主函数内部调用。
- 部署状态区分实例存在、业务数据和 ACL 就绪。区域未定或没有读取权限时保留 `unknown / partial`，不要把无权限误写为未部署。业务资源、区域和命令证据留在 HTML/spec，禁止写死到 mod。

转换过程默认与函数/文件关系合成一张画板，不再绘制转换表格。`transformations[].functionIds` 可绑定该节点函数图中的一个或多个真实函数；输入和输出作为数据节点，源代码调用边保持原语义。没有函数图时绘制输入→处理→输出，处理节点不虚构函数名。点击数据节点可联动其绑定函数源码。原 `lineage:` / `functions:` / `code:` 评论锚点继续兼容。

该无函数图回退只兼容旧数据，不满足“结合文件与函数解释转换”的验收。此类研究中，每个执行节点都必须提供 `functionGraph`、`entryFunction`、源文件 groups 和有 `functionIds` 的 transformations；所有归属源码都进入图中，常量/注册表/Mock 明确标为声明或样例，不能冒充函数。源码保留真实路径和行号；摘录明确标注所属函数/回调，未展开的中间调用用边标签注明，不能画成直接调用。初始化、运行、UI 事件和 effect 必须分清。每个非空代码行必须落在至少一个可 hover 的语义批注范围内；空行不触发 hover，批注范围不能从空行开始或结束。

函数图箭头只有一个语义：`a → b` 表示代码执行顺序。字段传递、函数调用、依赖准备等差异写入边标签、节点说明或数据契约，不通过 `kind` 改变箭头方向；数据节点也按“输入后处理→处理后输出”的顺序连接。工作台在画板标题下显示这条规则，跨页审计和浏览器验收必须检查边标签与顺序一致。

资源部署清单等非执行节点使用 `flowExclusion: "不适用原因"`；它不能与 codeIds、transformations 或函数图同时存在。不要为资源状态虚构调用过程。仓库提供 `node scripts/audit-research-flows.mjs <research-spec.json> [coverage.json]`，遍历全部页面/主图/依赖图并记录 covered/excluded/gap。执行节点缺主函数、文件分组、来源或转换绑定都会失败；非执行节点无排除理由也失败。该审计只证明结构覆盖，源码语义与真实交互仍需核对。整页回归可使用 `node tests/research-workbench.mjs <spec.json> --require-function-flows`，逐节点验证函数选中、主函数标记、文件分组、hover 和对应代码。
