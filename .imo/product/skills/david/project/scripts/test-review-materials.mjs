import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { createMaterialStore } from "./review-material-store.mjs";
import { fixture } from "./review-fixes-fixture.mjs";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "david-materials-test-"));
const store = createMaterialStore(temp);
const group = { id: "page:p", label: "Page P", pageId: "p" };
const css = '@import "https://example.invalid/never.css";\nbody {color: red}';
const input = {
  id: "css-1",
  group,
  title: "Figma CSS",
  kind: "css",
  content: css,
};
const first = store.add("review", input, 0);
assert.equal(first.version, 1);
assert.equal(store.add("review", input, 0).version, 1);
assert.throws(() => store.add("../outside", input, 0));
assert.throws(() => store.add("review", { ...input, id: "../../x" }, 1));
assert.throws(() => store.add("review", { ...input, content: "different" }, 1));
assert.throws(() => store.add("review", { ...input, id: "stale" }, 0));
assert.throws(() =>
  store.add(
    "review",
    { ...input, id: "badpng", kind: "png", content: "<svg/>" },
    1,
  ),
);
assert.equal(
  fs.readFileSync(store.content("review", "css-1").localPath, "utf8"),
  css,
);
assert.deepEqual(createMaterialStore(temp).read("review"), first);
fs.writeFileSync(path.join(temp, "review", "index.json"), "broken");
assert.throws(() => store.read("review"));
assert.equal(
  fs.readFileSync(path.join(temp, "review", "index.json"), "utf8"),
  "broken",
);
const service = await startBrowserFeedbackService();
const project = fileURLToPath(new URL("../", import.meta.url));
const vite = await startViteServer(project);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(12000);
await service.attach(page);
const spec = fixture({ title: "Materials review" });
spec.service = { baseUrl: service.baseUrl };
service.seed(spec.slug, {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: spec.slug,
  updatedAt: "2026-09-11T00:00:00.000Z",
  mode: "integrated",
  entries: [
    {
      id: "materials-existing-comment",
      category: "visual",
      suggestion: "Existing comment for foreground interaction",
      createdAt: "2026-09-11T00:00:00.000Z",
    },
  ],
});
spec.pages.push({
  id: "second",
  label: "Second page",
  kind: "screen",
  pageHtml: "<section>Second</section>",
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1EAAAAASUVORK5CYII=",
  "base64",
);
const endpoint = `${service.baseUrl}/materials/${spec.slug}`;
const badOrigin = await fetch(endpoint, {
  headers: { Origin: "https://example.invalid" },
});
assert.equal(badOrigin.status, 403);
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().startsWith("https://example.invalid")) external.push(r.url());
});
const load = async () => {
  await page.goto(vite.baseUrl);
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.locator("h1.title", { hasText: spec.title }).waitFor();
  await page.getByRole("button", { name: "设计资料", exact: true }).click();
};
try {
  await load();
  const panel = page.getByTestId("review-materials-panel");
  assert.equal(
    await panel.locator("select").count(),
    0,
    "no prerequisite group/type selectors",
  );
  assert.equal(
    await panel.getByLabel("页面名称", { exact: true }).inputValue(),
    "",
  );
  await panel.getByLabel("页面名称", { exact: true }).fill("Page");
  await panel
    .getByLabel("上传 PNG 或 CSS 文件", { exact: true })
    .setInputFiles({
      name: "First CSS.css",
      mimeType: "text/css",
      buffer: Buffer.from(css),
    });
  await panel.getByRole("button", { name: "保存资料", exact: true }).click();
  await panel
    .getByRole("button", { name: /First CSS.css/ })
    .first()
    .click();
  assert.equal(await panel.locator("pre").innerText(), css);
  assert.equal(
    await panel.locator('[data-material-group="page:page"]').count(),
    1,
  );
  await panel.getByLabel("页面名称", { exact: true }).fill("Second page");
  await panel
    .getByLabel("上传 PNG 或 CSS 文件", { exact: true })
    .setInputFiles({
      name: "Page two.png",
      mimeType: "image/png",
      buffer: png,
    });
  await panel.getByRole("button", { name: "保存资料", exact: true }).click();
  await panel
    .getByRole("button", { name: /Page two.png/ })
    .first()
    .waitFor();
  await panel.getByLabel("页面名称", { exact: true }).fill("Dialog designs");
  let uncertainWrite = true;
  await page.route(`${endpoint}/items`, async (route) => {
    if (uncertainWrite) {
      uncertainWrite = false;
      const saved = await route.fetch();
      assert.equal(saved.status(), 200);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "test uncertain response" }),
      });
    } else await route.continue();
  });
  await panel
    .getByLabel("上传 PNG 或 CSS 文件", { exact: true })
    .setInputFiles({
      name: "Retry CSS.css",
      mimeType: "text/css",
      buffer: Buffer.from(css),
    });
  await panel.getByRole("button", { name: "保存资料", exact: true }).click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "test uncertain response" })
    .waitFor();
  assert.equal(
    await panel.getByLabel("页面名称", { exact: true }).inputValue(),
    "Dialog designs",
  );
  assert.match(
    await panel.locator(".review-materials-draft").innerText(),
    /Retry CSS.css/,
  );
  await panel.getByRole("button", { name: "保存资料", exact: true }).click();
  await panel
    .getByRole("status")
    .filter({ hasText: "资料已保存到本机" })
    .waitFor();
  let doc = await fetch(endpoint).then((r) => r.json());
  assert.equal(doc.items.length, 3);
  assert.equal(
    doc.groups.length,
    3,
    "one-step new page and uncertain retry do not duplicate groups",
  );
  // Pasted CSS remains available without requiring a file or type selector.
  await panel.getByLabel("页面名称", { exact: true }).fill("Unsaved draft");
  await panel.locator(".review-materials-paste summary").click();
  await panel.getByLabel("CSS 内容", { exact: true }).fill(css);
  await panel
    .getByRole("button", { name: "关闭设计资料", exact: true })
    .click();
  await page.getByRole("button", { name: "设计资料", exact: true }).click();
  assert.equal(
    await panel.getByLabel("页面名称", { exact: true }).inputValue(),
    "Unsaved draft",
  );
  assert.equal(
    await panel.getByLabel("CSS 内容", { exact: true }).inputValue(),
    css,
  );
  // Comments and capture remain operable above the supporting panel. Use no real feedback writes.
  const hit = await page.locator(".comment-rail-toggle").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(
      document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
    );
  });
  assert.ok(hit, "comment toggle remains topmost");
  await page.locator(".comment-rail-toggle").click();
  await page.locator(".comment-rail-toggle").click();
  const mode = page.getByRole("button", { name: "进入框选评价模式" });
  await mode.click();
  const box = await panel.getByLabel("页面名称", { exact: true }).boundingBox();
  await page.mouse.move(box.x + 8, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(180, box.width - 10), box.y + 35, {
    steps: 5,
  });
  await page.mouse.up();
  const feedback = page.getByTestId("david-feedback-panel");
  await feedback.waitFor();
  await feedback.getByTestId("feedback-suggestion").fill("Panel comment draft");
  const feedbackHit = await feedback
    .getByTestId("feedback-suggestion")
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        el ===
        document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      );
    });
  assert.ok(feedbackHit);
  await page.keyboard.press("Escape");
  await feedback.waitFor({ state: "hidden" });
  assert.ok(
    await panel.isVisible(),
    "Escape closes foreground feedback, not design draft",
  );
  assert.equal(
    await panel.getByLabel("CSS 内容", { exact: true }).inputValue(),
    css,
  );
  await panel.getByRole("button", { name: "保存资料", exact: true }).click();
  await panel
    .getByRole("status")
    .filter({ hasText: "资料已保存到本机" })
    .waitFor();
  await load();
  await panel
    .getByRole("button", { name: /Page two.png/ })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".review-materials-preview img")?.naturalWidth ===
      1,
  );
  doc = await fetch(endpoint).then((r) => r.json());
  assert.equal(doc.items.length, 4);
  assert.equal(doc.groups.length, 4);
  for (const item of doc.items) {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ["scripts/david-materials-cli.mjs", "get", spec.slug, item.id],
        {
          cwd: project,
          env: {
            ...process.env,
            DAVID_FEEDBACK_PORT: new URL(service.baseUrl).port,
          },
          encoding: "utf8",
        },
      ),
    );
    assert.ok(fs.existsSync(result.localPath));
  }
  const other = await browser.newPage();
  await service.attach(other);
  await other.goto(vite.baseUrl.replace("127.0.0.1", "localhost"));
  await other
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await other.locator("h1.title", { hasText: spec.title }).waitFor();
  await other.getByRole("button", { name: "设计资料", exact: true }).click();
  await other
    .getByRole("button", { name: /First CSS.css/ })
    .first()
    .click();
  assert.equal(
    await other.locator(".review-materials-preview pre").innerText(),
    css,
  );
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    "review materials: page name plus file, one-step new groups, CSS/PNG persistence, retry, paste/draft, foreground comments/capture, CLI, origin guards and narrow layout passed",
  );
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(-2200));
  throw error;
} finally {
  await browser.close();
  await vite.close();
  await service.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
