# David 功能模块

这些模块通过 `@david/*` 直接引用原 David TSX；`mods/<id>/src` 只保留适配入口。使用页接收预构建 ESM。普通 HTML 内核不依赖 React；独立插槽共享 react-runtime，完整工作台在独立文档中运行原 App 与它自己的 React。

| mod                  | 功能与输入                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-runtime`      | React / ReactDOM / JSX runtime 共享提供者；依赖自动加入，无可见插槽                                                                                                          |
| `rich-code`          | 原 CodeBlock：`{code,codeLabel?,annotations?,highlights?,symbols?,lineNumbers?}`；`+ ` 改动行、`~ ` 埋点折叠、行范围批注                                                                                       |
| `code-diff`          | 原 DiffCodeBlock / ChangeRationale：`{kind,rationale,before?,after?,impact?}`；kind 为 add/modify/remove，代码侧 `{lang,code}`                                               |
| `rich-content`       | 原富文本与产品/技术段落：`{text?,sections?,points?,modules?,deepDive?}`；渲染展示，源内容仍由 Agent 修改                                                                     |
| `api-contracts`      | 原字段契约面板：`{contracts:[{id,status,request?,response?,...}]}`；status 为 proposed/confirmed。字段 `{name,type?,meaning?}`。同时提供共享字段联动通道；无插槽时只提供通道 |
| `logic-canvas`       | 原 LogicCanvas：`{graph:{nodes,edges},label?}`；节点选择、拖动缩放、适应内容                                                                                                 |
| `code-flow`          | 原 CodeFlow：`{graph,points,modules?}`；graph 节点 id 引用 points 中的 id，点选多段代码                                                                                      |
| `research-workbench` | 原 LogicCanvas / CodeBlock / 评论组件的问题式调研布局；输入 `icarus-research/v1`，见 [研究工作台](research-workbench.md)                                                     |
| `review-workbench`   | 原 App、hooks、CSS、评论列表与框选；输入原 David review JSON 或 `{spec:原JSON}`。自行携带运行时，无额外 provider                                                             |
| `open-questions`     | 原待确认项面板：`{questions:[{id,topic,status,prd?,design?,conflict?,options?,recommendation?}]}`；status 为 open/resolved                                                   |
| `preparation`        | 原准备清单：`{id,title,tasks:[{id,label,detail?}],fields:[{id,label,value?,placeholder?,required?}]}`                                                                        |
| `design-materials`   | 原资料面板：`{pages?:[{id,label}],activePageId?}`；PNG/CSS 上传、分组、预览、默认本机通道持久化                                                                              |
| `review-theme`       | 可选颜色主题。无插槽；用 options `{theme:"paper"或"dark",tokens?:{ink:"#..."}}`，只作用于独立插槽，不覆盖原工作台 iframe                                                     |

原有 `code-notes` 与 `react-island` 继续保留。`react-island` 用于宿主自己提供 React 和真实组件的场景；这与共享 runtime 模式分别使用。业务 React/TSX 源码可构建为新的 mod，不能直接把未编译 JSX 放进 JSON。

工作台的组合子组件与独立 mod 插槽不是同一个开关：关闭独立 `rich-code` 不会移除工作台详情里已组合的代码显示。完整工作台直接使用原 React 评论与选区组件，纯 HTML 则使用内置评论界面；两者共用默认 Icarus 服务与存储。原提案采纳/否决使用原模型，Agent 回复不自动完成评论。未自动导入旧 David daemon 历史。

## 在模板中放置功能

解释、调研、知识问答优先用 `research-workbench`，具体 Mock 与展示条件放在同一问题。真实节点悬停读取 description，代码批注读取 annotations；不能只造相似外观。

用户要求 David 原来的完整 TRD 评审体验时，以 `review-workbench` 作为页面主体：每个独立问题放入 `spec.pages[]`，用明确的 `data-component-id` 关联该页的逻辑与右侧说明。保留原组件的页面切换、左侧画板、右侧总览/详情、逐层钻取和字段联动。代码、资料、模拟器等扩展放到相关详情或工具面板，不把工作台埋在长文章底部，也不以“所有 mod 已挂载”代替布局与内容归属验收。工作台只允许一个根插槽，多页放入原 App 的 pages。iframe 保留原样式与事件文档，宿主 CSS 不覆盖工作台。

`data-component-id` 的根节点要有自足的样式作用域；组件被克隆到左侧 dock 后不再拥有原 pageHtml 的祖先容器。验收时同时检查总览和点击后的详情预览，避免只在总览正常、进入组件后字体或 SVG 尺寸失效。

读者界面只保留画板正上方的单组分页；不要再增加第二组 tab、导入 JSON、扩展状态或模拟/Mock/证据工具条。缩放控件定位在所属画板内。研究信息、代码和接口通过右侧内容与相关详情承载；默认评论采用右侧卡片栏，与本机 Agent 通道保持同一份数据。

验收需覆盖真实交互链：深层节点同级切换与返回、跨页指定节点、文本输入时快捷键避让、框选时缩放禁止、同名字段只联动所属画板、模块卸载清理。不要只检查首屏或挂载数量。

默认匹配 `div[data-icarus-<id>]`。对应 JSON 放在该 div 的直接子 script，避免将可执行脚本放进配置：

```html
<div data-icarus-rich-code>
  <script type="application/json" data-icarus-props>
    {
      "code": "const amount = 1;\n+ render(amount);",
      "codeLabel": "TypeScript",
      "annotations": [
        {
          "startLine": 2,
          "endLine": 2,
          "title": "更新视图",
          "bullets": ["只更新金额区域"]
        }
      ]
    }
  </script>
</div>
```

生成 JSON 时把 `<` 转为 `\u003c`，防止代码中的 `</script>` 提前结束配置标签。也可用 `--options /path/options.json` 提供 `{ "rich-code": { "selector":"#my-slot", "props":{...} } }`。

```bash
icarus mod install /absolute/rich-code.zip
icarus attach /absolute/source.html /absolute/review.html
icarus mod enable /absolute/source.html --mods rich-code,review-theme --options /absolute/options.json
```

安装会补齐满足版本的共享依赖，来源为已安装模块、本地 workspace 或随 Skill 发布的固定 catalog。离线传播多个 ZIP 时先安装 `react-runtime.zip`；`review-workbench.zip` 自行携带原 App，不需要这些 provider。远端尚未发布时使用本地 ZIP 或目录，不声称 npm 已可下载。

安装只让代码可用；`attach` 或 `enable` 才会加载。`enable --mods` 是完整目标集合，不是追加。需要向已打开的原生模板增加插槽时，Agent 先改原 HTML 并重新 attach；仅切换已有插槽的 mod 不重载页面。没有插槽时可通过 options.selector 指向现有容器。

## 状态与 Agent

评论与资料都走默认本机服务：

```bash
icarus feedback get /absolute/source.html
icarus mod data /absolute/source.html design-materials
```

资料返回带版本的 JSON，包含 groups/items/contents，支持 Agent 检查 PNG 元数据与 CSS 原文。传输失败保留资料上传草稿；CAS 防止并发覆盖。准备清单和待确认项的查看者标记沿用原功能的浏览器本地状态，不是提交给 Agent 的评论；需要 Agent 修改时仍用框选评论。

未变化的 mod 在热更新时保留 React root。卸载会释放该 mod 的 DOM、样式、Portal、监听器和请求；再次加载恢复已持久化内容，未提交的模块内部临时状态不承诺恢复。纯 HTML 核心评论草稿不受影响；原工作台内部表单需要先保存再替换或卸载。

## 新增的独立 Mock 模块与源码组合

`mock-cases` 使用 `[data-icarus-mock-cases]` 插槽，输入 `{id,cases:[{id,label,note,payload,previewHtml?}]}`，提供场景选择、原 CodeBlock JSON 和可信模板预览，可独立安装/装卸。研究工作台经其公开源码入口复用；`logic-canvas` 和 `rich-code` 同样提供公开入口。具体边界、构建联动和装卸语义见 [Mod 实现规范](mod-implementation.md)。

`resource-cards` 使用 `[data-icarus-resource-cards]` 插槽，输入 `{resources:[{kind,title,fields,status?,links?}]}`。独立 ZIP 可启停；研究工作台从其公开入口组合。`logic-canvas.nodeBadges` 兼容单个字符串与字符串数组，用于前后端与服务类型标签。

代码符号配色由 `rich-code.symbols` 声明共享名称列表，Input/Output 使用固定独立颜色，其余按列表顺序循环固定调色板；新增名称追加到列表。研究 JSON 的 `questions[].symbols` 同时应用到契约摘要和源码。正文画板的 `FoldableLogicCanvas` 属于 `logic-canvas`（独立插槽设 `foldable: true`），工作台只维护选中数据和布局。
