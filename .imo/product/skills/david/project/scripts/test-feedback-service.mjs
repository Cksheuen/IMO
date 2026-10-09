#!/usr/bin/env node
/**
 * 评论服务回归测试。
 *
 * 自起 daemon（随机空闲端口，绝不占用默认 5180 以免撞用户在跑的实例），
 * 存储指向 mkdtemp 临时目录（绝不污染真实 ~/.imo），跑完清理。
 *
 * 用法：node scripts/test-feedback-service.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "david-feedback-test-"));

/** 取一个空闲端口：绑 0 让内核分配，读回后立即释放。 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;

const daemon = spawn(
  process.execPath,
  [path.join(HERE, "serve-feedback.mjs")],
  {
    env: {
      ...process.env,
      IMO_GLOBAL_ROOT: tmpRoot,
      DAVID_FEEDBACK_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let daemonStderr = "";
daemon.stderr.on("data", (chunk) => {
  daemonStderr += chunk.toString();
});

const cleanup = () => {
  if (!daemon.killed) daemon.kill("SIGTERM");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
};
process.on("exit", cleanup);

const waitReady = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没监听，继续等 */
    }
    if (daemon.exitCode !== null) {
      throw new Error(
        `daemon 提前退出（code ${daemon.exitCode}）:\n${daemonStderr}`,
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`daemon 启动超时:\n${daemonStderr}`);
};

const call = async (method, urlPath, body) => {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : {},
    headers: res.headers,
  };
};

const entry = (over = {}) => ({
  id: "e1",
  category: "visual",
  suggestion: "按钮对比度不足",
  createdAt: "2026-09-08T00:00:00.000Z",
  ...over,
});

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`);
    // 失败时也要主动收尾退出：daemon 的 stdio pipe 会让事件循环保持活跃，
    // 直接抛出会让进程挂住而不是报错退出。
    console.log(results.join("\n"));
    console.error(`\nFAILED: ${name}\n${error.message}`);
    cleanup();
    process.exit(1);
  }
};

const health = await waitReady();
check("health 返回 ok", () => {
  assert.equal(health.ok, true);
  assert.equal(health.port, port);
});

// ── 新增与读取 ──────────────────────────────────────────────────────────────
const created = await call("POST", "/feedback/demo/entries", {
  entry: entry(),
});
check("POST entries 新增成功", () => {
  assert.equal(created.status, 200);
  assert.equal(created.body.doc.entries.length, 1);
  assert.equal(created.body.version, 1);
});

const fetched = await call("GET", "/feedback/demo");
check("GET 命中新增条目", () => {
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.doc.entries[0].id, "e1");
  assert.equal(fetched.headers.get("etag"), '"1"');
});

const missing = await call("GET", "/feedback/nosuchslug");
check("GET 未知 slug → 404", () => assert.equal(missing.status, 404));

// ── schema 校验：未知字段必须被拒且不污染落盘 ────────────────────────────────
const docFile = path.join(tmpRoot, "runtime", "david", "feedback", "demo.json");
const before = fs.readFileSync(docFile, "utf8");
const bad = await call("POST", "/feedback/demo/entries", {
  entry: entry({ id: "evil", evilField: "boom" }),
});
check("未知字段 → 422", () => {
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /未知或危险字段/);
});
check("422 后落盘文件未被污染", () => {
  assert.equal(fs.readFileSync(docFile, "utf8"), before);
});

// ── reply 幂等与冲突 ────────────────────────────────────────────────────────
const reply = {
  id: "r1",
  body: "已修复",
  createdAt: "2026-09-08T01:00:00.000Z",
};
const firstReply = await call("PATCH", "/feedback/demo/entries/e1/replies", {
  reply,
});
check("首次追加 reply（内容变化 → 版本推进）", () => {
  assert.equal(firstReply.status, 200);
  assert.equal(firstReply.body.doc.entries[0].replies.length, 1);
  assert.equal(firstReply.body.version, 2, "首次写内容变化，版本应从 1 → 2");
});

const replayed = await call("PATCH", "/feedback/demo/entries/e1/replies", {
  reply,
});
check("同 id 同内容重放 → 幂等，replies 不增", () => {
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.doc.entries[0].replies.length, 1);
});
check("同 id 同内容重放 → 无内容写不 bump 版本", () => {
  assert.equal(
    replayed.body.version,
    2,
    "无内容变化的幂等重放版本必须保持不变",
  );
});

const clash = await call("PATCH", "/feedback/demo/entries/e1/replies", {
  reply: { ...reply, body: "换了内容" },
});
check("同 id 异内容 → 409 且回带当前状态", () => {
  assert.equal(clash.status, 409);
  assert.ok(clash.body.currentDoc, "409 必须回带 currentDoc 供重读重放");
  assert.equal(typeof clash.body.currentVersion, "number");
});

const missingEntry = await call(
  "PATCH",
  "/feedback/demo/entries/nope/replies",
  { reply },
);
check("reply 到不存在的 entry → 404", () =>
  assert.equal(missingEntry.status, 404),
);

// ── base 字段冲突的整稿导入 ─────────────────────────────────────────────────
const current = (await call("GET", "/feedback/demo")).body;
const conflictingPut = await call("PUT", "/feedback/demo", {
  doc: {
    ...current.doc,
    entries: [{ ...current.doc.entries[0], suggestion: "被悄悄改掉的原文" }],
  },
});
check("base 字段冲突的 PUT → 409", () => {
  assert.equal(conflictingPut.status, 409);
  assert.match(conflictingPut.body.error, /冲突/);
});

// ── 乐观并发 ────────────────────────────────────────────────────────────────
const staleVersion = await call("POST", "/feedback/demo/entries", {
  expectedVersion: 999,
  entry: entry({ id: "e2" }),
});
check("expectedVersion 不符 → 409 且带 currentVersion", () => {
  assert.equal(staleVersion.status, 409);
  assert.equal(typeof staleVersion.body.currentVersion, "number");
});

// ── 路径穿越 ────────────────────────────────────────────────────────────────
// 注意：必须用百分号编码。裸 "." / ".." / "../" 会被 URL 规范化吃掉，
// 请求根本到不了服务端的 slug 校验，测出来的 404 是假阴性。
for (const attack of [
  "/feedback/..%2F..%2Fetc%2Fpasswd",
  "/feedback/%2E",
  "/feedback/has%20space",
  "/feedback/%2Fetc%2Fpasswd",
  "/feedback/", // slug 缺失
]) {
  const res = await call("GET", attack);
  check(`路径穿越/非法 slug 被拒: ${attack}`, () => {
    assert.equal(res.status, 400, `期望 400，实际 ${res.status}`);
    assert.match(res.body.error, /slug 非法/);
  });
}
// `%2E%2E` 会被 fetch 折叠掉整段路径（服务端只收到 "/"），落在 404 未知路径分支。
// 这同样是安全的——只是语义是「路径不存在」而非「slug 非法」。
const collapsed = await call("GET", "/feedback/%2E%2E");
check("%2E%2E 被 URL 规范化折叠 → 404 未知路径（不读任何文件）", () => {
  assert.equal(collapsed.status, 404);
});
check("穿越攻击未在存储目录外留下任何文件", () => {
  const stored = fs.readdirSync(
    path.join(tmpRoot, "runtime", "david", "feedback"),
  );
  assert.deepEqual(
    stored.filter((f) => !f.startsWith(".")).sort(),
    ["demo.json"],
    `存储目录只应有 demo.json，实际: ${stored.join(", ")}`,
  );
});

// ── 状态与决议 ──────────────────────────────────────────────────────────────
const statusPatch = await call("PATCH", "/feedback/demo/entries/e1", {
  status: "resolved",
});
check("PATCH status", () => {
  assert.equal(statusPatch.status, 200);
  assert.equal(statusPatch.body.doc.entries[0].status, "resolved");
});

// decision 只对 agent 提议有意义（davidFeedback.ts 的 setFeedbackEntryDecision
// 对 origin !== "agent" 直接抛错）。先建一条 agent 条目再验。
const agentEntry = await call("POST", "/feedback/demo/entries", {
  entry: entry({ id: "a1", origin: "agent", suggestion: "建议收敛按钮层级" }),
});
check("新增 origin=agent 条目", () => {
  assert.equal(agentEntry.status, 200);
  const created = agentEntry.body.doc.entries.find((e) => e.id === "a1");
  assert.equal(created.origin, "agent");
});

const decisionPatch = await call("PATCH", "/feedback/demo/entries/a1", {
  decision: "accepted",
});
check("PATCH decision（agent 条目）", () => {
  assert.equal(decisionPatch.status, 200);
  const target = decisionPatch.body.doc.entries.find((e) => e.id === "a1");
  assert.equal(target.decision, "accepted");
});

const userDecision = await call("PATCH", "/feedback/demo/entries/e1", {
  decision: "accepted",
});
check("user 条目设 decision → 被拒（只有 agent 提议可采纳）", () => {
  assert.equal(userDecision.status, 422);
  assert.match(userDecision.body.error, /只有 agent 提议可设置采纳决议/);
});

const emptyPatch = await call("PATCH", "/feedback/demo/entries/e1", {});
check("PATCH 无任何字段 → 400", () => assert.equal(emptyPatch.status, 400));

// ── 索引 ────────────────────────────────────────────────────────────────────
const index = await call("GET", "/index");
check("GET /index 返回 david-feedback-index/v1", () => {
  assert.equal(index.status, 200);
  assert.equal(index.body.schema, "david-feedback-index/v1");
  const item = index.body.items.find((i) => i.slug === "demo");
  assert.ok(item, "索引应含 demo");
  assert.equal(typeof item.version, "number");
});

// ── 删除及并发保护（独立文档，不影响前面的版本断言） ──────────────────────
await call("POST", "/feedback/delete-demo/entries", {
  entry: entry({ id: "obsolete-agent", origin: "agent" }),
});
const beforeDelete = await call("POST", "/feedback/delete-demo/entries", {
  entry: entry({ id: "keep-user", origin: "user", status: "resolved" }),
});
const missingDeleteVersion = await call(
  "DELETE",
  "/feedback/delete-demo/entries/obsolete-agent",
  {},
);
check("DELETE 无版本拒绝写入", () =>
  assert.equal(missingDeleteVersion.status, 400),
);
const staleDelete = await call(
  "DELETE",
  "/feedback/delete-demo/entries/obsolete-agent",
  { expectedVersion: 1 },
);
check("DELETE 旧版本返回 409 并保留新评论", () => {
  assert.equal(staleDelete.status, 409);
  assert.deepEqual(staleDelete.body.currentDoc, beforeDelete.body.doc);
});
const deletion = await call(
  "DELETE",
  "/feedback/delete-demo/entries/obsolete-agent",
  { expectedVersion: beforeDelete.body.version },
);
check("DELETE 只删除指定条目并推进版本", () => {
  assert.equal(deletion.status, 200);
  assert.equal(deletion.body.version, beforeDelete.body.version + 1);
  assert.deepEqual(deletion.body.doc.entries, [
    beforeDelete.body.doc.entries[1],
  ]);
});
const deletedReadback = await call("GET", "/feedback/delete-demo");
check("DELETE 回读与落盘一致", () => {
  assert.deepEqual(deletedReadback.body, deletion.body);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(tmpRoot, "runtime/david/feedback/delete-demo.json"),
        "utf8",
      ),
    ),
    deletion.body.doc,
  );
});
const repeatDelete = await call(
  "DELETE",
  "/feedback/delete-demo/entries/obsolete-agent",
  { expectedVersion: deletion.body.version },
);
check("DELETE 已不存在的条目返回 404", () =>
  assert.equal(repeatDelete.status, 404),
);

// ── CORS ────────────────────────────────────────────────────────────────────
const preflight = await fetch(`${BASE}/feedback/demo`, { method: "OPTIONS" });
check("OPTIONS 预检返回 CORS 头", () => {
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-methods"), /PATCH/);
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
});

// ── 存储位置 ────────────────────────────────────────────────────────────────
check("数据落在 IMO_GLOBAL_ROOT 下，未污染真实 ~/.imo", () => {
  assert.ok(fs.existsSync(docFile), `期望存在 ${docFile}`);
  assert.ok(docFile.startsWith(tmpRoot));
});

console.log(results.join("\n"));
console.log(
  JSON.stringify(
    { ok: true, checks: results.length, port, store: tmpRoot },
    null,
    2,
  ),
);

// 显式收尾并退出：daemon 的 stdio pipe 会让 Node 事件循环保持活跃，
// 仅靠 process.on("exit") 的 SIGTERM 不足以让本进程自然结束。
cleanup();
process.exit(0);
