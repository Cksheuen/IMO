# 按需读取与接手已有方案

新 Session/Agent 只拿到方案位置时，从本页开始。先看目录，再读相关正文；不需要原聊天历史或预先取得 ownership。

## 1. 确认方案与范围

```bash
node <canonical>/project/scripts/review-context.mjs <JSON或HTML或目录或预览URL>
node <canonical>/project/scripts/review-context.mjs <位置> --kind node --limit 20 --offset 0
node <canonical>/project/scripts/review-context.mjs <位置> --select <catalog给出的selector>
```

目录按 page/component/node/row/contract/question 分页，包含节点自有 mapping；可以用 `node:<id>`、`contract:<id>` 或精确 JSON pointer。id 歧义时工具列候选，不猜对象。目录有多个文件时先按用户任务定位正确文件，不默认拿 review.json 覆盖 review.full.json。

选择后的 `david-review-context/v1` 包含该处完整语义、祖先职责、实际 mapping、引用的 apiContracts、明确引用的待确认项、声明式跳转/弹层线索及完整 ownership 元数据。子节点只给目录，继续按其 selector 展开；其他待澄清项给独立入口，不凭文案猜归属。

## 2. 只补充本次需要的材料

- 改字段：读相关 contract 和 consumers，再读这些行；保留 proposal/confirmed 与状态边界，不只看摘要。
- 改功能：读对应 node/row 的正文、祖先约束与关联契约。节点未表达的信息回到 codePaths、原 PRD/设计资料查证，不补隐含假设。
- 改外观：加 `--preview` 读取已声明锚点的 HTML 子树和样式证据。只解析已声明属性，不从任意 DOM 猜业务结构；不执行脚本或拉取媒体/CSS 资源。共享样式可能较大，超预算时改读更小节点或显式提高预算，不静默裁掉代码。
- 读当前评论：加 `--feedback`（只访问本机 loopback 服务），选中功能只关联稳定 scope id 命中的评论。`--kind feedback --feedback` 可分页找其他或旧选区，再 `--select feedback:<id> --feedback` 读完整原文/回复。服务不可达会明示，不能称已读完当前评审意见。
- 不认识锚点/代码块时，再查 [agent-readable-html.md](agent-readable-html.md) 的词汇表；需要原始资料则按 [design-materials.md](design-materials.md) 查询，不能用当前预览冒充原设计。

默认不回传 pageHtml、全部兄弟内容或当前评论。`--limit/--offset` 控制目录；`--max-chars` 默认 24000，超出即报错并要求缩小范围，不截断正文。可用 `--out <新文件.json>` 另存上下文包，拒绝覆盖现有文件。

## 3. 判断能否定位写回源

| source.status | 能确定什么 | 下一步 |
|---|---|---|
| direct-source | 用户直接给了当前 JSON，附原始文件 SHA | 在授权范围内基于该源做候选修改 |
| verified-source | 本地 HTML 的相邻 JSON 与 renderer 凭据匹配 | 使用 reviewPath，并在合并前重读 SHA |
| snapshot-only | 只有 HTML/URL 的内嵌 review-data，或原源不可达 | 语义仍可读；先定位当前完整 JSON，再谈写回 |
| stale-snapshot | 原 JSON 已不同于 HTML 生成时版本 | 不把旧 HTML 当最新方案；改读当前 JSON 对比，保留并发变更 |

`sourcePath` 可能是 PRD/代码参考路径，不是 review JSON 定位凭据。新 renderer 另存 `david-review-source/v1`：实际输入 JSON 的相对路径、原始 SHA 与内嵌数据 SHA。工具只自动核对本地 HTML 同目录树内的来源；复制出去的单文件 HTML、远端/本机 URL 不会触发任意本机文件读取。即使旧 HTML 没有 design-context，只要含唯一 review-data JSON，仍可读取快照；缺少结构化数据时明确失败，不猜完整方案。

## 4. 接手与局部修改

上下文包是只读 envelope，**不是独立完整 spec，不能替换原方案**；看到源码位置也不表示取得 ownership。新 Agent 可以先读，再按用户授权和 [协作规则](collaboration.md) 确认可改范围。

用完整源作为基线，保存 source.reviewSha256；仅修改对应 page/component/node/row 和必要引用，按 [authoring-incremental.md](authoring-incremental.md) 合并候选后校验。写前重读 SHA，发生变化就重基于当前源，不能把旧上下文覆盖回去。协作 context/join 输出是兼容的渲染样本，不是原文件写回依据。

只有渲染前保存在 JSON 中的事实会进入 HTML 快照。当前评论、未写回的用户决定、外部设计文件和源码内容仍需分别按引用读取；发现缺失要明确说明，不声称仅凭 HTML 已恢复这些资料。
