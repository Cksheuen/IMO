# Design context 与方案读取

现有 `david-design-context/v1` 是渲染页的兼容目录，由 `project/src/lib/designContext.ts` 统一生成，摘要字段各限 120 字符；它不是完整实现依据，也不承诺整份目录大小有界。

新 Session/Agent 默认用 [read-review.md](read-review.md) 的 `review-context.mjs`：目录分页、正文按 selector 读取、契约与 ownership 分离、预算超限报错。只给 HTML 也可通过内嵌 review-data 读取语义快照；当前源定位另核对 renderer 的 `david-review-source/v1`，不混用 PRD sourcePath。

## 兼容提取器

`node project/scripts/extract-design-context.mjs <review.json|page.html> [--pretty]` 保持原接口：JSON 路径复用 designContext.ts；HTML 路径读取唯一内嵌目录。旧页缺少目录时此命令报错，可改用新读取器从 review-data 恢复快照，不再要求 Agent 自行解析整份 JSON。

## 生成侧契约

渲染器在磁盘 HTML 写唯一 `script#david-design-context`，React 启动后由 App 的当前数据目录替换；两份 renderer 与 CLI 共用纯函数，JSON 必须 HTML 转义。`script#david-review-source` 绑定实际渲染输入，不改变 review schema。内嵌 review-data 可供离线读取；默认分享产物不包含 collaboration ownership，原源核验后才可取得真实协作信息。

协议验证覆盖 render → disk HTML → extract 兼容目录，以及新读取器的 JSON/HTML/URL、正文引用、版本与输出预算。锚点/三列/代码块词汇表见 [agent-readable-html.md](agent-readable-html.md)，不用一次加载其全部章节。
