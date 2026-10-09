# 多 agent 协作同一 review.json

> 适用场景：多个 agent 并行起草 / 修改同一份 `review.json`（分页或分节点 ownership），需要声明协作清单、投递 patch、处理冲突时查阅。渲染层 smoke、字段表与可渲染完整示例见 [collaboration-render-smoke.md](collaboration-render-smoke.md)；schema 字段见 [review-schema.md](review-schema.md)。

新加入且尚无 ownership 的 Agent，先用 [review-context.mjs](read-review.md) 按任务读所需范围，不必先拿身份或恢复原会话。完整源与 SHA 是写回基线；context/join 的裁剪 spec 仅用于兼容渲染，不能覆盖原文件。它可能保留整页样式/总览，不是默认的 Token 优化入口。

## collaboration 清单（对应 HARD-GATE 30）

多个 agent 协作起草同一 `review.json` 时，用顶层可选 `collaboration` 清单声明**谁拥有哪页 / 哪个节点**：

```yaml
collaboration:
  schemaVersion: 1
  patchOnly: true            # 缺省 true：只允许 patch-only 变更
  pages:
    - { pageId: p1, owner: agent-a, session: s1 }
  nodes:
    - { ref: n1, owner: agent-b }
  lease: { holder: agent-a, heartbeatAt: <ISO> }
```

字段规则（`schemaVersion` 必须 1 / 缺省；`pages[].pageId` 必须命中 pages 且唯一；`nodes[].ref` 唯一；`owner` 非空；`lease.holder` 非空、`heartbeatAt` 可选 ISO）以 `project/src/lib/reviewSpec.ts` 与 [review-schema.md](review-schema.md)「多 agent 协作同一 HTML」表为准。

**能做**（allowed）：

- 只改自己拥有（owner 是你当前 session）的 page / node；未声明的内容按「无主」，改动前先取得 ownership。
- 只做 patch-only 变更：对 `pageHtml` / 节点内容做最小 diff，不整页重写。
- 改 canonical skill 源码前继续按 HARD-GATE 27 走 `david-lease.py`（本清单约束的是**评审 HTML 数据**，不是 skill 源码租约）。
- 读侧可读全部页面 / 节点，但只把**任务相关上下文**带进 prompt（优先按页面/节点/行 selector 读取；ownership 只约束写入）。

**不能做**（not allowed）：

- 不改写他人拥有的 page / node；冲突时**重读 + 保留对方编辑 + patch 重试**，绝不静默覆盖（与反馈处理闭环同源语义）。
- 不整页替换他人页面、不删改任何 `data-review-node-id` / `data-component-id` 锚点（视图定位依赖它们）。
- 不跨 ownership 合并：多个 owner 的改动必须分 patch 投递，由各自 owner 或人审核后合入。
- 不绕过校验合并：每次 patch 后必须 `parseReviewSpec` 通过 + 相关测试过，否则回滚重试。

## 与 HARD-GATE 27 canonical 租约的边界

这是**两个不同的租约层**，不可互相替代：

| 维度 | `collaboration` 清单（本文件） | canonical 租约（HARD-GATE 27） |
|---|---|---|
| 约束对象 | 评审 HTML **数据**（`review.json` 的 page/node 内容） | **skill 源码**（canonical 目录的 `project/**`、`SKILL.md`、`references/**`） |
| 谁决定能改 | `pages[].owner` / `nodes[].owner`（ownership 决定改哪/改什么） | `~/.claude/scripts/david-lease.py` 的 holder |
| 谁决定能提交 | `collaboration.lease.holder`（一次只有一个写会话；缺省时门控关闭，退化为仅 ownership 门控） | 租约 holder；被占（exit 3）导出 unified diff 到 `.concurrency/outbox/` |
| 交接方式 | `acquireLease` 逐段交接（agent-a 提交 → holder 转 agent-b → agent-b 提交） | `release` / `fail` 后他人 `acquire` |

协议实现与 CLI 入口：

- 纯逻辑在 `project/scripts/collaborationProtocol.mjs`：`parseManifest` / `ownerOf` / `validateOwnershipRefs` / `patchOwned` / `verifyPatchOnly` / `trimContextFor` / `mergeOwnerPatches` / `acquireLease` / `verifyLease`。
- 文件合并入口 `project/scripts/collaboration-cli.mjs`（或 `npm run collab:cli --`）：
  - `context <spec.json> <agent> [--out <file>]`：裁剪出 agent 自有范围（自有页 + 自有节点完整子树 + 锚点所在非自有页只读保留）；
  - `patch <spec.json> <ref> <path> <value-json> [--agent] [--lease-holder] [--out]`：ownership + lease 双门控的最小 patch，冲突稳定返回 exit 1 且不落盘；
  - `merge <spec.json> <patches.json> [--lease-acquire <agent>] [--out]`：多 owner 顺序合入。
- 退出码：`0` 成功；`1` 冲突/被拒（stdout 为 `{ ok:false, status, reason }`，不写 `--out`，输入 spec 保持原样）；`2` 用法/IO 错误。

端到端验证（含 `npm run test:render-e2e` PART A/B/C 与 `test-collaboration-cli.mjs`）、同时覆盖 collaboration / source / canvas 的 fixture `examples/collaboration-canvas-review.review.json`，见 [collaboration-render-smoke.md](collaboration-render-smoke.md)。
