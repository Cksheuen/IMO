import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startViteCli, stopViteCli } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
import { fixture } from "./review-fixes-fixture.mjs";
import {
  mergeFeedbackDocuments,
  reorderFeedbackReplies,
} from "../src/lib/davidFeedback.ts";

const project = fileURLToPath(new URL("..", import.meta.url));
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "david-feedback-refinements-"),
);
const future = {
  id: "old-agent",
  body: "Earlier agent reply",
  author: "agent",
  createdAt: "2099-01-01T00:00:00Z",
};
const past = {
  id: "new-user",
  body: "Later user reply",
  createdAt: "2000-01-01T00:00:00Z",
};
const selection = {
  version: 1,
  kind: "appearance-selection",
  capturedAt: "2026-09-11T00:00:00Z",
  surface: "page",
  scene: { pageId: "page", componentId: "a" },
  viewport: { width: 1280, height: 800 },
  windowScroll: { x: 0, y: 0 },
  rect: { nx: 0.1, ny: 0.1, nw: 0.2, nh: 0.2 },
  targets: [
    {
      targetId: "a",
      label:
        "很长的选区说明，用于核对窄评论栏中的文字和字段是否完整换行".repeat(3),
      kind: "review",
    },
  ],
  context: {
    heading: "选区响应式布局验证",
    textSnippet: "保留完整的说明文字。".repeat(12),
    domPath:
      "div.very-long-component-name > span.very-long-field-name > button.field-name",
  },
};
const doc = {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: "review-regression",
  updatedAt: "2026-09-11T00:00:00Z",
  mode: "integrated",
  entries: [
    {
      id: "seed",
      category: "visual",
      suggestion: "Review this selection",
      createdAt: "2026-09-11T00:00:00Z",
      scope: { selection },
      replies: [future],
    },
  ],
};
const incoming = {
  ...doc,
  entries: [{ ...doc.entries[0], replies: [past, future] }],
};
const merged = mergeFeedbackDocuments(doc, incoming);
assert.deepEqual(
  merged.entries[0].replies.map((r) => r.id),
  [future.id, past.id],
);
assert.deepEqual(
  mergeFeedbackDocuments(merged, incoming).entries,
  merged.entries,
);
assert.throws(() => reorderFeedbackReplies(merged, "seed", [future.id]));
assert.throws(() =>
  reorderFeedbackReplies(merged, "seed", [future.id, future.id]),
);
assert.throws(() =>
  reorderFeedbackReplies(merged, "seed", [future.id, "unknown"]),
);
const reordered = reorderFeedbackReplies(merged, "seed", [past.id, future.id]);
assert.deepEqual(reordered.entries[0].replies, [past, future]);
assert.equal(
  reorderFeedbackReplies(reordered, "seed", [past.id, future.id]),
  reordered,
);

const service = await startBrowserFeedbackService();
let vite, browser;
try {
  service.seed(doc.slug, doc);
  const runCli = async (...args) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["scripts/david-feedback-cli.mjs", ...args],
          {
            cwd: project,
            env: {
              ...process.env,
              DAVID_FEEDBACK_PORT: new URL(service.baseUrl).port,
            },
          },
        )
      ).stdout,
    );
  const read = () =>
    fetch(`${service.baseUrl}/feedback/${doc.slug}`).then((r) => r.json());
  const started = Date.now();
  const created = await runCli(
    "reply",
    doc.slug,
    "seed",
    "--body",
    "Server received this now",
  );
  const first = await read();
  const added = first.doc.entries[0].replies.at(-1);
  assert.equal(added.id, created.replyId);
  assert.ok(
    Date.parse(added.createdAt) >= started &&
      Date.parse(added.createdAt) <= Date.now(),
  );
  const repeated = await runCli(
    "reply",
    doc.slug,
    "seed",
    "--body",
    "Server received this now",
  );
  assert.equal(repeated.version, created.version);
  const request = (body) =>
    fetch(`${service.baseUrl}/feedback/${doc.slug}/entries/seed`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await request({ replyOrder: [added.id, future.id] })).status,
    400,
  );
  assert.equal(
    (
      await request({
        expectedVersion: created.version - 1,
        replyOrder: [added.id, future.id],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request({
        expectedVersion: created.version,
        replyOrder: [added.id],
      })
    ).status,
    422,
  );
  assert.equal((await read()).version, created.version);
  const order = [added.id, future.id];
  const ordered = await runCli(
    "reorder-replies",
    doc.slug,
    "seed",
    "--order",
    JSON.stringify(order),
  );
  assert.equal(ordered.verified, true);
  assert.equal(
    (
      await runCli(
        "reorder-replies",
        doc.slug,
        "seed",
        "--order",
        JSON.stringify(order),
      )
    ).version,
    ordered.version,
  );
  // 用户时钟比 Agent 旧也必须追加在最后。
  await fetch(`${service.baseUrl}/feedback/${doc.slug}/entries/seed/replies`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reply: past }),
  });
  assert.deepEqual(
    (await read()).doc.entries[0].replies.map((r) => r.id),
    [...order, past.id],
  );

  const spec = fixture({ title: "Feedback refinements" });
  spec.service = { baseUrl: service.baseUrl };
  spec.pages[0].kind = "screen";
  spec.pages[0].pageHtml =
    spec.pages[0].pageHtml.replace(
      "</section>",
      '<div data-review-overlay-id="boost" style="display:none" class="refinement-boost">Boost</div></section>',
    ) +
    "<style>.refinement-boost.is-overlay-show{display:block!important}</style>";
  const row = spec.components[0].mapping[0];
  row.api.fields = [{ name: "contract", type: "string", target: "contract" }];
  row.trd.apiChange = undefined;
  row.trd.technical = {
    techPoints: [
      {
        title: "openBoostSheet",
        preview: { overlayId: "boost" },
        codeAnnotations: [
          {
            startLine: 1,
            endLine: 1,
            title: "State change",
            bullets: [
              "`openBoostSheet()` calls `setBoostSheetVisible(true)`.",
              "`closeBoostSheet()` resets state to `false`.",
            ],
          },
        ],
        pseudoCode: "const openBoostSheet = () => setBoostSheetVisible(true);",
      },
    ],
  };
  const input = path.join(temp, "review.json");
  fs.writeFileSync(input, JSON.stringify(spec));
  vite = await startViteCli(project, {
    extraEnv: { DAVID_REVIEW_JSON: input },
  });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(vite.baseUrl);
  await page.locator('[data-feedback-id="seed"] .comment-rail-nav').click();
  const list = page.getByTestId("feedback-selection-list");
  await list.locator(".feedback-selection-add").waitFor();
  assert.equal(
    await list
      .locator(".feedback-selections-heading .feedback-selection-add")
      .count(),
    1,
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const dimensions = await list.evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      itemWidths: [...el.querySelectorAll(".feedback-selection-item")].map(
        (x) => [x.clientWidth, x.scrollWidth],
      ),
    }));
    assert.ok(
      dimensions.scroll <= dimensions.width + 1,
      JSON.stringify(dimensions),
    );
    assert.ok(
      dimensions.itemWidths.every(([w, s]) => s <= w + 1),
      JSON.stringify(dimensions),
    );
  }
  const replyTexts = await page
    .locator('[data-feedback-id="seed"] .comment-rail-reply-locate')
    .allTextContents();
  assert.equal(replyTexts.at(-1), past.body);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByTestId("overview-component-a").click();
  assert.equal(
    await page.locator(".inspector .disclosure-interaction-steps").count(),
    0,
  );
  await page
    .locator(".inspector .disclosure-tech-point")
    .filter({ hasText: "openBoostSheet" })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('.component-dock [data-review-overlay-id="boost"]')
      ?.classList.contains("is-overlay-show"),
  );
  await page.locator(".rich-detail .trd-ln.is-annotation").hover();
  await page.locator(".hover-popover").waitFor();
  assert.ok(
    (await page.locator(".hover-popover").innerText()).includes(
      "setBoostSheetVisible(true)",
    ),
  );
  await page.locator(".rich-detail-close").click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.component-dock [data-review-overlay-id="boost"]')
        ?.classList.contains("is-overlay-show"),
  );
  await page
    .locator('.inspector [data-trd-row="row-a"] .disclosure-open')
    .filter({ hasText: "查看接口" })
    .click();
  assert.equal(
    await page.locator('.rich-detail [data-contract-field="contract"]').count(),
    1,
  );
  assert.equal(await page.locator(".rich-detail .api-field").count(), 0);
  await page
    .locator(".rich-detail .dv-contract-card")
    .filter({ has: page.locator('[data-contract-field="contract"]') })
    .locator(":scope > details > summary")
    .click();
  await page.locator('.rich-detail [data-contract-field="contract"]').click();
  await page.locator(".component-dock .field-highlight").first().waitFor();
  row.api.fields[0].type = "number";
  fs.writeFileSync(input, JSON.stringify(spec));
  await page.waitForFunction(
    () =>
      JSON.parse(document.getElementById("review-data").textContent)
        .components[0].mapping[0].api.fields[0].type === "number",
  );
  await page.getByTestId("overview-component-a").click();
  await page
    .locator('.inspector [data-trd-row="row-a"] .disclosure-open')
    .filter({ hasText: "查看接口" })
    .click();
  assert.equal(
    await page.locator('.rich-detail [data-contract-field="contract"]').count(),
    1,
  );
  assert.equal(
    await page.locator(".rich-detail .api-field").count(),
    1,
    "不同类型的字段证据不可被去重删除",
  );
  assert.ok(
    (await page.locator(".rich-detail .api-field").innerText()).includes(
      "number",
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "[feedback-refinements] append order, real timestamp/idempotency, versioned reorder, narrow selection layout, hover code explanations and unique clickable contract fields passed",
  );
} finally {
  await browser?.close();
  await stopViteCli(vite?.child);
  await service.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
