import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fixture } from "./review-fixes-fixture.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";

// Delivery smoke: uses built dist/template.html over plain HTTP, with no Vite
// transform or source injection. Build first whenever the production source changes.
const project = fileURLToPath(new URL("../", import.meta.url));
const canonical = path.dirname(project.replace(/\/$/, ""));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "david-built-html-"));
const service = await startBrowserFeedbackService();
const spec = fixture({
  title: 'Built </script> &lt; " directory',
  status: "confirmed",
});
spec.components.forEach((component) => {
  component.children[0].mappingIds = [component.mapping[0].id];
});
spec.pages.push({ ...spec.pages[0], id: "second", label: "Second" });
const input = path.join(temp, "fixture.json");
fs.writeFileSync(input, JSON.stringify(spec));
let server, browser;
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, DAVID_FEEDBACK_BASE_URL: service.baseUrl },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
try {
  const extractor = path.join(project, "scripts/extract-design-context.mjs");
  const expected = JSON.parse(run(extractor, [input]));
  let html;
  for (const [index, root] of [project, canonical].entries()) {
    const output = path.join(temp, `render-${index}.html`);
    run(path.join(root, "scripts/render-review.mjs"), [input, output]);
    assert.deepEqual(JSON.parse(run(extractor, [output])), expected);
    const content = fs.readFileSync(output, "utf8");
    if (html) assert.equal(content, html);
    html = content;
  }
  const embedded = JSON.parse(
    html.match(/<script[^>]*id="review-data"[^>]*>([\s\S]*?)<\/script>/)[1],
  );
  for (const page of embedded.pages) {
    assert.ok(
      page.pageHtml.includes('data-review-mapping-id="a:row-a"'),
      "every page receives mapping targets on disk",
    );
  }
  // Production must ignore a dev sample marker, even if present in authored HTML.
  html = html.replace(
    'id="review-root"',
    'id="review-root" data-dev-sample="video-conversion-shooting-guide"',
  );
  server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByTestId("overview-component-a").waitFor();
  assert.equal(await page.locator("h1.title").textContent(), spec.title);
  assert.equal(await page.locator("#david-design-context").count(), 1);
  assert.deepEqual(
    await page
      .locator("#david-design-context")
      .evaluate((el) => JSON.parse(el.textContent)),
    expected,
  );
  await page
    .locator('.page-frame [data-test-control="details-a"] summary')
    .click();
  await page.locator(".component-dock.is-visible:not(.flip-morph)").waitFor();
  assert.equal(
    await page
      .locator('.component-dock [data-test-control="details-a"]')
      .evaluate((el) => el.open),
    true,
  );
  await page
    .locator('[data-testid="david-breadcrumb"] button')
    .filter({ hasText: "总览" })
    .click();
  await page
    .locator(".page-stack button")
    .filter({ hasText: "Second" })
    .click();
  await page
    .locator('.page-frame [data-review-mapping-id="a:row-a"]')
    .waitFor();
  assert.equal(
    await page
      .locator('.page-frame [data-review-mapping-id="a:row-a"]')
      .getAttribute("data-review-node-id"),
    "node-a",
  );
  const updated = fixture({
    title: "Built imported proposed",
    status: "proposed",
  });
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "updated.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(updated)),
    });
  await page
    .getByRole("heading", { name: updated.title, exact: true, level: 1 })
    .waitFor();
  for (const card of await page
    .locator('[data-contract-id="contract-1"]')
    .all())
    assert.equal(await card.getAttribute("data-contract-status"), "proposed");
  assert.equal(await page.locator("#david-design-context").count(), 1);
  assert.equal(
    await page
      .locator("#david-design-context")
      .evaluate((el) => JSON.parse(el.textContent).title),
    updated.title,
  );
  assert.deepEqual(errors, []);
  console.log(
    "generated HTML: both renderers -> disk extract -> production React -> native details -> JSON import contract/directory refresh passed",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await service.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
