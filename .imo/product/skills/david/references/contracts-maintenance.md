# 维护与上下文契约

维护对应能力时按 HARD-GATE 编号读取；这些是兼容契约，不要求每次生成或读方案全量加载。编号保留，不重新编号。

## HARD-GATE 27

并发编辑租约（多 agent 硬约束）：改 canonical 前必须 `~/.claude/scripts/david-lease.py acquire --intent <摘要> --session <稳定标识>`；`test/check/build` 必须在同一租约内串行执行，长任务前 `refresh` 续期；收尾 `release`，异常 `fail`。**被活跃 holder 占用时（exit 3）不得静默直改**——报出 holder 的 session/intent 交回用户，默认把改动导出为 unified diff 到 `.concurrency/outbox/`（沿用第 12 条 package 模式语义）。租约过期只以 TTL 心跳为判据，holder 进程已死但 TTL 未过期时不得抢占（`status` 的 `pidAlive:false` 仅作诊断）。**本 HARD-GATE 列表与验证清单新增条目只追加编号，禁止重排既有编号**（历史上已因并发追加产生过重复编号 23）。

## HARD-GATE 30

多 agent 协作同一 HTML：顶层可选 `collaboration` 清单声明 page/node ownership（`pages[].owner` / `nodes[].owner` + session）、`patchOnly`（缺省 true）与 `lease`；agent 只改自己拥有的 page/node、只做 patch-only 变更、把相关上下文带进 prompt；不得改写他人拥有的内容、不得删改锚点、不跨 ownership 静默合并；冲突一律重读 + 保留对方编辑 + patch 重试，每次 patch 后必须 `parseReviewSpec` 通过；canonical skill 源码租约仍走第 27 条 `david-lease.py`。

## HARD-GATE 34

Agent 先用 `project/scripts/review-context.mjs <方案位置>` 获取分页目录，再按 selector 读取正文与关联契约；默认不加载 pageHtml 或无关兄弟节点。保留旧 extract-design-context 与唯一内嵌目录契约；磁盘 HTML 的 review-data 可独立恢复语义快照，来源凭据与过期状态明确。上下文包不是可写 spec，不授予 ownership；详见 [read-review.md](read-review.md)。

## HARD-GATE 41

测试分层：引擎代码日常改动优先跑 affected 快层（`npm run test:affected`，unit+ssr 并发），行为变化补对应 browser 定向回归；仅 JSON 或规范修改按[最小改动与验证](authoring-incremental.md#最小改动与验证)，不默认运行引擎测试。引擎交付/发版前全量门控仍走 `npm run test:david`（或 `test:all`），run-tests 只是选择器/调度器，不改变第 27 条 test/check/build 同租约串行语义；browser（playwright）测试必须端口隔离（内核分配或固定隔离端口），不得依赖 5180 或 dev 5173 空闲，browser 层串行执行。

## 对应验证项

- [ ] 并发租约：`david-lease.py acquire` 在被活跃 holder 占用时退出码 3 并报出 holder intent；holder 进程已死但 TTL 未过期时不抢占（`pidAlive:false` 且 `stale:false`）；TTL 过期可回收且 audit.log 有 `reclaimed`；改 canonical 全程持有租约、收尾 `release`
- [ ] 多 agent 协作：`collaboration` manifest 已验证并保存；agent 只 patch 自己拥有的 page/node、不静默覆盖他人内容、patch 后 `parseReviewSpec` 通过
- [ ] design context：渲染页存在唯一 `script#david-design-context` 且 JSON 合法（david-design-context/v1）；`node scripts/extract-design-context.mjs` 对 review.json 与页面 html 均可提取、旧页面退回 json；`node scripts/test-design-context.mjs` 全绿
- [ ] 测试分层门控：按改动类型选择验证；引擎代码日常改动跑 affected 快层，行为变化补对应 browser 回归；引擎发版前全量测试。仅 JSON 或规范修改不套用引擎全量门控；browser 端口隔离且串行，test/check/build 仍在同一租约内串行（第 27 条）
