import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { freePort, startViteCli, stopViteCli } from "./browser-test-server.mjs";
import { fixture } from "./review-fixes-fixture.mjs";

const project = fileURLToPath(new URL("..", import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "david-dev-mode-"));
const copy = path.join(temp, "project");
fs.mkdirSync(path.join(copy, "scripts"), { recursive: true });
fs.cpSync(path.join(project, "src"), path.join(copy, "src"), {
  recursive: true,
});
fs.copyFileSync(
  path.join(project, "package.json"),
  path.join(copy, "package.json"),
);
fs.copyFileSync(
  path.join(project, "scripts/serve-feedback.mjs"),
  path.join(copy, "scripts/serve-feedback.mjs"),
);
fs.copyFileSync(
  path.join(project, "scripts/review-material-store.mjs"),
  path.join(copy, "scripts/review-material-store.mjs"),
);
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const watcher = spawn(
  process.execPath,
  ["--watch", "--watch-preserve-output", "scripts/serve-feedback.mjs"],
  {
    cwd: copy,
    detached: true,
    env: {
      ...process.env,
      IMO_GLOBAL_ROOT: path.join(temp, "imo"),
      DAVID_FEEDBACK_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let stderr = "";
watcher.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-3000);
});
async function healthWhere(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const health = await fetch(`${baseUrl}/health`)
      .then((r) => r.json())
      .catch(() => null);
    if (health && predicate(health)) return health;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`watch service timeout: ${stderr}`);
}
let vite;
let browser;
try {
  const beforeHealth = await healthWhere((h) => h.ok);
  assert.ok(beforeHealth.capabilities.includes("multi-selection"));
  const doc = {
    schema: "david-feedback/v1",
    schemaVersion: 1,
    slug: "review-regression",
    updatedAt: "2026-09-11T00:00:00.000Z",
    mode: "integrated",
    entries: [
      {
        id: "dev-comment",
        category: "visual",
        suggestion: "Preserve this comment through reloads",
        createdAt: "2026-09-11T00:00:00.000Z",
      },
    ],
  };
  const response = await fetch(`${baseUrl}/feedback/${doc.slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc }),
  });
  assert.equal(response.status, 200);
  const readDoc = () =>
    fetch(`${baseUrl}/feedback/${doc.slug}`).then((r) => r.json());
  const beforeDoc = await readDoc();
  const spec = fixture({ title: "Dev <review> & </script>" });
  spec.service = { baseUrl };
  const input = path.join(temp, "review.json");
  fs.writeFileSync(input, JSON.stringify(spec));
  vite = await startViteCli(project, {
    extraEnv: { DAVID_REVIEW_JSON: input },
  });
  const servedHtml = await fetch(vite.baseUrl).then((r) => r.text());
  assert.ok(!servedHtml.includes("data-dev-sample"));
  assert.ok(servedHtml.includes("/@vite/client"));
  assert.ok(servedHtml.includes("/@react-refresh"));
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(vite.baseUrl);
  await page.getByTestId("overview-component-a").waitFor();
  await page.locator('[data-feedback-id="dev-comment"]').waitFor();
  assert.equal(await page.title(), spec.title);
  spec.title = "Dev source updated automatically";
  fs.writeFileSync(input, JSON.stringify(spec));
  await page.waitForFunction((title) => document.title === title, spec.title);
  await page.getByTestId("overview-component-a").waitFor();
  await page.locator('[data-feedback-id="dev-comment"]').waitFor();
  assert.equal(vite.child.exitCode, null);

  // 修改隔离副本中的间接 TS 依赖，验证 Node watch 会重载协议模块。
  fs.appendFileSync(
    path.join(copy, "src/lib/feedback/constants.ts"),
    "\n// watch probe\n",
  );
  const afterHealth = await healthWhere((h) => h.pid !== beforeHealth.pid);
  assert.ok(afterHealth.capabilities.includes("multi-selection"));
  assert.deepEqual(await readDoc(), beforeDoc);
  assert.deepEqual(errors, []);
  console.log(
    "[dev-mode] external JSON auto reload; React dev runtime; watched TS dependency reload; comment and version preserved",
  );
} finally {
  await browser?.close();
  await stopViteCli(vite?.child);
  await stopViteCli(watcher);
  fs.rmSync(temp, { recursive: true, force: true });
}
