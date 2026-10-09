# 前端基础组件库与富渲染分层

> 适用场景：在 david 运行时代码（`project/src/**`）中新增交互面、渲染器，或做展示层目录重构时查阅。这是 **david 渲染器工程本身**的实现规范；评审产物 `pageHtml` 作者侧的样式取舍见 [authoring-components.md](authoring-components.md#样式与装饰取舍)。

## 基础组件库唯一来源（对应 HARD-GATE 35）

- 新增交互面（弹层、折叠区、紧凑标签、图标按钮、工具条）必须优先复用 `project/src/components/ui/`（`Chip` / `IconButton` / `Modal` / `Toolbar` / `ToolbarGroup` / `Disclosure`，样式 `ui.css`，类名前缀 `dv-ui-`，复用 index.css 主题 token）；不得在业务组件内重复实现等价控件或新造前缀。
- `Modal` 统一 body portal、backdrop/Esc 关闭、焦点回收与 Tab 陷阱；`Disclosure` 是原生 `<details>` 封装。
- 富文本渲染器分层在 `src/lib/richContent/`（text/code/chips/trd/api/cross/deepDive/change/overview + `index.ts` barrel）；外部只从 `../lib/richContent` 导入，barrel 导出签名是对外契约，不得回退成单文件。

## 展示层纯结构重构（对应 HARD-GATE 36）

- 展示层目录拆分（richContent/、comment/、feedback/、canvas/）必须保持行为、DOM 结构、类名与锚点不变：`data-review-*` / `data-feedback-*` / `data-component-id` 锚点不得回退。
- 评论 author 徽标经 `comment/CommentAuthor` 组件化输出，禁止退回正文文字前缀。
- 删除被目录替代的旧文件时，同步更新脚本中指向该文件的**显式带扩展名** ssrLoadModule 路径。
- 回归验证：`node scripts/test-a1-refactor.mjs` 全绿。
