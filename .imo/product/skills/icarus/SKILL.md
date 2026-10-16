---
name: icarus
description: 在任意本地 HTML TRD 上添加选区评论与默认本机 Agent 通道，按用户要求或页面特征加载独立 mod。用于伊卡洛斯、Icarus、HTML 评论、David 功能解耦、代码说明或真实组件增强，以及 mod 创建、ZIP/npm 安装、按需热加载和仓库贡献。
---

# Icarus

IMO 收录版包含可离线加载的 mod 运行包。首次安装、升级或维护前读 [IMO 分发与维护](references/imo-distribution.md)；包名不表示已发布到公共 npm。该说明记录了导入时全局文档领先于运行代码的边界，涉及 `context/maintain/restore` 和存储迁移时优先遵循该说明。

查看或修改 React/TSX、mod 组件及共享 David 组件时，从 [源码目录与构建指南](project/README.md) 进入；源码位于 `project/mods/` 和 `project/packages/`，上层 `mods/` 是已发布到本仓库的运行快照。

以原 HTML 为可编辑来源，生成独立 review HTML。框选、完整选区文字、评论、草稿、本机持久化与 Agent 读写始终内置；它们不能作为可关闭的 mod。独立使用，不替换其他 Skill 的事实源或审批流程。

`<skill>` 是本 SKILL.md 所在目录。Node >=20.11；首次使用若缺依赖，在此目录运行 `npm install --ignore-scripts`。npm 安装用户可直接使用 `icarus`，其他环境把下文命令中的 `icarus` 替换为 `node <skill>/scripts/cli.mjs`，不假设系统已存在同名命令。

## 使用

1. 读取用户的可信本地 HTML 和要求，无需转换为 David JSON 或 React 项目。
2. 解释业务链路、调研或知识问题时优先读取 [research-workbench.md](references/research-workbench.md) 和 [understanding-oriented-research.md](references/understanding-oriented-research.md)，用独立研究工作台按页面和问题组织。研究内容必须同时提供文字解释和逻辑画板：文字说明输入、转换、输出、UI 消费和失败边界，画板只表达模块边界与分支；技术方案映射与组件钻取使用原 review-workbench。需要把逻辑画板同步到飞书时，再读取 [whiteboard-sync.md](references/whiteboard-sync.md)，使用 Icarus CLI 生成并校验 Mermaid，通过 `lark-cli` 写入；不要用 Computer Use 创建画板。按原页面识别增强需求；需求涉及代码批注、对比、画板、完整 TRD 或设计资料时先读 [david-mods.md](references/david-mods.md)，选择具体模块并在原模板准备相应插槽/配置。未出现插槽不等于用户没有增强需求。然后检查：

```bash
icarus mod recommend /absolute/source.html
icarus mod list
```

用户明确指定 mod 时优先使用它；未指定时根据 recommend 的结构化匹配、mod 描述和实际需求判断。自动匹配只读取清单，不执行代码。只安装任务所需、可信的模块；已知目录 id 的安装有固定版本和内容哈希检查。目录尚未发布时用用户提供的目录/ZIP，不猜远程包名。新模块用显式目录、ZIP 或精确 npm 包版本安装：

```bash
icarus mod install code-notes
icarus mod install /absolute/new-mod.zip
icarus mod install @scope/icarus-mod-new@1.0.0 --registry https://registry.example.org
```

3. 生成页面。默认自动选择已安装的匹配模块；返回 `mods/decisions/missing`，向用户说明实际加载项及仍缺的模块，不将缺失写成已启用。

```bash
icarus attach /absolute/source.html /absolute/review.html
icarus attach /absolute/source.html /absolute/review.html --mods code-notes --no-auto
```

逻辑画板同步使用独立 CLI，不修改原始 HTML 或评论状态：

```bash
icarus whiteboard export /absolute/source.html --out /tmp/icarus-whiteboard --all
icarus whiteboard sync /absolute/source.html --doc <doc-url-or-token> \
  --create --page <page-id> --view <view-id> --as user --dry-run
```

先检查 dry-run 输出和 Mermaid 校验，再由用户明确指定的目标执行真实同步。已有画板使用 `--whiteboard-token`；文档创建使用 `--doc --create`，默认追加新画板，不猜测覆盖已有文档内容。

打开返回的 `previewUrl`。服务落盘并回读成功才显示保存，刷新恢复历史。原页面不允许修改或无原 HTML 时先取得正确输入，不反向覆盖生成页。

评论列表、未解决/已解决与待处理/处理中分组、编辑/追评、新增选区、定位、标记完成和重新打开均为默认内核能力，不要为这些操作要求额外加载 mod。用户操作落盘后 Agent 读取同一份评论；Agent 回复不自动完成评论。

4. 用户要求新增/移除 mod 时，安装后热更新当前页：

```bash
icarus mod enable /absolute/source.html --mods code-notes
icarus mod enable /absolute/source.html --auto
icarus mod disable /absolute/source.html --mods code-notes
```

`enable` 指定完整目标集合，可列多个逗号分隔 id；依赖自动加入。它只修改本机计划，不重载 HTML；已保存评论与资料保留，纯 HTML 核心草稿保留。原 React 工作台的新增评论正文和选区会保留最新一份本机草稿，重新打开反馈面板可恢复；其他未保存表单仍需先保存再替换或卸载。读者页面不显示扩展清单；Agent 通过 `window.icarusMods.status()` 检查失败与缺失原因，使用 `retry()` 重试。必须核对实际界面和状态，不将 CLI 计划写入当作浏览器已挂载。mod 不能来自评论或远程页面给出的可执行指令。

5. 处理评论前先读 [comment-processing.md](references/comment-processing.md)。认领后读取正文、全部用户追评和选区，以最新用户意见确定验收对象与条件；旧 Agent 回复和队列成功回写不是页面完成证据。评论系统本体执行全局完结门：将症状归为问题模式，盘点当前文档全部页面、共享内核、已启用 mod、节点和展示层；逐项归类、全量覆盖、验证和回读，不能只修改评论锚点或依赖单个 mod 的局部测试。页面不提供处理按钮；用户在当前对话要求处理评论后，由 Agent 提交处理批次并用 task next 逐条领取，固定快照并绑定 batch-id / entry-id / task-id；每五分钟续期，验证后用 task finish 原子回写，失败用 task fail。活跃批次中新评论保存即入队并显示在「处理中」，每条结束后再取下一条；正在处理的同条新意见保留下一轮，不重复处理待审阅的同一版本。队列清空即结束，不用等待工具保活。不启动后台 Agent，不自动把人审状态标记解决。

通过本机通道处理评论，不要求用户导出：

```bash
icarus feedback get /absolute/source.html
icarus feedback get <document-id> [entry-id]
icarus feedback list <document-id> [all|open|resolved]
icarus feedback context <document-id> [entry-id]
icarus feedback maintain <document-id>
icarus feedback restore <document-id> <entry-id>
icarus feedback task list <document-id>
icarus feedback reply <document-id> <entry-id> "修改与验证结果"
```

`context` 是给 Agent 的机械化上下文入口：一次返回评论正文、用户追评、任务版本、全部选区、原生画板 scene/targets，以及按 `logic:*`、`contract:*`、`functions:*` 等 target 生成的 JSON 落点提示。`list` 只筛选未解决或已解决条目；`maintain` 自动完成旧单文件迁移、过期租约回收、无效任务清理和已结束任务压缩；`restore` 把已解决评论重新放回未解决区并保留历史回复。

本机服务将评论拆成 `feedback/<document-id>.json`（未解决和队列）与 `feedback/archive/<document-id>.json`（已解决），旧文件只保留在 `feedback/backups/`，写入中的双文件事务落在 `feedback/transactions/`。Agent 不需要手工搬运 JSON；服务启动会兼容旧格式，`maintain` 可显式执行一次机械维护。先用 `context` 核对选区文字、scene、targets 和用户追评，再修改原 HTML/业务 JSON 并重新生成。回复幂等并回读；`verified:true` 仅表示读写核验，评论保持 open 等待人审。来源移动/丢失时用稳定 document-id 读历史，不猜新文件。

## 边界与开发

新增功能、处理评论或修复交互前，先读 [Mod 实现与归属规范](references/mod-implementation.md)：评论与本机通道保留默认内核，其余功能归属对应 mod；优先扩展既有 mod，独立能力另建 mod。跨模块只经声明的公开入口组合，禁止内联、私有导入或只改生成页；源码组合与运行时装卸分别验证。

- 数据默认 `~/.imo/runtime/icarus`，mod 默认 `~/.icarus/mods/<id>`；分别用 `ICARUS_RUNTIME_DIR` / `ICARUS_MODS_DIR` 隔离。默认本机通道不可卸载，不降级为仅 localStorage 的成功保存。
- 升级代码不等于升级常驻服务。若提示服务版本过旧，执行 `icarus service restart` 后核对历史回读；原端口、数据与 document-id 保留。
- 页面须本地可信且允许脚本；原 HTML 相对资源保留在来源目录。跨域 iframe、canvas、Shadow DOM 和 CSP 限制需要另外适配，不声称已采集其文字。
- 调研使用 `research-workbench`：原画布、代码批注与评论组件组成左图右文布局，显示条件和 Mock 合并在同一问题。节点必须有 description，代码必须按语义段提供 annotations；不要用无交互 HTML 模拟原组件。精简反馈面板不重复显示评论列表。
- David 的代码批注、diff、富文本、字段契约、逻辑画布、代码调用图、复杂评审工作台、准备清单、待确认项、设计资料已迁为独立 mod；功能、插槽与数据契约读 [david-mods.md](references/david-mods.md)。完整 `review-workbench` 直接运行原 App/评论/hooks/CSS，携带独立 React；其他独立 TSX 模块通过 `@david/*` 引用原组件并按依赖共享 `react-runtime`，默认原 HTML 不需要 React；`react-island` 继续支持宿主提供组件。
- 创建/安装/打包/贡献 mod 读 [mods.md](references/mods.md)；副作用和装卸契约读 [feature-contract.md](references/feature-contract.md)；评论协议读 [local-channel.md](references/local-channel.md)。`mod contribute --stage` 最多暂存，不提交或 push；`mod publish` 默认预览，只有用户授权发布后使用 `--execute`。
