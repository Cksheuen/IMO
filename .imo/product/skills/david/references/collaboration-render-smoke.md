# collaboration / source / canvas 可渲染示例 · render-review 端到端 smoke

为 HARD-GATE 28（component `source`）/ 29（`canvas` 页与节点）/ 30（多 agent `collaboration`）
提供一个**同时覆盖三者且真实可渲染**的示例与端到端验证链路。

## 示例 fixture

`examples/collaboration-canvas-review.review.json` ——「创作者发布流重构」双 agent 评审：

- 两个页面：`p-screen`（发布表单，screen）+ `p-canvas`（发布状态机逻辑图，`kind:"canvas"`）。
- `components[].source` 双向覆盖：
  - `publish-form`：`kind:"component"` + `codePaths` + `probe` + `fidelity:"pixel-vs-real"`（path B 真渲染，有真实组件证据）。
  - `publish-flow-board`：`kind:"css-art"` + `fidelity:"structure"`（path A，复用探测失败降级），断言无证据 1:1 被拒绝。
- `collaboration` 清单：agent-a 拥有 `p-screen` + 表单节点，agent-b 拥有 `p-canvas` + 状态机节点，
  `patchOnly:true`、`lease.holder: agent-a` (+ `heartbeatAt`)；`draft-form-fill` / `draft-save-fail`
  故意**不声明归属**，演示「无主节点，改动前先取得 ownership」。
- `state-draft` 节点 `canvas:true` + `interaction:"drilldown"`，子节点挂在画板页。

该 fixture 同时满足 `project/src/lib/reviewSpec.ts` 的 `parseReviewSpec` 与
`project/scripts/render-review.mjs` 的双重校验，可直接渲染成 HTML。

## 运行

```bash
cd project
npm run test:render-e2e        # 单跑：render-review E2E + 协作协议验证
npm run test:david             # 全量测试链（已在末尾接入 test:render-e2e）
node ../scripts/render-review.mjs ../examples/collaboration-canvas-review.review.json /tmp/collab.html   # 直接出 HTML
```

## 验证覆盖（`project/scripts/test-render-review-e2e.mjs`）

### PART A · render-review E2E smoke

用真实模板（`project/dist/template.html`）渲染示例，检查：

| 断言 | 含义 |
|---|---|
| 退出码 0 + 渲染统计 components==2 / pages==2 | 真实渲染链路跑通 |
| target/field 绑定 > 0、mapping-id 注入 ≥ 2 | hover 联动契约注入成功 |
| 正文含 `data-page-id="p-screen"` 与注入的 `data-review-mapping-id` | 页面锚点与契约进正文 |
| `data-review-data` 解析后 pages/kind/source/canvas 存活 | 渲染产物数据完整 |
| `collaboration` 不入渲染页面 | 起草期元数据不泄漏到分享产物（契约证据：`project/scripts/render-review.mjs` 的注入处注释 + 本测试的对应断言） |

### PART B · 协作协议验证（纯逻辑，`project/scripts/collaborationProtocol.mjs`）

| 协议面 | 断言 | 实现 |
|---|---|---|
| ownership | page/node 逐项解析到 owner；未声明=无主；清单引用不悬空 | `parseManifest` / `ownerOf` / `validateOwnershipRefs` |
| patch-only | 自有节点最小 patch 成功、锚点清单不变、邻居 owner 作用域不被触碰；非 owner 改他人节点拒绝且对方编辑保留；整页重写被拒 | `patchOwned` + `verifyPatchOnly` |
| 上下文裁剪 | agent 只带自有页面与「自有节点完整子树」；裁剪结果仍能 `parseReviewSpec` 与独立渲染 | `trimContextFor` |
| 冲突 + lease 合并 | lease 从 manifest 生效：只有 `collaboration.lease.holder` 能提交（非 holder 即便改 own 节点也被拒）；多 owner 合入用 `acquireLease` 逐段交接、编辑互不覆盖；非 owner 篡改被拒不静默合并；持有人按「先取得 ownership」改写无主节点并登记清单；未知 ref 稳定返回 unknown-ref 冲突不崩；租约合法性（holder/心跳/是否声明 owner）| `mergeOwnerPatches` + `patchOwned` + `acquireLease` + `verifyLease` |

lease 语义约定：**ownership 决定能改哪/改什么，`collaboration.lease.holder` 决定何时能提交**——`patchOwned`/`mergeOwnerPatches`
缺省从 manifest 读取 holder，只有当前 holder 能发起写提交（一次只有一个写会话），多 owner 合入时用 `acquireLease` 逐段
交接（agent-a 提交 → `acquireLease(spec,"agent-b")` → agent-b 提交）。未声明租约（旧 spec）时 lease 门控关闭，退化为仅
ownership 门控。与 SKILL HARD-GATE 27「先抢并发租约」同一精神，但约束对象是评审 HTML 数据而非 skill 源码。

### PART C · 裁剪上下文独立渲染

对 `trimContextFor(spec,"agent-a")` 的结果再跑一次 `render-review.mjs`，证明「只带相关上下文的 agent」
拿到的 spec 是自洽、可独立渲染的（对应 SKILL「读侧只把相关上下文带进 prompt」）。
裁剪会**自动保留承载被保留节点锚点的非自有页**（跨页 ownership 场景下也不缺锚点，
见测试「裁剪(M2)」用例），非自有页只作只读上下文、不进入 `collaboration.pages` claims。

## 新增 / 修改协作类示例

1. 复制 `examples/collaboration-canvas-review.review.json` 为新的 `*.review.json`。
2. 保持约束：每个 node 的 `target || id` 都需在 `pages[].pageHtml` 有 `data-review-node-id` 锚点；
   `collaboration.pages[].pageId` 必须命中 `pages`；`nodes[].ref` 命中真实节点/组件。
3. 把新示例接入 `test-render-review-e2e.mjs` 的 fixture 列表，跑 `npm run test:render-e2e` 与 `npm run check`。

## 可执行入口：collaboration-cli.mjs

`project/scripts/collaboration-cli.mjs` 是协作协议的**文件合并入口**，消费
`trimContextFor` / `patchOwned` / `mergeOwnerPatches`，让只带相关上下文的 agent
以「文件」为工作单元：

```bash
# 有界上下文：把 spec 裁剪成 agent 自有范围（自有页 + 自有节点子树 + 锚点所在页）
./scripts/collaboration-cli.mjs context <spec.json> <agent> [--out <file>]
# 提交一条最小 patch（ownership + lease 双门控）；冲突稳定返回 exit 1 且不落盘
./scripts/collaboration-cli.mjs patch <spec.json> <ref> <path> <value-json> \
    [--agent <agent>] [--lease-holder <agent>] [--out <file>]
# 多 owner 顺序合入；当前 collaboration.lease.holder 才可提交，--lease-acquire 交接
./scripts/collaboration-cli.mjs merge <spec.json> <patches.json> \
    [--lease-acquire <agent>] [--out <file>]
```

- `path` 用点号（`label` / `mapping.0.change`，数字段转数组下标）；`value-json` 与
  patches.json 中每个 `value` 为 JSON 字面量（字符串带引号）。
- 退出码：`0` 成功；`1` 冲突/被拒（stdout 为 `{ ok:false, status, reason }`，patch/merge
  冲突**不写 `--out`**，输入 spec 保持原样）；`2` 用法/IO 错误。
- **ownership / lease 分离**：CLI 只读写命令行给定的文件，不触碰运行时源码；其 `--lease-holder`
  默认读自 manifest 的 `collaboration.lease.holder`，与 david-lease.py（canonical 源码租约，
  HARD-GATE 27）是两个不同租约层。
- **自执行入口**：文件带 `#!/usr/bin/env node` + `chmod +x`，可 `./scripts/collaboration-cli.mjs`
  直跑，也可 `node scripts/collaboration-cli.mjs`；已接入 `package.json`：
  `npm run collab:cli -- <sub> ...` 与 `npm run test:collab-cli`（并挂入 `test:david` 链）。
- smoke：`node scripts/test-collaboration-cli.mjs`（真实子进程调用，覆盖 context / patch /
  冲突返回 / merge，16 断言，全部落在 mkdtemp 临时目录）。