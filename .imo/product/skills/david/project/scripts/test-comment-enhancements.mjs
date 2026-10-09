import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
import { fixture } from "./review-fixes-fixture.mjs";
import {
  appendFeedbackSelection,
  feedbackSelections,
  parseFeedback,
} from "../src/lib/davidFeedback.ts";
import { parseReviewSpec } from "../src/lib/reviewSpec.ts";

const selection = (n = 1) => ({
  version: 1,
  kind: "appearance-selection",
  capturedAt: "2026-09-11T00:00:0" + n + ".000Z",
  surface: "page",
  scene: { pageId: "page", componentId: "a" },
  viewport: { width: 1440, height: 900 },
  windowScroll: { x: 0, y: 0 },
  rect: { nx: 0.04, ny: 0.1, nw: 0.1, nh: 0.1 },
  targets: [{ targetId: "a", label: "Region " + n, kind: "review" }],
});
const seed = parseFeedback({
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: "review-regression",
  updatedAt: "2026-09-11T00:00:00.000Z",
  mode: "integrated",
  entries: [
    {
      id: "seed",
      category: "visual",
      suggestion: "Existing comment",
      createdAt: "2026-09-11T00:00:00.000Z",
      scope: { selection: selection() },
    },
  ],
});
const two = appendFeedbackSelection(seed, "seed", selection(2));
assert.equal(feedbackSelections(two.entries[0].scope).length, 2);
assert.equal(appendFeedbackSelection(two, "seed", selection(2)), two);
assert.equal(feedbackSelections(seed.entries[0].scope).length, 1);
assert.deepEqual(parseFeedback(two).entries[0].scope.selection, selection());
assert.throws(
  () =>
    parseFeedback({
      ...two,
      entries: [
        {
          ...two.entries[0],
          scope: {
            selections: Array.from({ length: 9 }, (_, i) => selection(i)),
          },
        },
      ],
    }),
  /selections/,
);
assert.throws(
  () =>
    parseFeedback({
      ...two,
      entries: [
        {
          ...two.entries[0],
          scope: { selections: [{ ...selection(), unknown: true }] },
        },
      ],
    }),
  /unknown/,
);
assert.throws(
  () =>
    parseFeedback({
      ...two,
      entries: [
        {
          ...two.entries[0],
          scope: { selection: selection(3), selections: [selection()] },
        },
      ],
    }),
  /一致/,
);
const spec = fixture({
  title: "Comment enhancements",
  height: 430,
  status: "proposed",
});
spec.pages[0].kind = "screen";
spec.components[0].children[0].mappingIds = ["row-a"];
spec.components[0].mapping[0].trd.technical = {
  heading: "Interactions",
  techPoints: [
    {
      title: "Show Boost",
      preview: { overlayId: "boost" },
      bullets: ["Open the controlled sheet."],
    },
    {
      title: "Show Share",
      preview: { overlayId: "share" },
      bullets: ["Open the share panel."],
    },
  ],
};
spec.pages[0].pageHtml +=
  "<style>.enhancement-overlay{display:none;position:absolute;top:80px;left:20px;background:white;padding:16px;z-index:10}.enhancement-overlay.is-overlay-show{display:block}</style>";
spec.pages[0].pageHtml = spec.pages[0].pageHtml.replace(
  "</section>",
  '<button data-review-overlay="boost" data-testid="manual-boost">Open manually</button><div class="enhancement-overlay" data-review-overlay-id="boost" data-review-element-id="boost">Boost sheet</div><div class="enhancement-overlay" data-review-overlay-id="share" data-review-element-id="share">Share panel</div></section>',
);
parseReviewSpec(spec);
const invalid = JSON.parse(JSON.stringify(spec));
invalid.components[0].mapping[0].trd.technical.techPoints[0].preview = {
  overlayId: "",
};
assert.throws(() => parseReviewSpec(invalid));
const service = await startBrowserFeedbackService();
service.seed(spec.slug, seed);
const health = await fetch(service.baseUrl + "/health").then((r) => r.json());
assert.ok(health.capabilities.includes("multi-selection"));
const snapshot = await fetch(service.baseUrl + "/feedback/" + spec.slug).then(
  (r) => r.json(),
);
const append = await fetch(
  service.baseUrl + "/feedback/" + spec.slug + "/entries/seed",
  {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      addSelection: selection(2),
      expectedVersion: snapshot.version,
    }),
  },
).then((r) => r.json());
assert.equal(append.doc.entries[0].scope.selections.length, 2);
const replay = await fetch(
  service.baseUrl + "/feedback/" + spec.slug + "/entries/seed",
  {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      addSelection: selection(2),
      expectedVersion: append.version,
    }),
  },
).then((r) => r.json());
assert.equal(
  replay.version,
  append.version,
  "idempotent append does not increment the version",
);
const stale = await fetch(
  service.baseUrl + "/feedback/" + spec.slug + "/entries/seed",
  {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      addSelection: selection(3),
      expectedVersion: append.version - 1,
    }),
  },
);
assert.equal(stale.status, 409);
const server = await startViteServer(
  fileURLToPath(new URL("../", import.meta.url)),
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(15000);
await service.attach(page);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const capture = async (x, y) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 32, { steps: 3 });
  await page.mouse.up();
};
const dock = page.locator(".component-dock");
try {
  await page.goto(server.baseUrl);
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.getByTestId("overview-component-a").click();
  await page.waitForFunction(() =>
    document.querySelector(".component-dock")?.classList.contains("is-visible"),
  );
  await page
    .locator(".inspector .disclosure-tech-point")
    .filter({ hasText: "Show Boost" })
    .click();
  await dock
    .locator('[data-review-overlay-id="boost"].is-overlay-show')
    .waitFor();
  assert.equal(
    await page.locator(".rich-detail .rich-detail-title").innerText(),
    "Show Boost",
  );
  assert.equal(await page.locator(".rich-detail .trd-sub-title").count(), 0);
  await page.locator(".rich-detail-close").click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.component-dock [data-review-overlay-id="boost"].is-overlay-show',
      ),
  );
  await dock.getByTestId("manual-boost").click();
  await dock
    .locator('[data-review-overlay-id="boost"].is-overlay-show')
    .waitFor();
  await page
    .locator(".inspector .disclosure-tech-point")
    .filter({ hasText: "Show Share" })
    .click();
  await dock
    .locator('[data-review-overlay-id="share"].is-overlay-show')
    .waitFor();
  await page.keyboard.press("Escape");
  await dock
    .locator('[data-review-overlay-id="boost"].is-overlay-show')
    .waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector(".component-dock")
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  const gap = await page.evaluate(() => {
    const inspector = document
      .querySelector(".inspector")
      .getBoundingClientRect();
    const preview = document
      .querySelector(".component-dock")
      .getBoundingClientRect();
    const shell = document
      .querySelector(".inspector-shell")
      .getBoundingClientRect();
    // Clicking a lower detail can scroll the inspector within its fixed frame.
    // Compare the visible reading boundary, not content above the clipped edge.
    return document.querySelector(".stage").dataset.previewLayout === "stacked"
      ? Math.max(inspector.top, shell.top) - preview.bottom
      : inspector.left - preview.right;
  });
  assert.ok(gap >= 12 && gap <= 24, "reading column follows preview: " + gap);
  console.log(
    "technical point opens matching preview, close restores prior state; preview gap is " +
      gap,
  );

  await page
    .getByRole("button", { name: "进入框选评价模式", exact: true })
    .click();
  await capture(60, 180);
  const panel = page.getByTestId("david-feedback-panel");
  await panel.getByPlaceholder("描述你的反馈…").fill("Two-region draft");
  await panel.getByRole("button", { name: "新增选区", exact: true }).click();
  assert.equal(await panel.isVisible(), false);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "visible" });
  assert.equal(
    await panel.getByPlaceholder("描述你的反馈…").inputValue(),
    "Two-region draft",
  );
  await panel.getByRole("button", { name: "新增选区", exact: true }).click();
  await capture(70, 300);
  await panel.waitFor({ state: "visible" });
  assert.equal(await panel.locator(".feedback-selection-item").count(), 2);
  await panel
    .locator(".feedback-selection-item")
    .nth(1)
    .locator("summary")
    .click();
  assert.equal(
    await panel
      .locator(".feedback-selection-item")
      .nth(1)
      .evaluate((el) => el.open),
    true,
  );
  await panel.getByRole("button", { name: "提交反馈", exact: true }).click();
  const saved = await service.waitFor(spec.slug, (doc) =>
    doc?.entries.some((e) => e.suggestion === "Two-region draft"),
  );
  const added = saved.entries.find((e) => e.suggestion === "Two-region draft");
  assert.equal(feedbackSelections(added.scope).length, 2);
  await panel
    .getByRole("button", { name: "关闭反馈面板", exact: true })
    .click();
  await page.reload();
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });

  await page
    .locator(".comment-rail-row")
    .filter({ hasText: "Two-region draft" })
    .locator(".comment-rail-nav")
    .click();
  const row = page.locator('[data-feedback-id="' + added.id + '"]');
  assert.equal(await row.locator(".feedback-selection-item").count(), 2);
  await row
    .locator(".feedback-selection-item")
    .nth(1)
    .locator("summary")
    .click();
  await row.getByRole("button", { name: "定位选区 2", exact: true }).click();
  await row.getByRole("button", { name: "新增选区", exact: true }).click();
  service.failNextWrite();
  await capture(70, 250);
  await page.locator(".feedback-selection-retry").waitFor();
  assert.equal(
    feedbackSelections(
      (await service.read(spec.slug)).entries.find((e) => e.id === added.id)
        .scope,
    ).length,
    2,
  );
  await page.getByRole("button", { name: "重试保存选区", exact: true }).click();
  const final = await service.waitFor(
    spec.slug,
    (doc) =>
      feedbackSelections(doc?.entries.find((e) => e.id === added.id)?.scope)
        .length === 3,
  );
  assert.equal(
    final.entries.find((e) => e.id === added.id).suggestion,
    "Two-region draft",
  );
  console.log(
    "draft survives capture/cancel; two regions persist; existing comment gains a third region with failure/retry and per-region locate",
  );

  await page.route("**/health", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, capabilities: ["multi-selection"] }),
    }),
  );
  await row.getByRole("button", { name: "新增选区", exact: true }).click();
  await capture(100, 280);
  await page.locator(".feedback-selection-retry").waitFor();
  assert.match(
    await page.locator(".feedback-selection-retry").innerText(),
    /评论服务版本过旧/,
  );
  assert.equal(
    feedbackSelections(
      (await service.read(spec.slug)).entries.find((e) => e.id === added.id)
        .scope,
    ).length,
    3,
  );
  await page.unroute("**/health");
  await page.getByRole("button", { name: "重试保存选区", exact: true }).click();
  const upgraded = await service.waitFor(
    spec.slug,
    (doc) =>
      feedbackSelections(doc?.entries.find((e) => e.id === added.id)?.scope)
        .length === 4,
  );
  const lastSelection = feedbackSelections(
    upgraded.entries.find((e) => e.id === added.id).scope,
  )[3];
  assert.ok(lastSelection.context.regionText);
  assert.equal(lastSelection.context.regionText.truncated, false);
  console.log(
    "old region-text service preserves pending selection; retry after upgrade works without reload",
  );

  await page.route("**/health", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, version: 1 }),
    }),
  );
  await page.reload();
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });

  await page
    .locator(".comment-rail-row")
    .filter({ hasText: "Two-region draft" })
    .locator(".comment-rail-nav")
    .click();
  assert.equal(
    await page.getByRole("button", { name: "新增选区", exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log("old service capability gate preserves existing comment reads");
} catch (error) {
  await page.screenshot({
    path: "/tmp/david-comment-enhancements-failure.png",
  });
  throw error;
} finally {
  await browser.close();
  await server.close();
  await service.close();
}
