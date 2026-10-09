# 评论、资料与网络契约

维护对应能力时按 HARD-GATE 编号读取；这些是兼容契约，不要求每次生成或读方案全量加载。编号保留，不重新编号。

## HARD-GATE 7

评论/反馈仅本地存储，不谎称同步。剪贴板与 `~/Downloads` 下载文件是**本机数据交换通道**，不是远端同步——页面与 agent 均不得把「复制到剪贴板 / 导出下载」表述为「已同步到服务器 / 云端 / 远端」。

## HARD-GATE 8

插件仅白名单 tokens / behavior；拒绝任意 JS / CSS。

## HARD-GATE 12

页面不改源码、不写任意路径：不写 skill 源码、不写用户 workspace。允许的落盘只有三条 —— ① 用户显式手势触发的下载（`~/Downloads/<slug>-feedback*.json`）；② 评论与用户显式保存的设计资料经**本机服务**写入固定 runtime 目录（评论 `~/.imo/runtime/david/feedback/<slug>.json`；资料 `~/.imo/runtime/david/materials/<slug>/`，页面只发 loopback 请求，不指定落盘路径）；③ per-viewer 的插件、迁移标记、工程准备勾选/填写记录与最新一份未提交 composer draft 留在 localStorage；准备记录不改 review JSON、不代表文件已创建，也不属于评论数据。canonical 改动只能由 agent 经 IMO manifest（`source_root` / `source_mode`）定位源码完成；package 安装副本默认导出 patch，不直改。

## HARD-GATE 14

评论唯一入口 = David 外观框选反馈（appearance-selection），唯一数据源 = **本机评论服务**持有的 `david-feedback/v1`（`~/.imo/runtime/david/feedback/<slug>.json`），评论栏历史接入同一数据源；页面经 `feedbackTransport` 读写、agent 经 `david-feedback-cli` 读写。服务离线时评论不可写（横幅引导拉起），不降级写 localStorage。旧 localStorage `david:<slug>:feedback` 仅一次性迁移，旧 `tech-review:*` 存储不读取、不迁移；不再有被动多 surface 框选 / 文字划选评论（与 David 框选通用的逻辑保留）。数据只在本机，不得声称同步飞书 / GitHub。 未提交的新增评论允许按 review slug 单独缓存最新一份 composer draft（正文、类别、选区）到浏览器本机；它不是已提交评论数据源，不进入 Agent 队列，成功提交或清空后移除。服务离线时仍不得把正式提交降级成草稿并声称成功。

## HARD-GATE 17

整页外观捕获：单一全局工具覆盖 shell/按钮/留白/dock/PRD/dialog，topmost 命中测试、完整视口矩形可跨 surface；显式模式外保留原生输入与逃逸，启用时保留未保存编辑器文本；外观反馈进 david-feedback/v1 仅本地存储、无自动磁盘写；区域字段以 project/src/lib/davidFeedback.ts 为准，不发明 schema。

## HARD-GATE 24

反馈处理：先经 david-feedback-cli 读取本机评论服务（唯一活动数据源，无需 Computer Use/localStorage）；任务增量按 entry id + 内容/replies 快照比对，已有 id 的新用户编辑、新用户回复仍处理；旧条目仅在评论、相关方案与证据均未变化时跳过。方案/IDL/复用结论变化，即使 since 无增量，也按[评论与当前方案对账](feedback.md#评论与当前方案对账)同步受影响 Agent 正文，保留历史回复、位置与人审决定，不以删除重建代替更新；JSON 导入按 entry/reply 各自 id union，相同 entry base 不抑制新 replies，reply 重放幂等、冲突拒绝覆盖；冲突时重读当前数据、保留用户编辑并重试已授权合并，仅意图真实不明才询问；损坏存储保持原样，显式有效备份导入才恢复；修复验证后给对应 feedback 追加 Agent 结论并回读确认；未获人审不称验收通过。

## HARD-GATE 25

页面不联远端：构建产物不得含 `XMLHttpRequest` / `new WebSocket` / `EventSource(` / `sendBeacon`（`check-template` 断言）；`src/**` 由 eslint `no-restricted-globals` / `no-restricted-properties` 禁用网络全局。**唯一例外**：评论与设计资料经本机 loopback 服务（`127.0.0.1`，默认 5180）读写，出口收窄为单文件 `src/lib/feedbackTransport.ts`（eslint 定向豁免 `fetch`，XHR / WebSocket / EventSource / sendBeacon 在该文件内仍禁用）。数据不出本机，仍不得声称同步飞书 / GitHub。任何**跨机**联网桥接必须 opt-in、默认关、UI 可见。剪贴板与文件导入导出是本机通道，不受此限，但同样不得静默触发。

## HARD-GATE 26

Agent 回复可识别：`replies[].author` 缺省为 `user`（序列化时省略）；agent 写回必须携带 `author:"agent"`。评论栏折叠态与展开态都必须视觉区分 author；禁止用正文文字前缀替代结构化标记。agent 回复 id 必须确定性派生（`agent-<hash>`）保证重放幂等；CLI 新回复时间由服务首次接收时记录，重放保留旧时间。回复按接收顺序追加，禁止按作者分组或不可靠的历史时间戳重新排序。

## HARD-GATE 33

外观框选深度上下文：`scope.selection.context` 必须让 agent 不回看页面即定位现场——锚点链（向上 ≤8 层、apiFields 去重 ≤16 项）、textSnippet ≤120（仅兼容预览）；regionText 可选，按整个选区的可见 DOM 字素矩形交集提取，text ≤20000，truncated 必须显式说明截断；图片/canvas/iframe/shadow 文本不冒充已采集。界面展示区域文字及数量，旧记录标历史摘要。heading ≤160、TRD 行/列（行内无列标记归 `trd` 整行，禁止编造列名）、场景快照、canvasPoint（仅中心落在画板 stage 内经 transform 反算）、domPath ≤5 层 ≤200 字符；context 为 v1 可选字段，旧数据无 context 照常解析，严格校验非法 422，取不到的字段省略，禁止编造。

## HARD-GATE 42

同类反馈一次闭环：先按问题模式盘点当前 review 所有页面/同类节点，再修共享源与受影响 JSON；保留逐项覆盖证据，不能用单点截图或静态校验替代全体检查。工程准备使用真实控件，复用结论核对公开导出/调用链/目标端，代码前后均可注解，短内容直接展开；执行口径见 [references/feedback-fix-workflow.md](feedback-fix-workflow.md)。

## HARD-GATE 43

设计资料以「页面名称 + PNG/CSS 文件」录入，自动识别格式并在保存时匹配或建立分组，不要求预建 review 页面、单独选择类型或填写资料名；补充面板低于评论/反馈并使用共享主题，经本机固定目录与共享校验读写。CSS 仅作文本证据，不执行、不拉取其中资源；Agent 先查询已有资料、按 id 读取原文件并核对来源，不用生成预览冒充原设计稿。上传、跨地址读取、失败保留输入与 SHA 回读按 [references/design-materials.md](design-materials.md) 验证。

## 对应验证项

- [ ] 评论唯一入口与唯一数据源：仅 David 外观框选反馈写入本机评论服务（`~/.imo/runtime/david/feedback/<slug>.json`），评论栏历史接入同一数据源；旧 `tech-review:*` 不读取不迁移；无被动多 surface 框选 / 文字划选评论
- [ ] 评论服务闭环：`npm run test:feedback-service` 全绿（含 schema 未知字段 422 不污染落盘、reply 同 id 同内容幂等且**无内容写不推进版本** / 异内容 409 且回带 currentVersion、expectedVersion 不符 409、路径穿越拒绝、CORS 预检）；`npm run test:feedback-cli` 全绿（agent 侧 `david:feedback -- add/get/reply/status/decision` 均 `verified: true` 写后回读、reply 默认 `author:"agent"` + 确定性 `agent-<hash>` id / 同输入重放幂等、冲突退出码 3、服务不可达退出码 4）
- [ ] 页面侧接入：在线时离线横幅隐藏且能自动读到服务/agent 新写入的评论，无需先回复或刷新；草稿、滚动与展开状态保留；杀掉服务后刷新显示离线横幅（含「复制启动指令」与「重试连接」）且评论不可写、不写 localStorage；`service.baseUrl` 只接受 loopback 主机（`reviewSpec` 校验，非 loopback 一律丢弃）
- [ ] 构建产物无 `XMLHttpRequest` / `new WebSocket` / `EventSource(` / `sendBeacon`；`src/**` 中 `fetch` 仅出现在 `src/lib/feedbackTransport.ts`（eslint 定向豁免，其余文件用 fetch 必须报错）
- [ ] 反馈处理闭环：先通过 CLI 读取本机评论服务；任务增量按 entry id + 内容/replies 比对，已有 id 的新用户编辑/新用户回复仍处理；旧条目仅在评论、相关方案与证据均未变化时跳过；方案更新后即使 since 为空，仍对账受影响 Agent 正文并保留用户原文/位置/人审决定；JSON 导入按 entry/reply id union、reply 重放幂等、冲突拒绝覆盖；冲突重读并保留用户编辑后重试已授权合并；损坏存储仅由显式有效备份导入恢复；Agent 结论追加后回读确认，未获人审不称验收通过
- [ ] 稳定定位：component/node 锚同时给 `data-review-target` 及可读 label；旧泛化 surface/像素位置只恢复场景并说明，不宣称精确找回（仅约束评论位置找回）；历史详情已删增量不重开假弹窗
- [ ] 居中阅读排版：prose 左对齐、短内容居中、高内容顶部可达可滚；节点进入无陈旧滚动偏移；评论导航恢复目标
- [ ] 整页外观捕获：全局工具可发现、覆盖 shell/按钮/留白/dock/PRD/dialog；topmost 命中、跨 surface 矩形；模式外原生输入/划选逃逸可用，启用时编辑器文本保留；外观反馈仅本地、无自动磁盘写
- [ ] 字段按钮精确高亮最小元素；评论刷新恢复
- [ ] 反馈面板可导出/复制 `david-feedback/v1`；插件导入仅白名单生效
- [ ] 按[最小改动与验证](authoring-incremental.md#最小改动与验证)选择检查：JSON 内容优先结构、引用与产物检查；行为变化用对应定向回归和隔离服务；Computer Use 只验证尚无法自动判断的具体视觉问题，不重复已通过的结论
- [ ] Agent 回复可识别：评论栏折叠态与展开态均有 author 徽标；旧数据（无 author）渲染为「我」，agent 回复显示对应徽标；未用正文文字前缀替代结构化标记
- [ ] 桥接通道：`david-feedback.mjs pull --from clipboard` 剪贴板往返幂等（reply 重放幂等、`verify` 回读一致）；构建产物无 `XMLHttpRequest` / `new WebSocket` / `EventSource(` / `sendBeacon`
- [ ] 真实画板：原生 screen/UI 预览 wheel 与 touch 正常滚动；逻辑画板 wheel 光标锚点缩放（0.25–3）、左键/Space+拖拽平移、>5px 拖拽抑制节点点击、≤5px 保留点击；＋/－/适应/重置与缩放比正确；overview 与 dock 变换独立、跨页/进详情/返回重置恢复策略正确；框选模式下手势让位；`node scripts/test-canvas-transform.mjs` 全绿；dock DOM 契约保持
- [ ] 初始布局与补充面板：`node scripts/test-initial-layout.mjs` / `test-review-materials.mjs` 通过；首帧至落位阅读列宽稳定，预览容器模型不后切；各页工程/风险入口可达、样式一致；资料只需名称+文件，评论/框选在上层且草稿不丢
- [ ] 框选深度上下文：评论携带 context 时面板渲染 chips（组件/节点/行列/场景/坐标/摘要）；旧数据无 context 照常解析；非法 context 422；`node scripts/test-selection-context.mjs` 全绿
- [ ] authoring-json 取舍：脚手架/常规配置/依赖按 references/authoring-json.md 输出（首次创建先提取已有 OWNERS/应用名/仓库归属，缺失资料用 preparation 填写）；同组件数据结构/埋点/结构同组；样式默认 tailwind（david pageHtml 自包含前缀类名例外）、mock 不铺陈、无装饰性 class、data-* 锚点保留；增量片段带定位路径（openQuestions#id / apiContracts#id / components#id.mapping#id / 节点 id / pages#id）；合并后的候选完整 spec 通过 parseReviewSpec，再核对受影响来源与字段锚点

- [ ] 区域文字：`node scripts/test-region-text.mjs` 验证跨段落/内联/列、部分字符、隐藏/输入值、overflow、遮挡、缩放/Unicode、留白、120 字兼容预览和截断；新旧 context 均可经评论服务保存与回读。
