# 逻辑画板同步到飞书

Icarus 的研究工作台把每个问题的逻辑画板保存在 `research-spec.json` / `source.html` 的 `question.graph`、`graphViews` 和 `dependencyGraph` 中。`icarus whiteboard` 将这些图转换为可校验的 Mermaid，再通过 CLI 写入飞书画板或插入飞书文档。保留节点、模块分组、连线方向和种类；布局由飞书重排，HTML 的悬浮解释、代码详情、折叠状态和评论仍留在原页。同步只读取原始来源，不读取或反向修改 `review.html`。

## CLI 能力边界

- `lark-cli` 是实际写入路径：`whiteboard +update` 更新已有画板，`docs +update` 向文档追加一个 Mermaid 画板块。
- `@larksuite/whiteboard-cli@^0.2.13` 执行 Mermaid 检查，CLI 返回错误则停止写入。其本地检查结果不等于飞书端实际渲染验收。
- `organization-specific CLI` 当前适合做内部云文档检索和能力发现（例如 `cloud-docs` 的列表、搜索、详情），没有在公开帮助中提供这条画板写入路径，因此不把它冒充为写入实现。
- 不通过 Computer Use 创建或修改画板。浏览器只用于人工查看结果，不能成为同步链路的一部分。

2026-09-22 通过本机 `--help` / 版本命令确认：`lark-cli 1.0.96`、`@larksuite/whiteboard-cli 0.2.13`。身份默认使用 `--as user`，不会自动切换到 bot。认证仍由本机 lark-cli 管理，不把凭据写入 Icarus 来源文件。

## 先导出和校验

导出单个页面视图：

```bash
icarus whiteboard export /absolute/source.html \
  --out /tmp/icarus-whiteboard \
  --page pmp --view total-chain
```

导出所有页面和视图：

```bash
icarus whiteboard export /absolute/source.html \
  --out /tmp/icarus-whiteboard --all
```

导出目录包含：

- `*.mmd`：给飞书画板使用的 Mermaid，`groups` 转为 `subgraph`；
- `*.graph.json`：对应的 Icarus 图结构，保留节点和边的原始信息；
- `manifest.json`：页面、问题、视图、节点/边数量以及来源 SHA-256。

写入前会自动运行：

```bash
npx -y @larksuite/whiteboard-cli@^0.2.13 \
  --input /tmp/icarus-whiteboard/<graph>.mmd --check
```

## 同步到已有画板

必须明确指定 `--page` 和 `--view`；同一页面多问题命中同名视图时，再用 `--question <id>` 精确选择。导出的 manifest 提供可用标识：

```bash
icarus whiteboard sync /absolute/source.html \
  --whiteboard-token <wbcn...> \
  --page pmp --view total-chain \
  --as user --overwrite --dry-run
```

核对 dry-run 的目标、图和 lark-cli 请求后，去掉 `--dry-run` 才会真实写入。已有画板必须二选一：`--overwrite` 删除现有内容并按 Mermaid 重建；`--append` 保留现有内容并追加整个图。用户已明确授权相应操作时直接执行，不额外增加审批。命令根据目标、模式和图内容生成稳定的 `--idempotent-token`，原请求重试复用此值；若之后需要再应用相同图（例如远端已被手动修改），显式给本次逻辑更新一个新的 token。文档插入接口没有该幂等参数，失败状态不明确时先回读，不能盲目重试 `--create`。

## 在飞书文档中创建画板

文档目标必须显式加 `--create`。Icarus 会通过 `docs +update --command append` 插入 `<whiteboard type="mermaid" path="@./...">`，由飞书文档创建画板块并展开本地 Mermaid：

```bash
icarus whiteboard sync /absolute/source.html \
  --doc https://example.feishu.cn/docx/<document-token> \
  --create --page first-view --view logic \
  --as user --dry-run
```

文档同步当前采用“追加一个新画板”的语义，不会猜测或覆盖文档中已有画板。后续更新复用响应 `data.new_blocks` 中 `block_type == "whiteboard"` 的 `block_token`；也可以用 `lark-cli docs +fetch --doc <doc> --as user` 找到现有 `<whiteboard token="..."/>`，再改用已有画板 token 同步，避免反复新建。

## 来源和验收

1. 来源必须是原始 `source.html` 或 `research-spec.json`；传入 `review.html` 会直接失败。
2. 每次同步输出页面/问题/视图、目标、Mermaid 正文、校验结果和 lark-cli 响应。临时文件无论成功失败都会清理；需要持久文件时使用 `export`。
3. 当前研究产物的逻辑图全部可以 `--all` 导出；没有部署执行意义的资源节点仍保留在图中，但不会被伪装成执行链路。
4. `synced:true` 只表示飞书 CLI 返回写入成功，`readBackVerified:false` 明确表示尚未回读。实际写入后使用 `lark-cli whiteboard +export --whiteboard-token <token> --output-type source --as user` 回读对应 Mermaid；如需检查飞书排版，用 `+export --output-type preview --output ./preview --as user` 导出图片。本地校验和 dry-run 不能宣称完成了远端创建或视觉验收。

开发验证：`npm run test:whiteboard` 覆盖分组、错误连线、来源选择、问题歧义、写入参数、错误回执和临时文件清理，并调用真实 Mermaid CLI。按需再对目标文档或画板执行真实 lark-cli 的 dry-run；测试不向飞书写数据。
