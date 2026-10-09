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
  reducedMotion: "no-preference",
});
await service.attach(page);
const spec = fixture({ title: "Review interaction refinements" });
spec.service = { baseUrl: service.baseUrl };
spec.pages[0].kind = "screen";
spec.components[0].children = [];
const row = spec.components[0].mapping[0];
row.title = "Source comparison";
row.changeBlock = {
  kind: "migrate",
  rationale: "Compare source around deleted and blank rows",
  before: {
    code: `const value = "${"long-".repeat(70)}";\nremoved();\nshared();\n\nfinish();`,
    codeAnnotations: [
      {
        startLine: 1,
        endLine: 5,
        title: "Before range",
        bullets: ["Skip visual gaps."],
      },
    ],
  },
  after: {
    code: `const value = "${"long-".repeat(70)}";\nshared();\n\nfinish();`,
    codeAnnotations: [
      {
        startLine: 1,
        endLine: 4,
        title: "After range",
        bullets: ["Skip visual gaps."],
      },
    ],
  },
};
row.trd = {
  technical: {
    techPoints: [
      {
        title: "Long ordinary block",
        pseudoCode: Array.from({ length: 40 }, (_, i) => `line${i}();`).join(
          "\n",
        ),
      },
    ],
  },
};
spec.components[1].mapping[0].trd = {
  technical: {
    bullets: Array.from(
      { length: 20 },
      (_, i) =>
        `Context section ${i}: ${"Review the implementation detail. ".repeat(8)}`,
    ),
    techPoints: [
      {
        title: "Single code with prose",
        pseudoCode: Array.from(
          { length: 40 },
          (_, i) => `singleLine${i}();`,
        ).join("\n"),
      },
    ],
  },
};
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
  const toggle = page.locator(
    '.inspector [data-trd-row="row-a"] .trd-row-toggle',
  );
  assert.equal(
    await toggle.locator("svg").count(),
    1,
    "Use a centered vector chevron",
  );
  const title = page.locator(
    '.inspector [data-trd-row="row-a"] .trd-feature-title',
  );
  assert.equal(
    await page.locator(".inspector .trd-row-enter").count(),
    0,
    "Leaf features have no redundant enter action",
  );
  await title.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".trd-row-body").getBoundingClientRect().height ===
      0,
  );
  await toggle.click();
  const animated = await page
    .locator(".trd-row-body")
    .evaluate((el) =>
      el.getAnimations().some((a) => a.playState === "running"),
    );
  assert.equal(animated, true, "Feature body expands with a transition");
  await page
    .locator('.inspector [data-trd-row="row-a"]')
    .getByRole("button", { name: "查看实现", exact: true })
    .click();
  assert.equal(
    await page.locator(".rich-detail .dv-change-badge").innerText(),
    "迁移",
  );
  assert.equal(
    await page.locator(".rich-detail .dv-change-why").count(),
    0,
    "No redundant rationale heading",
  );
  const pane = page.locator(".rich-detail .dv-diff-pane-after");
  await pane.locator('[data-line="1"]').hover();
  await page.getByRole("tooltip").filter({ hasText: "After range" }).waitFor();
  const geometry = await pane.evaluate((el) => ({
    active: [...el.querySelectorAll(".is-annotation-active")].map((line) => ({
      line: line.dataset.line,
      top: line.getBoundingClientRect().top,
      bottom: line.getBoundingClientRect().bottom,
    })),
    boxes: [...el.querySelectorAll(".trd-code-selection-range")].map((box) => ({
      top: box.getBoundingClientRect().top,
      bottom: box.getBoundingClientRect().bottom,
    })),
  }));
  assert.deepEqual(
    geometry.active.map((x) => x.line),
    ["1", "2", "4"],
  );
  assert.equal(
    geometry.boxes.length,
    3,
    "Each continuous source run excludes diff placeholders and blank source lines",
  );
  geometry.boxes.forEach((box, i) => {
    assert.ok(Math.abs(box.top - geometry.active[i].top) < 2);
    assert.ok(Math.abs(box.bottom - geometry.active[i].bottom) < 2);
  });
  await page.mouse.move(5, 5);
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  const diff = page.locator(".rich-detail .dv-diff");
  const before = diff.locator(".dv-diff-pane-before");
  const beforeWidth = (await pane.boundingBox()).width;
  await before
    .getByRole("button", { name: "收起迁移来源", exact: true })
    .click();
  assert.ok(
    await diff.evaluate((el) =>
      el.getAnimations().some((a) => a.playState === "running"),
    ),
    "Diff width transitions",
  );
  const middle = await diff.evaluate((el) => {
    const animation = el
      .getAnimations()
      .find((item) => item.transitionProperty === "grid-template-columns");
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 110;
    const width = el
      .querySelector(".dv-diff-pane-before")
      .getBoundingClientRect().width;
    const total = el.getBoundingClientRect().width;
    animation.finish();
    return { width, total };
  });
  assert.ok(
    middle && middle.width > 37 && middle.width < middle.total / 2 - 2,
    "At 110ms the pane has a real intermediate width, not a discrete layout jump",
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-diff-pane-before").getBoundingClientRect()
        .width <= 37,
  );
  assert.ok((await pane.boundingBox()).width > beforeWidth * 1.6);
  assert.equal(
    await before.locator(".dv-diff-pane-content").getAttribute("inert"),
    "",
  );
  await before
    .getByRole("button", { name: "展开迁移来源", exact: true })
    .press("Enter");
  await pane.getByRole("button", { name: "收起迁移后", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-diff-pane-after").getBoundingClientRect()
        .width <= 37,
  );
  await pane.getByRole("button", { name: "展开迁移后", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await before
    .getByRole("button", { name: "收起迁移来源", exact: true })
    .click();
  assert.equal(
    await diff.evaluate(
      (el) =>
        el.getAnimations().filter((a) => a.playState === "running").length,
    ),
    0,
  );
  await pane.getByRole("button", { name: "收起迁移后", exact: true }).click();
  assert.equal(
    await before.getAttribute("data-collapsed"),
    "false",
    "At least one side remains open",
  );
  const ordinary = page
    .locator(".rich-detail .trd-codeblk")
    .filter({ hasText: "line39();" })
    .locator(".trd-cb-body");
  assert.ok(
    (await ordinary.boundingBox()).height >= 350,
    "Multi-block detail gives ordinary code more than 220px",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async () => {
    const { scrollAndPulse } = await import("/src/lib/pulseHighlight.ts");
    scrollAndPulse(document.querySelector(".rich-detail .trd-codeblk"));
  });
  await page.locator(".rich-detail .is-pulse-highlight").waitFor();
  const keys = await page
    .locator(".rich-detail .is-pulse-highlight")
    .evaluate((el) =>
      el
        .getAnimations()
        .flatMap((a) => a.effect.getKeyframes())
        .flatMap(Object.keys),
    );
  assert.ok(
    !keys.includes("backgroundColor") &&
      !keys.includes("color") &&
      !keys.includes("opacity"),
    "Locate pulse preserves content colors and opacity",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await diff.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "Collapsed diff fits a narrow panel",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "返回总览", exact: true }).click();
  await page.getByTestId("overview-component-b").click();
  await page
    .locator('.inspector [data-trd-row="row-b"]')
    .getByRole("button", { name: "查看实现", exact: true })
    .click();
  const single = page.locator(
    '.rich-detail[data-code-layout="single"] .trd-cb-body',
  );
  await single.waitFor();
  assert.ok(
    (await single.boundingBox()).height >= 319,
    "Prose above single code cannot shrink it below the reading baseline",
  );
  assert.ok(
    await page
      .getByRole("button", { name: "关闭详情", exact: true })
      .isVisible(),
  );
  const hierarchy = fixture({ title: "Separate disclosure and navigation" });
  hierarchy.service = { baseUrl: service.baseUrl };
  hierarchy.pages[0].pageHtml = hierarchy.pages[0].pageHtml.replace(
    'data-review-node-id="node-a">',
    'data-review-node-id="node-a"><span data-review-node-id="leaf-a">Child content</span>',
  );
  hierarchy.components[0].children = [
    {
      id: "node-a",
      label: "Deeper feature",
      mappingIds: ["row-a"],
      children: [{ id: "leaf-a", label: "Child detail" }],
    },
  ];
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "hierarchy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(hierarchy)),
    });
  await page.getByTestId("overview-component-a").click();
  const feature = page.locator('.inspector [data-trd-row="row-a"]');
  const featureTitle = feature.locator(".trd-feature-title");
  const beforePath = await page.getByTestId("david-breadcrumb").innerText();
  await featureTitle.click();
  assert.equal(await featureTitle.getAttribute("aria-expanded"), "false");
  assert.equal(
    await page.getByTestId("david-breadcrumb").innerText(),
    beforePath,
    "Title toggles without navigation",
  );
  await feature.locator(".trd-row-header").dispatchEvent("click");
  assert.equal(
    await featureTitle.getAttribute("aria-expanded"),
    "true",
    "Header blank area toggles disclosure",
  );
  await feature.locator(".trd-row-enter button").click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="david-breadcrumb"]')
      .textContent.includes("Deeper feature"),
  );
  assert.ok(
    (await page.getByTestId("david-breadcrumb").innerText()).includes(
      "Deeper feature",
    ),
    "Only the dedicated action enters the child",
  );
  assert.deepEqual(errors, []);
  console.log(
    "review interactions: vector chevron, disclosure motion, precise annotation runs, independent diff collapse, reduced motion, code height and non-obscuring pulse passed",
  );
} finally {
  await browser.close();
  await vite.close();
  await service.close();
}
