# Mod 实现与归属规范

新增功能、处理评论、修复交互前，先确定功能所有者，再修改代码。文件移动到 `mods/` 并不自动代表已完成拆分；独立安装入口和复合工作台必须复用同一个实现，不能各写一套。

## 先判断落点

| 需求 | 所有者与实现位置 |
| --- | --- |
| 框选、评论、回复、草稿、处理状态、本机 Agent 通道 | 默认内核及原 David 评论适配；不能作为可卸载 mod |
| 页面导航、左图右文、面板收展、响应式布局、选择与解释联动 | `mods/research-workbench/src/`，只编排数据和组件 |
| 图节点、标签、连线、缩放、图阅读顺序 | `mods/logic-canvas/src/public.ts`；图排序在该 mod 的 `graphOrder.ts` |
| 代码渲染、批注、高亮、源码行号 | `mods/rich-code/src/public.ts` |
| Mock 场景切换、JSON 和可信预览 | `mods/mock-cases/src/`，禁止再内联到工作台 |
| 服务资源卡、部署状态与参考链接 | `mods/resource-cards/src/public.ts`；平台名称和核查结果由数据提供 |
| 节点间字段映射、节点内部转换、主函数选择 | 研究工作台编排 `handoffs`、`transformations`、`entryFunction`；图形与代码仍复用对应 mod |
| diff、调用图、富文本、字段契约、准备项、问题、设计资料 | 对应现有 mod；先查 `david-mods.md`，不要放进无关模块 |
| 某个项目的接口、链路、说明、证据与 Mock 值 | 原 HTML/spec 的数据；不得硬编码进通用 mod |
| 导出逻辑图、调用外部 CLI 同步飞书 | `skills/icarus/scripts/whiteboard*.mjs` 的离线适配命令；只消费公开 JSON，不导入 mod 私有代码，不向浏览器或评论内核加入凭据和写入逻辑 |

已有 mod 的能力就在该 mod 扩展。只有具有独立输入、生命周期、使用场景的能力才新建 mod；按钮、动画和纯工具函数不必单独建包。默认不改其他 Skill 或仓库根 workspace。

## 复用与源码边界

1. 每个 mod 单独目录，具有 `mod.json`、`package.json`、`src/`（编译型模块）、构建产物和使用说明。样式、校验、组件和功能测试与能力归属对应。
2. 模块间源码复用只允许公开入口：生产者声明 `icarusBuild.publicEntry` 为 `src/public.ts(x)`，使用者声明 `icarusBuild.composes: ["mod-id"]`，导入对应公开入口。禁止跨 mod 访问私有实现、在宿主复制组件或用私有 DOM 补丁代替组件接口。
3. 工作台可以决定容器尺寸、导航和数据联动；具体功能的状态机、渲染和交互应属于对应 mod。不要把新增能力继续堆进 `ResearchWorkbench.tsx`、原 David App、本机 server 或生成 HTML。
4. 原 React 组件继续复用本机 David。通用组件缺陷在 canonical 原组件修复，经租约、验证、snapshot/build 同步；对应 mod 的公开入口是 Icarus 的唯一能力入口。`packages/david-source` 是可离线构建的来源快照，不能单独手改成第二套实现。禁止用业务页特例 CSS 掩盖共享缺陷。
5. `packages/david-shared` 只放 React 宿主、Portal、传输适配等跨模块设施，不承载某个业务功能。主题、基础按钮和类型可共享；评论属于默认核心例外。

## 分清两种组合

- **运行时依赖**使用 `mod.json.requires`。加载顺序、卸载、回滚遵守 feature contract；有状态通道必须共享同一实例，不能复制进多个包。
- **源码组合**使用 `icarusBuild.composes`。无全局状态的渲染器在复合工作台构建时一起打包，保留原 React root 和样式。构建记录包含被组合 mod 的版本、公开入口及来源文件指纹；更新其中一个 mod 后必须重建、重装受影响工作台。

安装或关闭独立 `mock-cases` / `logic-canvas`，不会替换已经编译进工作台的内部组件。不能把源码组合宣称为工作台内部的运行时热卸载。用户需要某项能力独立装卸时，提供独立 HTML 插槽并加载对应 mod；若要求在同一 React 工作台内部独立替换，还需先实现明确的宿主扩展协议。

## 每次实现的交付检查

1. 列出需求对应的 core / mod / 数据落点；按问题模式盘点原 HTML/spec 的所有页面与同类节点，逐项记录覆盖或不适用理由。核对同类功能没有另一套实现；通用组件支持不代表各节点数据已填齐，不以只改评论锚点作为完成。
2. 更新源码和对应 mod 版本，构建全部受影响消费者；不得仅改生成 HTML 或 dist。保持历史评论锚点及输入兼容。
3. 执行 `npm run check`：包含模块边界检查，拒绝绕过所有者、未声明源码组合和跨 mod 私有导入；执行相关类型检查、单测及行为回归。
4. 新 mod 必须验证单独 ZIP 打包/安装、在纯 HTML 中启用、禁用、再次启用；评论内核、原 HTML 和其他 mod 状态不受影响。复合消费者另测真实页面行为。
5. 同步本机 Skill/已安装 mod 与当前产物，回读评论，逐条说明覆盖范围；人审状态保持 open。只暂存用户授权范围，不擅自 commit、push 或 publish。

`scripts/check-mod-boundaries.mjs` 是自动门控入口；新增能力时同步补充所有者映射。自动检查覆盖可识别的导入和依赖结构，不能代替对职责、CSS 和隐藏副作用的审查。
