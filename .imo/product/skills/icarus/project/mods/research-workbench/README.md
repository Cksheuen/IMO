# research-workbench

按问题分页、左侧逻辑画板与右侧正文的研究工作台；评论和 Agent 通道沿用默认内核。输入 `icarus-research/v1`，保留稳定的问题、节点和代码锚点。

节点解释与所选代码在真实插入位置按实测高度收展，退出完成才卸载；快速反转从当前高度继续，父层展开时子代码不重复播放动画。评论定位等待展开结束后定位锚点。收起主画板且正文容器至少 900px 时，两段所选代码横向展示；空间较窄则自动竖排。减少动态效果设置关闭过渡。

函数画板经 `logic-canvas` 的公开 `FoldableLogicCanvas` 复用收缩能力。每个 question 可声明 `symbols: string[]`，传给 `rich-code` 公共入口，在同一问题的 I/O 和源码中使用一致颜色。Mock 场景由 `mock-cases` 提供。

源码组合依赖记录在 `package.json.icarusBuild.composes`；升级被组合 mod 后重建、重装本工作台。它的内部组件不等同于独立插槽的运行时热卸载。

- 构建：`npm run build -- research-workbench`
- 源码与数据契约回归：`npm test`（包括研究工作台 schema、数据流、覆盖与阅读结构）。
- 原开发 workspace 的浏览器布局回归不随本源码包提供；本次源码导入未替换已发布运行包。

代码和 I/O 契约可使用 `definitions: {"Name": 7}` 显式声明块内定义行，工作台透传至 rich-code，解析和定位由该 mod 负责。缩小函数画板停在页面视口左上角并避让主画板按钮。
