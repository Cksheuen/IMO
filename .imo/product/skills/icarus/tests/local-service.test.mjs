import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerDocument } from "../scripts/local/store.mjs";
import { startService } from "../scripts/local/server.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-channel-test-"));
const source = path.join(root, "source.html");
fs.writeFileSync(source, "<p>测试</p>");
const config = registerDocument(source, source, root);
let service = await startService(root);
const cases = [];
const pass = (name) => cases.push(name);
const call = async (method, suffix = "", body, headers = {}) => {
  const response = await fetch(
    `${service.baseUrl}/feedback/${config.id}${suffix}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Connection: "close",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  return { status: response.status, data: await response.json() };
};
const make = (id) => ({
  id,
  comment: `comment ${id}`,
  source: config.source,
  status: "open",
  createdAt: new Date().toISOString(),
  selection: {
    kind: "region",
    text: "测试",
    truncated: false,
    anchors: ["p"],
    rect: { x: 0, y: 0, width: 30, height: 30 },
    viewport: { width: 100, height: 100 },
    scroll: { x: 0, y: 0 },
    capturedAt: new Date().toISOString(),
  },
});
try {
  assert.equal((await call("GET")).data.version, 0);
  const a = make("a"),
    b = make("b");
  const results = await Promise.all([
    call("POST", "/entries", { expectedVersion: 0, entry: a }),
    call("POST", "/entries", { expectedVersion: 0, entry: b }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const failed = results[0].status === 409 ? a : b;
  const current = await call("GET");
  assert.equal(
    (
      await call("POST", "/entries", {
        expectedVersion: current.data.version,
        entry: failed,
      })
    ).status,
    200,
  );
  assert.equal((await call("GET")).data.doc.entries.length, 2);
  pass("concurrent append CAS preserves both comments after retry");
  assert.equal(
    (await call("POST", "/entries", { expectedVersion: 0, entry: a })).status,
    200,
  );
  assert.equal((await call("GET")).data.version, 2);
  pass("same-id replay is idempotent");
  const invalid = { ...make("invalid"), unexpected: true };
  assert.equal(
    (await call("POST", "/entries", { expectedVersion: 2, entry: invalid }))
      .status,
    422,
  );
  assert.equal(
    (await call("GET", "", undefined, { Authorization: "Bearer wrong" }))
      .status,
    403,
  );
  assert.equal(
    (await call("GET", "", undefined, { Origin: "https://example.com" }))
      .status,
    403,
  );
  const invalidHost = await new Promise((resolve) => {
    const req = http.get(
      service.baseUrl + "/health",
      { headers: { Host: "evil.invalid" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", () => resolve(-1));
  });
  assert.equal(invalidHost, 403);
  assert.equal((await call("GET")).data.version, 2);
  pass("invalid schema/token/origin/host cannot change storage");
  const reply = { id: "agent-test", body: "done", author: "agent" };
  assert.equal(
    (
      await call("POST", "/replies", {
        expectedVersion: 2,
        entryId: "a",
        reply,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("POST", "/replies", {
        expectedVersion: 2,
        entryId: "a",
        reply,
      })
    ).status,
    200,
  );
  const state = (await call("GET")).data;
  assert.equal(state.doc.entries.find((e) => e.id === "a").replies.length, 1);
  assert.equal(state.doc.entries.find((e) => e.id === "a").status, "open");
  pass("reply persisted once without resolving user feedback");
  const port = service.baseUrl;
  await service.close();
  service = await startService(root);
  assert.equal(service.baseUrl, port);
  assert.deepEqual((await call("GET")).data, state);
  pass("service restart keeps URL, comments, replies and version");
  fs.writeFileSync(path.join(root, "theme.css"), "body{color:blue}");
  const asset = await fetch(`${service.baseUrl}/review/${config.id}/theme.css`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "body{color:blue}");
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-outside-"));
  try {
    fs.writeFileSync(path.join(other, "secret.js"), "secret");
    fs.symlinkSync(path.join(other, "secret.js"), path.join(root, "escape.js"));
    assert.equal(
      (await fetch(`${service.baseUrl}/review/${config.id}/escape.js`)).status,
      403,
    );
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
  pass("preview relative asset works; symlink outside source root rejected");
  const file = path.join(root, "feedback", `${config.id}.json`);
  fs.writeFileSync(file, "{bad");
  assert.equal((await call("GET")).status, 500);
  assert.equal(
    (await call("POST", "/entries", { expectedVersion: 0, entry: make("c") }))
      .status,
    500,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "{bad");
  pass("corrupt storage is not overwritten");
  console.log(JSON.stringify({ status: "pass", cases }));
} finally {
  await service.close();
  fs.rmSync(root, { recursive: true, force: true });
}
