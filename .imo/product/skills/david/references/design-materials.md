# 分页面设计资料

评审页顶栏的「设计资料」用于保存原始 PNG 截图和 Figma CSS。用户填写页面名称并提供文件，保存时自动匹配已有页面名称或建立新分组；录入不以 review 页面预先存在为前提。已有 review JSON 仍是评审内容真源，资料库提供输入证据，不会自动改写已评审方案。

- 表单主路径仅「页面名称 + PNG/CSS 文件」：自动识别格式，以文件名作为资料名；页面名称允许自由输入，已有名称只是建议，不强制先选列表或新建分组。PNG 支持直接粘贴，最大 8MB；CSS 也支持在折叠区粘贴原文，最大 1MB。点击保存后才落盘。
- 同名仅在唯一精确匹配时复用分组；新页面分组与首份资料在同一次保存中建立，失败重试保持请求 id。已有组、资料 id 与原始文件保持可读；CLI 可继续提供来源与独立资料名。
- 设计资料使用共享 Modal 的 nonModal 模式：层级低于评论与反馈/框选，不遮挡或锁住评论；前景反馈的 Escape 只关闭前景反馈，资料草稿保留。控件使用共享纸色/墨色 tokens。
- 每份资料归属于一个分组，页面分组保留 pageId，自建分组有稳定 id。查询时按 slug 和页面筛选，避免不同页面混用设计。
- 服务写入 `~/.imo/runtime/david/materials/<slug>/index.json` 和由服务生成名称的 `.png` / `.css`。页面不能指定文件路径；只有本机评审来源能读写这些接口。评论服务目录和版本号独立，资料写入不修改评论。
- 资料元数据记录来源、字节数、SHA-256 和创建时间；读取原文件时核对 SHA。重复请求同一 id/内容幂等，不同内容或过期版本拒绝覆盖。失败保留输入，刷新版本后可重试。关闭面板保留当前输入；刷新整个页面会丢失未保存输入。
- CSS 只显示为文本，不能执行、不能加载其中 URL。PNG 在页面内预览；不把当前生成预览标作原始 Figma 截图。

## Agent 使用

在 `<canonical>/project` 执行（服务地址沿用 DAVID_FEEDBACK_PORT，默认本机 5180）：

```bash
node scripts/david-materials-cli.mjs list <slug> --page <page-id>
node scripts/david-materials-cli.mjs get <slug> <material-id>
node scripts/david-materials-cli.mjs import <slug> --page <page-id> --page-label '<页面名称>' --title '<资料名称>' --file '<本地 PNG 或 CSS>'
```

`list` 返回资料目录，`get` 返回元信息和可直接读取的 localPath，不输出整份 CSS/base64；随后按任务定向读取原文件。`import` 用稳定 id 去重并回读 SHA，返回 verified。只导入用户已提供或明确属于当前评审的源资料；不能用衍生产物填充缺失的原设计证据。

后续用户提到设计稿时先查询资料库，再看 review 的 source/codePaths。已有资料足够时不要求用户重新复制；确实缺少的证据才说明缺口。

## 验证

使用隔离服务测试 PNG 与 CSS 保存后原文件一致、不同页面/自建分组隔离、重新打开与跨评审地址读取、失败保留草稿、非法图片/路径/远端 Origin 被拒绝。浏览器确认仅填页面名并上传文件即可保存、无预建分组依赖、CSS 不执行、PNG 可显示、窄屏可填写；真实点击评论与框选并验证键盘焦点和草稿保留，不能只比较 z-index。任何测试不得向用户资料库插入假资料。
