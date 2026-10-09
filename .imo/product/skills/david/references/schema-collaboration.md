# 协作字段

## 多 agent 协作同一 HTML（HARD-GATE 30）

顶层可选 `collaboration`（见 `project/src/lib/reviewSpec.ts` 校验）：

```json
"collaboration": {
  "schemaVersion": 1,
  "patchOnly": true,
  "pages": [{ "pageId": "p1", "owner": "agent-a", "session": "s1" }],
  "nodes": [{ "ref": "n1", "owner": "agent-b" }],
  "lease": { "holder": "agent-a", "heartbeatAt": "2026-09-08T00:00:00Z" }
}
```

| 字段 | 规则 |
|---|---|
| `schemaVersion` | 必须 1（或缺省） |
| `patchOnly` | 布尔，缺省 true：只允许 patch-only 变更 |
| `pages[]` | `pageId` 必须命中 pages 且唯一；`owner` 非空；可选 `session` |
| `nodes[]` | `ref` 唯一（为节点 / component id）；`owner` 非空；可选 `session` |
| `lease` | `holder` 非空；可选 `heartbeatAt`（ISO 字符串） |

协作约束与能做/不能做清单见 SKILL「## 多 agent 协作同一 HTML」。
同时覆盖 collaboration / source / canvas 的**可渲染完整示例与端到端验证**见 `references/collaboration-render-smoke.md`（示例在 `examples/collaboration-canvas-review.review.json`，验证跑 `npm run test:render-e2e`）。

## Agent 协作接入

新 agent 先获取裁剪后的协作上下文：

```bash
node scripts/collaboration-cli.mjs join review.json agent-a \
  --session session-123 \
  --out agent-a.context.json
```

输出 `david-collaboration-context/v1`，包括 ownership、lease、patch-only 规则和只含相关页面/节点的 review spec。写入仍必须通过 `patch` / `merge`，不能直接改写他人 ownership 范围。
