# Declarative Memory Contract (Minimal)

## Purpose

`memory/declarative/` stores only cross-session stable facts.

This namespace is for fact snapshots (what is stably true), not process history (what happened during one task/session).

## Ownership

- Owner (write authority): `promote-notes`.
- Non-owner flows (e.g. `eat`) may propose candidate facts, but MUST NOT write `memory/declarative/*` directly.

## Hard Boundaries

- Allow: stable user preferences, stable workspace constraints, stable environment facts.
- Deny (hard reject):
  - note body / note full text
  - recall summary (including recall pipeline summaries)
  - task status / feature progress
  - transcript steps / debugging timeline
  - temporary TODOs
- Read rule: consume only records with `status: "active"`.
- Write rule: `upsert` by primary key `subject + key`.

## Read-Side Contract (Minimal)

- Consumer path: 当前最小 consumer 通过 `UserPromptSubmit -> hooks/recall-entrypoint.py` 注入，不新增独立 writer。
- Read filter:
  - 只读取 `memory/declarative/index.json` 注册的文件
  - 只消费 `status: "active"` 且 `scope: "cross-session"` 的记录
  - 读取后按 `subject + key` 去重
  - registry 与 leaf record 不一致时 fail-closed，直接跳过冲突项
  - fail-closed 冲突可写入 runtime 审计日志（best-effort append），但不改变 skip 行为
- Render rule:
  - 只渲染极短 snapshot，不注入长段解释
  - 默认走小预算（建议 `<= 220 chars`）
  - 使用 fenced context，明确标注“不是新的用户输入”
- Runtime semantics:
  - 优先理解为 session-frozen snapshot
  - 若当前 hook 路径无法真实冻结，可接受 deterministic per-turn fallback
- Non-goals:
  - 不在 read path 中做事实推断、聚合总结、用户建模
  - 不把 recall store / notes / tasks 混入 declarative snapshot
  - 不自动修复 registry / leaf 冲突；冲突只记录为 runtime 跳过条件
  - 审计日志仅用于可追踪性，不赋予 runtime 写入 declarative record 的能力

## Separation From Locate Index

- `memory/index.json` (locate) is a code-location index (L1/L2/L3).
- `memory/declarative/index.json` is a declarative registry only.
- Declarative registry MUST NOT use locate fields like `level`, `sourcePath`, `project`, or code-summary indexing semantics.

## Canonical Record Schema

```json
{
  "id": "subject.key-slug",
  "kind": "preference | constraint | environment",
  "subject": "user | workspace | runtime",
  "key": "dot.notation.key",
  "value": "any JSON value",
  "valueType": "string | number | boolean | object | array",
  "scope": "cross-session",
  "status": "active | deprecated | revoked",
  "source": {
    "type": "explicit-user | file | runtime-context",
    "ref": "conversation/file/context reference"
  },
  "updatedAt": "YYYY-MM-DD",
  "lastVerifiedAt": "YYYY-MM-DD"
}
```

## Validation Rules (Minimal)

- `subject + key` is unique in this namespace.
- `scope` must be `cross-session`.
- uncertain or non-verifiable facts should not be written.
- when a fact changes, upsert same `subject + key` and refresh `updatedAt`/`lastVerifiedAt`.

## Fail-Closed Cases

以下情况必须静默跳过，不能猜测或自动修正：

- `index.json` 未注册该 leaf file
- registry `file` 与 leaf file 不一致
- registry 与 leaf 的 `id` / `kind` / `subject` / `key` 不一致
- 同一 `subject + key` 出现多个不同有效 leaf record
- record 缺失 `value`、`status=active`、或 `scope=cross-session`

consumer 的职责是“只读且保守”，不是修复数据层。

## Fail-Closed Audit Log (Read-Side)

- 用途：仅审计 fail-closed 冲突，便于追踪为何跳过某条记录。
- 边界：日志写入不参与事实消费决策，不影响 snapshot 的保守输出，不突破 consumer/read-only 边界。
- 最小字段：`timestamp`、`reason`、`subjectKey(subject+key)`、`leafFile`。
