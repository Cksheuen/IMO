import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fixture } from "./review-fixes-fixture.mjs";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
const service = await startBrowserFeedbackService();
const vite = await startViteServer(
  fileURLToPath(new URL("../", import.meta.url)),
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await service.attach(page);
page.setDefaultTimeout(12000);
const spec = fixture({ title: "Focused comment navigation" });
spec.service = { baseUrl: service.baseUrl };
spec.pages[0].kind = "screen";
spec.components[0].children = [];
const root = spec.components[0];
spec.components.push({
  id: "other-page-component",
  label: "Other page component",
  mapping: [
    {
      id: "other-row",
      requirement: "Other requirement",
      change: "Other change",
      api: { changed: false },
    },
  ],
});
spec.pages.push({
  id: "other-page",
  label: "Other page",
  kind: "screen",
  pageHtml:
    '<section data-component-id="other-page-component" style="width:360px;height:640px;background:white">Other page</section>',
});
root.mapping[0].requirement = "Large first row for reading. ".repeat(65);
root.mapping.push({
  id: "deep",
  title: "Deep feature",
  requirement: "Specific requirement",
  change: "Specific implementation",
  api: { changed: false },
  trd: { technical: { bullets: ["Exact deep target"] } },
});
root.mapping.push({
  id: "rich",
  title: "Rich feature",
  requirement: "Rich requirement",
  change: "Detailed implementation",
  api: { changed: false },
  trd: {
    technical: {
      techPoints: Array.from({ length: 5 }, (_, i) => ({
        title: i === 4 ? "Exact rich target" : `Long section ${i}`,
        pseudoCode: Array.from(
          { length: 40 },
          (_, j) => `const section${i}Line${j} = true;`,
        ).join("\n"),
      })),
    },
  },
});
root.children = [
  { id: "node-a", label: "Inline-only feature", mappingIds: ["deep"] },
];
const shared = {
  version: 1,
  kind: "appearance-selection",
  capturedAt: "2026-09-11T00:00:00Z",
  scene: { pageId: "page", componentId: "a" },
  viewport: { width: 1440, height: 900 },
  windowScroll: { x: 0, y: 0 },
  rect: { nx: 0.2, ny: 0.2, nw: 0.1, nh: 0.1 },
};
const broad = {
  ...shared,
  surface: "shell",
  targets: [{ targetId: "shell:layout", label: "Layout", kind: "shell" }],
};
const precise = {
  ...shared,
  surface: "inspector",
  targets: [{ targetId: "a", label: "A", kind: "review" }],
  context: {
    mapping: { rowId: "deep", column: "change" },
    textSnippet: "Exact deep target",
  },
};
service.seed(spec.slug, {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: spec.slug,
  mode: "integrated",
  updatedAt: shared.capturedAt,
  entries: [
    {
      id: "inline-agent",
      category: "content",
      origin: "agent",
      suggestion: "1. Missing one\n2. Missing two",
      createdAt: shared.capturedAt,
      scope: { pageId: "page", nodePath: ["a", "node-a"], targetId: "node-a" },
    },
    {
      id: "stale-page-target",
      category: "visual",
      suggestion: "Component was removed from this page",
      createdAt: shared.capturedAt,
      scope: { pageId: "other-page", nodePath: ["a"], targetId: "a" },
    },
    {
      id: "rich-focus",
      category: "visual",
      suggestion: "Locate the exact rich section",
      createdAt: shared.capturedAt,
      scope: {
        pageId: "page",
        nodePath: ["a"],
        targetId: "rich-detail:rich:change:a",
        selection: {
          ...shared,
          surface: "rich-detail",
          targets: [
            {
              targetId: "rich-detail:rich:change:a",
              label: "Rich section",
              kind: "rich-detail",
            },
          ],
          detail: { rowId: "rich", column: "change", componentId: "a" },
          context: {
            heading: "Exact rich target",
            textSnippet: "Exact rich target",
          },
        },
      },
    },
    {
      id: "focus",
      category: "visual",
      suggestion: "Go to the exact collapsed feature",
      createdAt: shared.capturedAt,
      scope: {
        selection: broad,
        selections: [broad, precise],
        pageId: "page",
        nodePath: ["a"],
        targetId: "shell:layout",
      },
    },
  ],
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
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
  await page.getByTestId("overview-component-a").click();
  const row = page.locator('.inspector [data-trd-row="deep"]');
  assert.equal(await row.getAttribute("data-row-expanded"), "false");
  const inlineNav = page.locator(
    '[data-feedback-id="inline-agent"] .comment-rail-nav',
  );
  await inlineNav.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.inspector [data-trd-row="deep"]')
        ?.getAttribute("data-row-expanded") === "true",
  );
  assert.equal(
    await page
      .locator('.david-breadcrumb-item[aria-current="page"]')
      .innerText(),
    root.label,
  );
  assert.equal(await row.locator(".trd-row-drill").count(), 0);
  const label = inlineNav.locator(".comment-rail-label");
  assert.equal(
    await label.evaluate((el) => getComputedStyle(el).whiteSpace),
    "pre-wrap",
  );
  assert.equal(
    await label.evaluate((el) => getComputedStyle(el).userSelect),
    "text",
  );
  const points = await label.evaluate((el) => {
    const r = document.createRange();
    r.setStart(el.firstChild, 0);
    r.setEnd(el.firstChild, 14);
    const box = r.getBoundingClientRect();
    return { x: box.x + 1, y: box.y + box.height / 2, end: box.right - 1 };
  });
  await page.mouse.move(points.x, points.y);
  await page.mouse.down();
  await page.mouse.move(points.end, points.y, { steps: 8 });
  await page.mouse.up();
  assert.ok(
    (await page.evaluate(() => window.getSelection()?.toString())).includes(
      "Missing one",
    ),
  );
  assert.equal(
    await inlineNav.getAttribute("aria-expanded"),
    "true",
    "Selecting comment text must not collapse or navigate",
  );
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await row.locator(".trd-row-toggle").click();
  await page.locator('[data-feedback-id="focus"] .comment-rail-nav').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.inspector [data-trd-row="deep"]')
        ?.getAttribute("data-row-expanded") === "true",
  );
  assert.equal(
    await page
      .locator('[data-feedback-id="focus"] .feedback-selection-item[open]')
      .count(),
    0,
  );
  const target = row.getByText("Exact deep target", { exact: true });
  await target.waitFor();
  const box = await target.boundingBox();
  assert.ok(box.y > 0 && box.y + box.height < 900);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await row.locator(".trd-row-toggle").click();
  assert.equal(
    await page.locator(".inspector-shell").getAttribute("data-navigation"),
    null,
  );
  assert.ok(
    await row
      .locator(".trd-row-body")
      .evaluate((el) =>
        el.getAnimations().some((a) => a.playState === "running"),
      ),
    "Manual toggle after comment navigation restores disclosure motion",
  );
  assert.equal(
    await page
      .locator(".page-frame")
      .evaluate(
        (el) =>
          el.getAnimations().filter((a) => a.playState === "running").length,
      ),
    0,
    "Row toggle does not restart background navigation",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator('[data-feedback-id="focus"] .feedback-selection-item')
    .nth(1)
    .locator("summary")
    .click();
  await page.getByRole("button", { name: "定位选区 2", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.inspector [data-trd-row="deep"]')
        ?.getAttribute("data-row-expanded") === "true",
  );
  assert.ok(await target.isVisible());
  await page
    .locator('[data-feedback-id="rich-focus"] .comment-rail-nav')
    .click();
  await page.locator(".rich-detail").waitFor();
  const richTarget = page
    .locator(".rich-detail h4")
    .filter({ hasText: "Exact rich target" });
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll(".rich-detail h4")].find((el) =>
      el.textContent.includes("Exact rich target"),
    );
    return (
      el &&
      el.getBoundingClientRect().top > 0 &&
      el.getBoundingClientRect().bottom < window.innerHeight
    );
  });
  assert.ok(await richTarget.isVisible());
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await page.getByRole("button", { name: "返回总览", exact: true }).click();
    await page.locator(".inspector-shell").waitFor({ state: "detached" });
    const nav = page.locator(
      '[data-feedback-id="rich-focus"] .comment-rail-nav',
    );
    if ((await nav.getAttribute("aria-expanded")) === "true") await nav.click();
    await page
      .locator(".page-stack-item")
      .filter({ hasText: "Other page" })
      .click();
    await page.evaluate(() => {
      window.feedbackFrames = [];
      document.addEventListener(
        "click",
        function start(event) {
          if (
            !event.target.closest(
              '[data-feedback-id="rich-focus"] .comment-rail-nav',
            )
          )
            return;
          document.removeEventListener("click", start, true);
          const sample = () => {
            window.feedbackFrames.push({
              overview:
                getComputedStyle(
                  document.querySelector(".david-overview-surface"),
                ).display !== "none",
              morph: Boolean(
                document.querySelector(".component-dock.flip-morph"),
              ),
              backgroundAnimation: document
                .querySelector(".page-frame")
                .getAnimations()
                .some((a) => a.playState === "running"),
            });
            if (window.feedbackFrames.length < 8) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        },
        true,
      );
    });
    await nav.click();
    await page.locator('.rich-detail[data-david-row-id="rich"]').waitFor();
    await page.waitForFunction(() => window.feedbackFrames.length === 8);
    const frames = await page.evaluate(() => window.feedbackFrames);
    assert.ok(
      frames.every((f) => !f.overview && !f.morph && !f.backgroundAnimation),
      JSON.stringify({ reducedMotion, frames }),
    );
    assert.equal(await page.locator(".david-previous-page-card").count(), 0);
  }
  await page
    .locator('[data-feedback-id="stale-page-target"] .comment-rail-nav')
    .click();
  await page
    .locator('[data-feedback-id="stale-page-target"] .comment-rail-missed')
    .waitFor();
  assert.equal(await page.locator(".inspector-shell").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "feedback focus: default collapsed selections, best mapping over broad target, row expansion and exact content scrolling passed",
  );
} finally {
  await browser.close();
  await vite.close();
  await service.close();
}
