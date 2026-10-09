#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * FeedbackTransport 单元回归（纯 Node，无浏览器）：
 * - 默认地址指向 127.0.0.1:5180，尾斜杠被剥离
 * - loopback 覆盖（127.0.0.1 / localhost，http/https，任意端口）被接受
 * - 任何非 loopback / 非 http(s) 地址在构造期直接抛错 —— 传输层 HARD-GATE 25 兜底
 * - dev 钩子 VITE_DAVID_FEEDBACK_BASE_URL 仅在 vite dev/test 下生效，
 *   且同样拒绝非 loopback 值
 *
 * 经 vite middlewareMode 的 ssrLoadModule 加载真源，与浏览器 bundle 走同一份编译。
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function loadTransport(production = false) {
  const server = await createSsrTestServer({
    root: projectRoot,
    ...(production ? { define: { "import.meta.env.DEV": "false" } } : {}),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  try {
    return await server.ssrLoadModule("/src/lib/feedbackTransport.ts");
  } finally {
    await server.close();
  }
}

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`);
    console.log(results.join("\n"));
    console.error(`\nFAILED: ${name}\n${error.stack || error.message}`);
    process.exit(1);
  }
};

// ── 默认值与 loopback 接受 ──────────────────────────────────────────────────
delete process.env.VITE_DAVID_FEEDBACK_BASE_URL;
const mod = await loadTransport();

check("默认 baseUrl 指向 127.0.0.1:5180", () => {
  assert.equal(new mod.FeedbackTransport().baseUrl, "http://127.0.0.1:5180");
});

check("尾斜杠被剥离", () => {
  assert.equal(
    new mod.FeedbackTransport("http://127.0.0.1:59999/").baseUrl,
    "http://127.0.0.1:59999",
  );
});

for (const url of [
  "http://127.0.0.1:59999",
  "http://localhost:59999",
  "https://127.0.0.1:59999",
  "https://localhost:1",
]) {
  check(`loopback 覆盖被接受: ${url}`, () => {
    assert.equal(new mod.FeedbackTransport(url).baseUrl, url);
  });
}

// ── 非 loopback 在构造期拒绝（不产生任何 fetch） ───────────────────────────
for (const url of [
  "http://example.com:5180",
  "http://10.0.0.1:5180",
  "http://192.168.1.2:5180",
  "http://[::1]:5180",
  "file:///tmp/feedback",
  "ws://127.0.0.1:5180",
  "not a url",
]) {
  check(`非 loopback/非 http(s) 地址被拒绝: ${url}`, () => {
    assert.throws(
      () => new mod.FeedbackTransport(url),
      /loopback|非法评论服务地址/,
    );
  });
}

check("导出的 assertLoopbackFeedbackBaseUrl 同样拒绝远端主机", () => {
  assert.throws(
    () => mod.assertLoopbackFeedbackBaseUrl("http://evil.example.org/"),
    /loopback/,
  );
  assert.equal(
    mod.assertLoopbackFeedbackBaseUrl("http://127.0.0.1:5180///"),
    "http://127.0.0.1:5180",
  );
});

// ── dev 钩子：VITE_DAVID_FEEDBACK_BASE_URL ──────────────────────────────────
process.env.VITE_DAVID_FEEDBACK_BASE_URL = "http://127.0.0.1:59999";
const devMod = await loadTransport();
check("dev 钩子覆盖默认地址（vite env）", () => {
  assert.equal(
    new devMod.FeedbackTransport().baseUrl,
    "http://127.0.0.1:59999",
  );
});
check("显式入参仍优先于 dev 钩子", () => {
  assert.equal(
    new devMod.FeedbackTransport("http://localhost:58888").baseUrl,
    "http://localhost:58888",
  );
});

process.env.VITE_DAVID_FEEDBACK_BASE_URL = "http://evil.example.org:5180";
const evilMod = await loadTransport();
check("dev 钩子的非 loopback 值同样被拒绝", () => {
  assert.throws(() => new evilMod.FeedbackTransport(), /loopback/);
});
const productionMod = await loadTransport(true);
check("production 明确忽略 dev 地址覆盖，即使构建环境提供了变量", () => {
  assert.equal(
    new productionMod.FeedbackTransport().baseUrl,
    "http://127.0.0.1:5180",
  );
});
delete process.env.VITE_DAVID_FEEDBACK_BASE_URL;

// Real fetch redirect semantics, without contacting any non-loopback address.
// The destination records requests: rejecting must prevent even health GET and
// POST/PUT bodies from reaching the redirected origin.
let redirectedRequests = 0;
let status = 307;
const destination = http.createServer((req, res) => {
  redirectedRequests++;
  req.resume();
  res.end(JSON.stringify({ doc: {}, version: 1 }));
});
await new Promise((resolve) => destination.listen(0, "127.0.0.1", resolve));
const redirector = http.createServer((req, res) => {
  req.resume();
  res.writeHead(status, {
    Location: `http://127.0.0.1:${destination.address().port}/sink`,
  });
  res.end();
});
await new Promise((resolve) => redirector.listen(0, "127.0.0.1", resolve));
try {
  const transport = new mod.FeedbackTransport(
    `http://127.0.0.1:${redirector.address().port}`,
  );
  for (status of [301, 302, 303, 307, 308]) {
    assert.equal(await transport.health(), false);
    await assert.rejects(
      transport.addEntry("redirect", { text: "private comment" }),
      mod.FeedbackOfflineError,
    );
    await assert.rejects(
      transport.put("redirect", { entries: [] }),
      mod.FeedbackOfflineError,
    );
  }
  check("301/302/303/307/308 重定向不发送 GET、POST 或 PUT 到目标", () =>
    assert.equal(redirectedRequests, 0),
  );
} finally {
  await new Promise((resolve) => redirector.close(resolve));
  await new Promise((resolve) => destination.close(resolve));
}

// A running pre-region-text service must never receive a lossy downgrade.
// The same transport must recover after that service is upgraded in place.
let capabilities = ["multi-selection"];
const writes = [];
const compatibilityServer = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") {
    res.end(JSON.stringify({ ok: true, capabilities }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.method !== "GET") writes.push(JSON.parse(body));
  res.end(JSON.stringify({ doc: { entries: [] }, version: 1 }));
});
await new Promise((resolve) =>
  compatibilityServer.listen(0, "127.0.0.1", resolve),
);
try {
  const transport = new mod.FeedbackTransport(
    `http://127.0.0.1:${compatibilityServer.address().port}`,
  );
  const selection = {
    context: { regionText: { text: "完整选区文字", truncated: false } },
  };
  const original = globalThis.structuredClone(selection);
  const entry = { scope: { selection } };
  const entries = [{ scope: { selections: [selection] } }];
  await transport.load("region");
  await transport.patchEntry("region", "item", { suggestion: "legacy edit" });
  const requests = [
    () => transport.patchEntry("region", "item", { addSelection: selection }),
    () => transport.addEntry("region", entry),
    () => transport.put("region", { entries }),
  ];
  for (const request of requests) {
    await assert.rejects(request, /评论服务版本过旧.*重启.*当前选区已保留/);
  }
  check("旧服务仍能读写旧评论，完整选区写入前提示升级且保留原数据", () => {
    assert.equal(writes.length, 1);
    assert.deepEqual(selection, original);
  });
  capabilities = [...capabilities, "region-text"];
  for (const request of requests) await request();
  check("同一页面重试重新探活，新增评论、追加选区、导入保留 regionText", () => {
    assert.equal(transport.supportsRegionText, true);
    assert.deepEqual(writes.slice(1), [
      { addSelection: selection },
      { entry },
      { doc: { entries } },
    ]);
  });
  capabilities = ["multi-selection"];
  await assert.rejects(requests[0], /评论服务版本过旧/);
  check("服务能力回退时不沿用上次的 region-text 能力", () => {
    assert.equal(transport.supportsRegionText, false);
    assert.equal(writes.length, 4);
  });
} finally {
  await new Promise((resolve) => compatibilityServer.close(resolve));
}

console.log(results.join("\n"));
console.log(JSON.stringify({ ok: true, checks: results.length }, null, 2));
