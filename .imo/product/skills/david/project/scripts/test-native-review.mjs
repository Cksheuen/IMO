import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
import { fixture } from "./review-fixes-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const service = await startBrowserFeedbackService();
const server = await startViteServer(root);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await service.attach(page);
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const spec = fixture({
  height: 1800,
  title: "Native screen review",
  status: "proposed",
});
spec.pages[0].kind = "screen";
spec.components.forEach((component) => {
  component.mapping[0].trd.technical = {
    techPoints: [
      {
        title: "Detailed native review",
        pseudoCode: "const active = true;\nrender(active);",
      },
    ],
  };
});
spec.components.forEach((component) => {
  component.children[0].mappingIds = [component.mapping[0].id];
});
spec.components[0].children = [
  {
    id: "group-a",
    label: "Group a",
    mappingIds: ["row-a"],
    children: spec.components[0].children,
  },
];
spec.pages[0].pageHtml = spec.pages[0].pageHtml.replace(
  'data-component-id="a"',
  'data-component-id="a" data-review-node-id="group-a" data-review-mapping-id="a:row-a"',
);
spec.pages[0].pageHtml = spec.pages[0].pageHtml.replace(
  'data-api-field="contract"',
  'style="margin-top:900px" data-api-field="contract"',
);
// A field present only in B verifies data-board -> visible UI preview switching.
spec.pages[0].pageHtml = spec.pages[0].pageHtml.replace(
  "Other field b",
  '<span data-api-field="only-b">Only B field</span>',
);
spec.apiContracts[0].response.push({
  name: "only-b",
  type: "string",
  meaning: "Specific content in B",
});
spec.components[0].mapping[0].api.fields.push({
  name: "only-b",
  target: "only-b",
});
service.seed(spec.slug, {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: spec.slug,
  updatedAt: "2026-09-11T00:00:00.000Z",
  mode: "integrated",
  entries: [
    {
      id: "native-feedback",
      category: "visual",
      suggestion: "Native layout test",
      createdAt: "2026-09-11T00:00:00.000Z",
    },
  ],
});
const dock = page.locator(".component-dock");
try {
  await page.goto(server.baseUrl);
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "native.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.waitForFunction(
    (title) => document.querySelector("h1.title")?.textContent === title,
    spec.title,
  );
  const stage = page.locator(".dv-canvas-stage");
  assert.equal(await stage.getAttribute("data-gestures"), "native");
  console.log("source uses native gestures");
  await stage.hover();
  const before = await page.locator(".dv-canvas-world").getAttribute("style");
  await page.mouse.wheel(0, 450);
  await page.waitForFunction(
    () => document.querySelector(".dv-canvas-stage").scrollTop > 0,
  );
  assert.equal(
    await page.locator(".dv-canvas-world").getAttribute("style"),
    before,
  );
  assert.equal(await page.locator(".dv-canvas-controls").count(), 0);
  await page.getByTestId("overview-component-a").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".component-dock")?.dataset.dockModel ===
      "viewport",
  );
  assert.equal(await dock.getAttribute("data-gestures"), "native");
  console.log("dock uses native gestures");
  const clone = dock.locator('[data-component-id="a"]');
  const transform = await clone.evaluate((el) => el.style.transform);
  await dock.hover();
  await page.mouse.wheel(0, 430);
  await page.waitForFunction(
    () => document.querySelector(".component-dock").scrollTop > 100,
  );
  assert.equal(await clone.evaluate((el) => el.style.transform), transform);
  await page.locator(".inspector .trd-feature-title").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".component-dock .is-node-highlight")
        ?.getAttribute("data-review-node-id") === "node-a",
  );
  assert.equal(
    await dock.locator(".is-node-highlight").count(),
    1,
    "nested row selects only its deepest matching node",
  );
  await page
    .locator(".inspector .dv-contract-card")
    .filter({ has: page.locator('[data-contract-field="contract"]') })
    .locator(":scope > details > summary")
    .click();
  await page.locator('.inspector [data-contract-field="contract"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector('.component-dock [data-api-field="contract"]')
      ?.classList.contains("field-highlight"),
  );
  const field = dock.locator('[data-api-field="contract"]');
  await page.waitForFunction(() => {
    const dock = document
      .querySelector(".component-dock")
      .getBoundingClientRect();
    const field = document
      .querySelector('.component-dock [data-api-field="contract"]')
      .getBoundingClientRect();
    return field.top >= dock.top && field.bottom <= dock.bottom;
  });
  assert.equal(
    await field.evaluate((el) => getComputedStyle(el).outlineWidth),
    "3px",
  );
  await page
    .locator(".inspector")
    .getByRole("button", { name: "查看实现", exact: true })
    .click();
  await page.locator(".rich-detail").waitFor();
  assert.equal(await page.locator(".rich-detail-backdrop").count(), 0);
  assert.equal(
    await page
      .locator(".comment-rail-toggle")
      .evaluate((el) => Number(getComputedStyle(el).zIndex)),
    11010,
  );
  assert.equal(
    await page.locator(".comment-rail-toggle").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
      );
    }),
    true,
  );
  assert.equal(
    await page.locator(".rich-detail").getAttribute("aria-modal"),
    "false",
  );
  console.log("field located and detail opened");
  const bounds = await page.locator(".rich-detail").boundingBox();
  const dockBounds = await dock.boundingBox();
  assert.ok(
    bounds.x >= dockBounds.x + dockBounds.width,
    "detail reserves preview",
  );
  assert.ok((await dock.locator(".david-mapping-selected").count()) > 0);
  for (let i = 0; i < 2; i++) {
    await page.locator(".comment-rail-toggle").click();
    assert.equal(await page.locator(".rich-detail").count(), 1);
  }
  await page.keyboard.press("Escape");
  const targetContract = page
    .locator(".inspector .dv-contract-card")
    .filter({ has: page.locator('[data-contract-field="only-b"]') });
  if (
    !(await targetContract
      .locator(":scope > details")
      .evaluate((el) => el.open))
  )
    await targetContract.locator(":scope > details > summary").click();
  await page.locator('.inspector [data-contract-field="only-b"]').click();
  await dock.locator('[data-component-id="b"] .field-highlight').waitFor();
  assert.equal(
    await page
      .locator('.rich-detail [data-contract-field="only-b"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await dock.getAttribute("data-gestures"), "native");
  assert.deepEqual(errors, []);
  console.log(
    "native screen: wheel scrolls source/dock; field scrolls visible preview; no mask; rail accessible; mapping and cross-component field selection passed",
  );
} catch (error) {
  await page.screenshot({ path: "/tmp/david-native-review-failure.png" });
  throw error;
} finally {
  await browser.close();
  await server.close();
  await service.close();
}
