# 数据职责、契约与待澄清项

修改字段、数据状态、接口或待确认项时使用。字段形状见 `project/src/types/review.ts`，不向 review JSON 塞入本页工作检查所用的自定义键。

目录：[职责判定](#职责判定) · [必要字段](#必要字段与唯一承载) · [扁平契约](#扁平契约) · [契约迁移](#契约迁移) · [待澄清项](#待澄清项)

## 职责判定

对影响本次实现的数据/状态先确认：谁提供初值、谁响应交互、是否持久化、当前是否启用。按来源决定归属，不把单项目“后端控制”的结论推广为全局默认。

| 信息 | 归属与取舍 |
|---|---|
| 后端实际提供/接收的数据或初始配置 | `apiContracts.request/response`；未确定的最小诉求标 proposed |
| 用户操作产生的 FE 状态 | 所属功能 `trd.technical`；只有契约要求回传/下发才同时进入 API |
| adapter / ViewModel 派生值 | 对应功能的技术代码或 API/数据说明区；写清来源与变换，不伪造后端必填字段 |
| 常量或纯展示约束 | 有依据的业务常量按需说明；两行截断、间距、圆角由组件/设计承载，不成为 DTO 字段 |
| 已实现但未接入的备用逻辑 | 与当前生效路径分开；仅有评审意义时说明，不在预览中自动启用 |

例如后端提供初始展开状态、前端响应点击展开/收起，这是两个责任；不能据此自动新增前端频控。`selected` 是否是服务端字段需查契约，不按名字判断。字段缺省、空值和默认行为仅在影响业务且有依据时说明；接口缺口按下述“后端方案到位后的评审”处理；其他无法查明的必要决策进入待澄清项，不补无依据的缓存或 fallback。

## 先核对现有配置能力

- 新增展示项、文案、开关、排序或地区范围前，沿「配置源 → 后端装配/过滤 → 接口 → 前端消费者」核对现有能力。通用消费者已覆盖时，方案明确复用，不额外生成前端分支、硬编码或无关治理改造。
- 配置更新本身就是完整实施项：给平台/key、对象路径、字段值来源和生效结果即可。不要为使方案看起来有代码而补前端注册文件或重写已能消费这些字段的组件；相同配置驱动的一行内容合并说明。
- 可配置的改动给出配置平台/PSM/key、对象路径、真实字段、取值来源、登记/生效方法，以及读写接口与验证点；精确源码路径放引用。未确认的注册值使用占位并标注，不能虚构枚举、RPC、线上配置或热更新机制。
- 区分展示配置和业务状态：配置能新增行不代表下游授权/存储已实现；专属跳转等超出现有消费者的需求须有明确依据才补最小前端改动。已有缺陷或假设风险不自动成为本次必改范围。
- 字段控制能力须落到具体消费者：类型白名单决定是否展示、前端 schema 分支决定目的地时，写清两处改造与所消费的 HTTP 字段；不能把“已有组件”表述为“后端配置后可直接复用”。

## 必要字段与唯一承载

- 从全部可见动态内容列出最小数据诉求；完整标题、商家/主播身份、头像、图标、媒体和跳转按消费功能核对，不把动态标题只拆出数字。
- 数组/对象给元素类型和必要子字段，例如 `products: ProductItem[]` 与 `products[].product_id/cover_url`；或者指向已读取的明确类型定义。不能把 `array` 换为 `ProductItem[]` 就结束。
- 同一契约内统一字段路径前缀；嵌套用完整路径，如 `sellers[].products[].product_id`。不同消费者复用同一契约，不复制相同字段全表；不同原文、类型或语义的证据不能静默合并。
- 后端字段放契约，消费者用 id 引用。已有 `api.fields`/`trd.apiChange` 与新契约同时存在时，去掉名称、类型和含义完全一致的重复展示，保留必要定位与独有证据。
- Mock response 不全文输出；只有不举例就无法理解时给最小示例并标注。proposed 徽标已表达待确认，不给每个契约重复通用免责声明，notes 只写独有差异/来源/迁移决定。
- 用户要求 Mock JSON 时使用代码富文本的最小对象或片段，按字段分别配置 `codeAnnotations`，解释数据来源、类型与消费行为；不能把整块字段归成一个笼统 hover。登记值未确定时明确标出 Mock 值，不将示例枚举/资源 ID 当成真实注册结果，也不把未改动的消费者另拆为实施项。

## 扁平契约

后端尚未提供接口时，顶层 `apiContracts` 写可讨论的最小预期契约，mapping 用 `api.contractIds` 引用。资料未提供 endpoint、method、请求参数时直接省略；proposed 不表示允许无依据补齐协议，只有用户要求讨论接口设计时才提出有理由的候选。required/type 依证据或明确提案填写，不能因空值视觉待确认就认定后端允许空值；已有类型只作参考，不证明后端会复用旧接口。

- `status` 为 `proposed | confirmed`；提案在契约面板、TRD 与导出都应可识别，只有真实来源确认才转 confirmed。
- `api.summary` 只在有独立概述时填写，不重复契约标题。浅层没有独立摘要就省略 `overviewSummary.api`，保留详情的完整契约。
- 有 UI 消费者的字段，`name` 精确匹配最小元素上的 `data-api-field` token；契约字段不支持 `target`，旧 `api.fields.target` 仍兼容。纯请求字段只说明调用用途，不为凑锚点绑定无关 UI。
- 契约与该功能的代码富文本并排，代码未展开时契约仍可读；字段与页面双向高亮。结构数据不另建仅汇总字段的 component。

下例为完整、可解析的概念 spec，仅演示金额展示的数据诉求；真实 endpoint 和请求参数未知，因此不填写，字段名仍为提案。

```json
{
  "slug": "ticket-contract-example",
  "title": "确认核销契约示例",
  "subtitle": "待后端确认的最小契约",
  "pageHtml": "<section data-component-id=\"ticket-panel\" data-review-target=\"ticket-panel\" data-review-label=\"核销面板\"><span data-api-field=\"discount_text\" data-review-target=\"discount-text\" data-review-label=\"优惠金额\">—</span></section>",
  "apiContracts": [
    {
      "id": "cpt-ticket-confirm",
      "status": "proposed",
      "title": "核销金额展示",
      "response": [
        {
          "name": "discount_text",
          "type": "string",
          "meaning": "满减优惠金额文案"
        }
      ]
    }
  ],
  "components": [
    {
      "id": "ticket-panel",
      "label": "核销面板",
      "mapping": [
        {
          "id": "m-confirm",
          "requirement": "确认前展示优惠金额",
          "change": "核销面板新增优惠行",
          "api": {
            "changed": true,
            "contractIds": [
              "cpt-ticket-confirm"
            ]
          }
        }
      ],
      "source": {
        "kind": "mockup",
        "fidelity": "approx",
        "probe": "本规范的概念示例，无真实组件或接口证据"
      }
    }
  ]
}
```

## 后端方案到位后的评审

- 更新接口定义只调整数据绑定与消费契约，保留已确认的组件样式。后端返回的选择对象按需透传，不因 IDL 存在 level 等字段就额外设计层级分支。
- 只讨论当前页面真正消费的缺口：未生成 IDL 的通用编码/命名差异、未使用的版本或控台文案不作为阻塞。后端控制数量而没有向前端下发限制值时，完整消费回包，不自行硬编码数量上限。
- 直接更新原 `apiContracts` 的真实字段、类型、路径及消费引用，不保留已被真实协议替代的预设 VM 字段表。不要把前端格式化、图标颜色、派生值重复要求后端下发。
- 契约和字段可设置 `provision: "backend-defined" | "existing" | "missing"`。字段缺省继承所属契约；本次后端已定义内容显示来源标签并正常渲染，已有协议正常显示，确实未提供的必要补充字段用 `missing` 红色展示。旧 JSON 缺省保持原样。
- 缺失字段的建议名称、类型必须标明是补充需求，不冒充已确认 IDL。已有字段仅缺单位、取值或语义时保持正常色，在含义中说明，不能误标字段缺失。新接口不覆盖某页面时明确接口适用范围，旧类型存在不代表本次已确认接入。
- IDL 缺口直接绑定相应功能创建 Agent 评论；已有同类 Agent 评论则更新原评论。评论只用有序列表逐项写“完整字段路径 — 缺什么/用于什么”，语义缺口写“字段已有，缺少某项约定”。不另建 openQuestions、不重复长背景、不重开评论；不改用户评论或人审状态。
- 评论和契约一一对应；评论只列差异，API 区承载完整必要契约。契约更新后同轮执行[评论与当前方案对账](feedback.md#评论与当前方案对账)，清除 Agent 正文中过时的缺失断言；仅写回复或改状态不算正文同步完成。所有来源共用评论列表，通过 Agent 标签区分。

## 契约迁移

`contractIds` 只稳定关联契约，字段定位仍依赖字段名，不能承诺改名时“只改 contract”。

1. 保持 contractId、pageId、component/node id 稳定；按真实来源更新 status、endpoint、字段和必要说明。仅 status/endpoint 变化、字段不变时可只改契约。
2. 字段名称、路径或结构变化时，核对所有引用该契约的功能；同批更新受影响 `data-api-field` token、旧 `api.fields`、技术代码/adapter 和必要文案。组件仍保留稳定定位，不重排无关页面。
3. 在候选完整 spec 校验引用，并对有 UI 消费者的新字段确认能定位、旧 token 无遗留；`parseReviewSpec` 通过不证明字段在 DOM 中命中。
4. 按 [authoring-incremental.md](authoring-incremental.md) 合并和渲染；没有 UI 消费者的字段记录实际用途，不制造假高亮。

## 待澄清项

PRD、设计和源码有冲突，或缺少证据且需要人拍板时，放顶层 `openQuestions`，由独立待澄清页承载；正文只写已确认事实并引用问题 id，不复制猜测。

- 使用稳定 `id`、`topic`、`conflict`。存在 PRD/设计证据时附 `prd + prdRef`、`design + designRef` 的简短摘录和位置；资料缺失就明确缺什么，不伪造另一方证据来凑字段。
- 给真实可选 `options` 和有依据的 `recommendation`；暂无推荐时说明待决定，不虚构备选方案。结构以 `OpenQuestion` 为准。
- 状态 `open | resolved`。用户决定后更新状态与结论，并增量更新受影响功能/契约；保留问题 id 与可追溯性。
- 概念模式的自由提案不是待澄清问题；已有来源能查明就先查，不把每个 proposed 字段再变成一个重复问题。工程待填写资料走 preparation。

片段示例和已有完整 fixture 见 [open-questions-contracts.example.review.json](../examples/open-questions-contracts.example.review.json)；只取其中片段时，合并回候选完整 spec 后再解析。
