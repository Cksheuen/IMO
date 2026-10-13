# 默认本机评论与 Agent 通道

此通道是固定内核的一部分。模块化只用于分离实现职责，不能用 feature 开关关闭它。用户无需复制/导出，Agent 无需读取浏览器存储。

## 数据路径

```text
attach source.html review.html
  → 注册 source 的真实路径与当前 SHA，自动启动/复用 Icarus 本机服务
  → 页面 POST 单条评论（稳定 id、选区、capture source、expectedVersion）
  → 服务校验、CAS、固定目录原子落盘
  → 页面 GET 回读确认，显示已保存
  → Agent feedback.mjs get source.html 读取同一份数据
  → Agent feedback.mjs reply source.html entry-id body
  → 服务幂等追加并回读，页面轮询展示回复
```

- `~/.imo/runtime/icarus/documents/<document-id>.json`：来源、预览位置与本机访问标识。
- `~/.imo/runtime/icarus/feedback/<document-id>.json`：`{version, doc}`，唯一活动评论数据。
- `~/.imo/runtime/icarus/service.json`：服务发现信息；服务绑定 `127.0.0.1`，重启复用端口。
- `sessionStorage` 只保存尚未提交的草稿，不充当已提交评论来源。

文档 id 从真实来源路径派生；同一来源重新生成继续使用原历史。CLI 同时接受稳定 document-id，来源移动/删除时历史与回复仍可读写，来源状态明确为 source-missing；不自动绑定猜测的新路径。每条评论的 `source` 固定为捕获时版本；Agent 读取时逐条判断 SHA 是否已过期。不要把过期选区套到新源码，也不要删除历史来消除过期提示。

## 验证与失败语义

- 仅允许注册文档的授权 API，检查 loopback Host/Origin；跨源 file/本机预览也需要文档访问标识。生成文件与 runtime 注册信息包含本机通道信息，不属于公开发布产物。
- 单进程内同步读取版本、变更和原子替换文件。并发版本冲突返回 409；页面/CLI 重读后有限重试，不覆盖整份文档。
- 同 id 同内容重放不追加、不增加版本；丢失写入响应时页面及草稿保留提交 id，刷新后重试仍可确认原写入。异内容同 id 拒绝。
- 页面只在服务写入及 GET 回读成功后确认保存。失败保留正文和选区草稿；连接恢复可重试，不把内存追加伪装成保存。
- Agent 回复 id 确定性派生，服务记录首次接收时间；回读 `verified: true` 只说明读写正确。没有用户验收时保持 `open`。
- 服务停止不会抹除评论；CLI 或重新生成时自动恢复服务，页面重试/轮询重连。浏览器自身不能启动 Node 进程。
- 损坏存储报错并保留原文件，不静默置空覆盖。原 React 评论删除走下文的能力协商；不提供云同步。

## 默认评论工作流

评论栏提供展开/收起、未解决/已完成/全部、当前场景/全部场景及待复评筛选。用户可以编辑评论、追加回复、标记完成或重新打开；Agent 回复只追加到同一条历史，不自动改变用户完成状态。

每条评论最多包含 8 个选区。旧 `selection` 和 `source` 保持为第一选区及其捕获来源；新增后 `selections` 为 `{id, selection, source}[]`，包含第一选区。Agent 的 get 输出始终提供规范化 selections，并逐个标注来源是否过期。不要把新增选区的来源 SHA 覆盖到旧选区上。

`POST /feedback/<id>/updates` 使用 `{expectedVersion, entryId, update}`。update 为带稳定 id 的 status/edit/selection 操作；状态与编辑还携带 previousStatus/previousComment。服务原子落盘操作回执，页面 GET 验证回执后确认成功。版本竞争有限重试；正文或状态已被其他窗口修改则保留草稿、提示核对，不静默覆盖。重复操作 id 幂等，异内容重用拒绝。追加选区失败时原评论不变，待确认选区及操作 id 保留在 sessionStorage，刷新后可重试或取消。

选区可携带框架无关 `context: {adapter, state}`：state 最多 16 个短字符串字段，拒绝危险字段与嵌套可执行配置。可选 mod 用默认通道提供的 selection.register 注册导航适配器；未加载模块时评论仍可读写，定位明确提示模块缺失。普通 HTML 按锚点定位内容；工作台恢复所属页面、组件/节点和详情后定位。过期来源不会直接套用原几何。

服务 health 声明 `comment-workflow-v1`。更新后需重启旧本机服务；CLI 拒绝把新操作发送给旧服务，重启保留端口和历史。

## 本地命令

```bash
node scripts/feedback.mjs get /absolute/source.html
node scripts/feedback.mjs reply /absolute/source.html <entry-id> "修改与验证结果"
# 仓库维护者在 plugins/icarus 执行：
npm test
npm run test:browser
npm run test:comments
```

测试使用独立 `ICARUS_RUNTIME_DIR`，结束只停止自己启动的测试进程。日常生成自动保留后台服务，避免关闭浏览器后 Agent 失去读取通道。

`mod-plans/<document-id>.json` 与评论库分开存储，只有本机 CLI 可写。GET /mods/<document-id> 使用同一文档 token 读取；错误、缺失或卸载 mod 不改变反馈快照。服务 health 声明 mods-v1，旧进程需 service restart 后再使用热加载。

原 React 工作台通过 health 中的 `feedback-delete` 协商删除能力。DELETE entries/:id 需要 expectedVersion；PATCH removeSelection 删除精确选区 DTO，最后一个选区删除后保留评论。重复删除幂等，真实变更须匹配版本。被删除条目和选区记录保存在本机 journal 的 deletedEntries / removedSelections，活动列表不显示，旧请求不能恢复它们。

单条处理由默认内核提供，HTML 与原 React 评论栏均可排队。完整状态、认领及续期规则见 [comment-processing.md](comment-processing.md)。任务完成和回复原子落盘，不依靠最新一条回复猜测是否覆盖新意见。
