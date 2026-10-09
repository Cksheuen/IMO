# 改动块与代码注释

## 改动块 change block

技术方案评审页的读者是技术人员，方案表达必须区分两类信息：

- **完全新增的内容**：说明新增原因与作用（为什么此前没有、加上后解决什么）。
- **改动 / 删除的内容**：给出改动前后对比，让读者一眼看到变化面，而不是在两段文字里自己 diff。

`changeBlock` 是承载这一表达规范的可选结构，可挂在两个位置：

- `components[].mapping[].changeBlock`（MappingRow 级，最常用）；
- `trd.{productDesign,technical,apiChange}.techPoints[].changeBlock`（技术要点级）。

### 结构

```yaml
changeBlock:
  kind: add | modify | migrate | remove # 必填，三选一
  rationale: string # 必填，为什么改；<= 800 字符，面向技术读者
  before: # modify / migrate / remove 必填；add 禁止
    lang?: string # 语言标记（TypeScript / Thrift / TSX …），存在按代码渲染
    code?: string # 代码内容，与 text 二选一
    codeAnnotations?: CodeAnnotation[] # 仅 code 侧可用；行号针对本侧代码
    text?: string # 纯文本内容，与 code 二选一
  after: # add / modify / migrate 必填；remove 禁止
    lang?: string
    code?: string
    text?: string
    codeAnnotations?: CodeAnnotation[]
  impact?: string # 可选，改动影响面，渲染为默认折叠区
```

一致性规则（`parseReviewSpec` 强制，非法即拒绝；实现见 `project/src/lib/changeModel.ts`）：

| kind | before | after | 语义 |
|---|---|---|---|
| `add` | 禁止 | 必填 | 新增内容：只渲染 after + rationale，左栏显示「新增内容」占位 |
| `modify` | 必填 | 必填 | 改动内容：逐行对齐的双栏 diff + rationale |
| `migrate` | 必填 | 必填 | 迁移副本：来源与目标实现对照，显示迁移标签；目标改动不修改原模块 |
| `remove` | 必填 | 禁止 | 删除内容：只渲染 before + rationale，右栏显示「删除内容」占位 |

其他规则：`rationale` 必填、非空白、最长 800 字符；每个 side 的 `code` / `text` 必须且只能二选一，值非空白；未知顶层字段（如手误写成 `reason`）直接拒绝，避免静默丢失改动表达。

### 三例

新增（`add`）——说明新增原因与作用，只给 after：

```json
{
  "id": "add-discount-line",
  "requirement": "结算页需要让用户在确认前看到满减优惠金额。",
  "change": "券核销面板新增一条满减优惠行。",
  "api": { "summary": "预览接口新增 discount_text 字段。" },
  "changeBlock": {
    "kind": "add",
    "rationale": "旧版只展示券名与有效期，用户确认前看不到优惠金额，客诉集中在“不知道能减多少”。新增优惠行把金额前置到确认动作之前，提升券核销转化率。",
    "after": {
      "lang": "TSX",
      "code": "<TicketCard ticket={ticket}>\n  <DiscountLine text={ticket.discount_text} />\n</TicketCard>"
    },
    "impact": "只读展示，不改核销写路径；discount_text 缺省时该行不渲染。"
  }
}
```

改动（`modify`）——左旧右新，双栏 diff：

```json
{
  "changeBlock": {
    "kind": "modify",
    "rationale": "旧埋点事件名写死，每新增优惠类型都要加事件与看板配置。改为通用事件 + coupon_type 参数后，新类型只需扩展枚举。",
    "before": {
      "lang": "TypeScript",
      "code": "track(\"ticket_confirm_click\", {\n  ticketId: ticket.id\n});"
    },
    "after": {
      "lang": "TypeScript",
      "code": "track(\"ticket_confirm\", {\n  ticketId: ticket.id,\n  couponType: ticket.coupon_type\n});"
    }
  }
}
```

删除（`remove`）——只保留改动前：

```json
{
  "changeBlock": {
    "kind": "remove",
    "rationale": "新设计以整卡置灰 + “历史券”分组表达过期态，红色角标属于双重标记，删除后过期语义仍完整。",
    "before": {
      "lang": "TSX",
      "code": "{ticket.expired && (\n  <span className=\"ticket-expired-tag\">已过期</span>\n)}"
    }
  }
}
```

### 渲染行为

- 徽标 + 正文（`ChangeRationale`）：kind 徽标三色——`add` 金 / accent、`modify` 蓝、`remove` 红灰；其下为 rationale 正文；`impact` 存在时渲染为默认折叠的 `<details>`「改动影响面」。
- 双栏 diff（`DiffCodeBlock`）：左 before、右 after，保留原始行号、等宽字体；真实增删行标红/绿及 `−` / `+`，对侧补空行，相同行等高，垂直滚动同步。code/text 均按行比较；窄屏保持并列并允许横向滚动。add/remove 只呈现存在的一侧及改动原因。
- 组件样式自包含：`DiffCodeBlock.css`（类名前缀 `dv-diff-`）、`ChangeRationale.css`（前缀 `dv-change-`），dock 克隆 / 富内容渲染不依赖外层祖先选择器。

### 与 codeAnnotations（hover 代码注解）的分工

两者都围绕代码，但回答的问题不同，不要互相替代：

| 维度 | `techPoints[].codeAnnotations` | `changeBlock` |
|---|---|---|
| 回答的问题 | 这段**现有代码**是什么意思、关键分支如何工作 | 为什么**新增/改动/删除**、前后差异是什么 |
| 形态 | 单块连续源码 + 行范围 hover/focus 解释卡 | 徽标 + rationale + 左旧右新双栏（或单侧） |
| 代码来源 | 真实源码摘录（保留原行号） | after 可以是新代码 / 提案代码；before 是被替换的旧实现 |
| 适用 | 解释既有实现，降低阅读门槛 | 表达方案设计决策与变化面 |

完整可渲染示例见 `examples/change-blocks.example.review.json`。

### 语义代码解析

每个原始 `techPoints[].pseudoCode` 保持单一完整代码块和连续行号；可选 `codeAnnotations` 提供 `{startLine, endLine, title, bullets}`。行号从 1 开始且包含两端，范围必须有序、不重叠且不超出源码；title 和 bullets 不得为空。函数、状态和组件属性的代码解读归入这些 hover 注释，不再重复平铺为需求点或代码外列表；产品行为与职责说明可使用多层有序列表。视图类型、入参及后端字段统一放到对应功能的 API/数据区。

hover 或键盘聚焦标注段时，只改变对应行的背景，并显示浮动解释卡；不把一段原源码拆成多个代码组件，不为解释长期预留侧栏。复用同一个 CodeBlock 渲染器。Escape 优先关闭解释卡，外层滚动或窗口变化时收起。
