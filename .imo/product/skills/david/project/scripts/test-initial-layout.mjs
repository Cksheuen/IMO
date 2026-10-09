import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
const project = fileURLToPath(new URL("../", import.meta.url));
const service = await startBrowserFeedbackService(),
  vite = await startViteServer(project),
  browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1488, height: 951 } });
await service.attach(page);
page.setDefaultTimeout(12000);
const spec = {
  slug: "initial-layout",
  title: "Initial geometry review",
  subtitle: "First frame and page-scoped navigation",
  service: { baseUrl: service.baseUrl },
  pages: [],
  components: [],
};
const markup = (id, height) =>
  `<style>.il-box{box-sizing:border-box;width:390px;background:#fffaf0;color:#33291f;padding:20px;font:14px/1.6 sans-serif}.il-box h2{margin:0 0 16px}</style><section class="il-box" data-component-id="${id}" style="height:${height}px"><h2>${id}</h2><details data-review-node-id="details-${id}"><summary>Deep detail ${id}</summary><div style="height:1700px">Long detail content ${id}</div></details></section>`;
for (const [id, height] of [
  ["a", 1800],
  ["b", 600],
]) {
  spec.pages.push({
    id,
    label: `Page ${id}`,
    kind: "screen",
    pageHtml:
      markup(id, height) +
      ["infra", "risk"]
        .map(
          (kind) =>
            `<section class="il-box" data-component-id="${kind}-${id}"><h2>${kind}-${id}</h2><p>Page ${id} supporting board</p></section>`,
        )
        .join(""),
  });
  for (const kind of ["ui", "infra", "risk"]) {
    const cid = kind === "ui" ? id : `${kind}-${id}`;
    spec.components.push({
      id: cid,
      label: cid,
      kind,
      kindLabel: kind === "infra" ? "工程" : kind === "risk" ? "风险" : "界面",
      mapping: [
        {
          id: `row-${cid}`,
          requirement: `Requirement ${cid}`,
          change: `Change ${cid}`,
          api: { summary: "No API changes", changed: false },
        },
      ],
      ...(kind === "ui"
        ? {
            children: [
              {
                id: `details-${id}`,
                label: `Deep detail ${id}`,
                interaction: "drilldown",
                mappingIds: [`row-${cid}`],
              },
            ],
          }
        : {}),
    });
  }
}
service.seed(spec.slug, {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: spec.slug,
  updatedAt: "2026-09-11T00:00:00.000Z",
  mode: "integrated",
  entries: [
    {
      id: "layout-comment",
      category: "visual",
      suggestion: "Layout fixture",
      createdAt: "2026-09-11T00:00:00.000Z",
    },
  ],
});
let releaseFeedback;
const feedbackReady = new Promise((resolve) => {
  releaseFeedback = resolve;
});
let heldFeedback = false;
await page.route(`${service.baseUrl}/feedback/${spec.slug}`, async (route) => {
  if (!heldFeedback) {
    heldFeedback = true;
    await feedbackReady;
  }
  const response = await route.fetch();
  await route.fulfill({ response });
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sample = async (selector) =>
  page.evaluate(async (selector) => {
    const rows = [];
    document.querySelector(selector).click();
    const start = globalThis.performance.now();
    while (globalThis.performance.now() - start < 700) {
      await new Promise(requestAnimationFrame);
      const dock = document.querySelector(".component-dock"),
        ins = document.querySelector(".inspector");
      if (!dock || !ins) continue;
      const rect = ins.getBoundingClientRect();
      rows.push({
        width: rect.width,
        left: rect.left,
        model: dock.dataset.dockModel,
        baseWidth: dock.offsetWidth,
        baseHeight: dock.offsetHeight,
        end: Number(dock.dataset.previewRight),
        loading:
          document.querySelector(".comment-rail")?.getAttribute("aria-busy") ===
          "true",
      });
    }
    return rows;
  }, selector);
const check = (rows) => {
  assert.ok(rows.length > 5);
  const first = rows[0];
  for (const row of rows) {
    assert.equal(row.model, first.model, "final dock model from first frame");
    assert.equal(
      row.baseWidth,
      first.baseWidth,
      "no post-animation width correction",
    );
    assert.equal(
      row.baseHeight,
      first.baseHeight,
      "no post-animation height correction",
    );
    assert.ok(
      Math.abs(row.width - first.width) < 1,
      "reading width stable through animation",
    );
    assert.ok(
      Math.abs(row.left - first.left) < 1,
      "reading column starts at final boundary",
    );
  }
};
try {
  await page.goto(vite.baseUrl);
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "layout.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.locator("h1.title", { hasText: spec.title }).waitFor();
  const header = page.locator(".app-header");
  const boardCheck = async (id) => {
    assert.equal(
      await header.getByRole("button", { name: "工程", exact: true }).count(),
      1,
    );
    assert.equal(
      await header.getByRole("button", { name: "风险", exact: true }).count(),
      1,
    );
    assert.equal(
      await header.getByTestId(`david-board-infra-${id}`).count(),
      1,
    );
    const colors = await header
      .locator("button,summary")
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              el.offsetParent !== null && !el.closest(".app-header-actions"),
          )
          .map((el) => getComputedStyle(el).borderColor),
      );
    assert.ok(
      colors.every((c) => c === colors[0]),
      `shared theme tokens: ${colors.join(", ")}`,
    );
  };
  await boardCheck("a");
  setTimeout(releaseFeedback, 250);
  const tall = await sample('[data-testid="overview-component-a"]');
  assert.equal(
    tall[0].loading,
    true,
    "first frame reserves delayed comment space",
  );
  assert.equal(
    tall.at(-1).loading,
    false,
    "sample crosses the first feedback arrival",
  );
  check(tall);
  assert.equal(tall[0].model, "viewport");
  const nested = await sample(
    '.component-dock [data-review-node-id="details-a"] > summary',
  );
  check(nested);
  assert.equal(nested[0].model, "viewport");
  await page
    .getByTestId("david-breadcrumb")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.locator(".component-dock").waitFor({ state: "hidden" });
  await header.getByTestId("david-board-infra-a").click();
  await page
    .getByTestId("david-breadcrumb")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.locator(".component-dock").waitFor({ state: "hidden" });
  await page
    .locator(".page-stack button")
    .filter({ hasText: "Page b" })
    .click();
  await boardCheck("b");
  const normal = await sample('[data-testid="overview-component-b"]');
  check(normal);
  assert.equal(normal[0].model, "transform");
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForFunction(() => {
    const dock = document.querySelector(".component-dock"),
      i = document.querySelector(".inspector");
    return (
      Math.abs(
        i.getBoundingClientRect().left - Number(dock.dataset.previewRight) - 16,
      ) < 1
    );
  });
  await page
    .getByTestId("david-breadcrumb")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.locator(".component-dock").waitFor({ state: "hidden" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(await sample('[data-testid="overview-component-b"]'));
  await page
    .getByTestId("david-breadcrumb")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await header.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  // Many long page titles stay on one line; keyboard navigation reveals the
  // active item without scrolling the document or stretching the preview.
  const manyPages = {
    ...spec,
    pages: [
      ...spec.pages,
      ...Array.from({ length: 8 }, (_, i) => ({
        ...spec.pages[1],
        id: `extra-${i}`,
        label: `第 ${i + 3} 页 商品列表与店铺广告授权 Sheet`,
      })),
      { ...spec.pages[1], id: "logic", label: "逻辑画板", kind: "canvas" },
    ],
  };
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "many-pages.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manyPages)),
    });
  await page.locator(".page-stack-item").nth(10).waitFor();
  for (const width of [1488, 900, 390]) {
    await page.setViewportSize({ width, height: 951 });
    await page.locator(".page-stack-item").first().click();
    const nav = await page.locator(".page-stack").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      overflows: el.scrollWidth > el.clientWidth,
      heights: [...el.children].map(
        (item) => item.getBoundingClientRect().height,
      ),
    }));
    assert.ok(nav.overflows, `${width}px: tabs can scroll horizontally`);
    assert.ok(nav.height < 60, `${width}px: page strip stays compact`);
    assert.ok(
      Math.max(...nav.heights) - Math.min(...nav.heights) < 1,
      `${width}px: page labels do not wrap into uneven heights`,
    );
    // Move through pages using the app shortcut, not locator.click's automatic scroll.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction((index) => {
        const tabs = document.querySelectorAll(".page-stack-item");
        return tabs[index]?.getAttribute("aria-current") === "page";
      }, i + 1);
    }
    assert.ok(
      await page.locator(".page-stack").evaluate((el) => {
        const active = el
          .querySelector("[aria-current=page]")
          .getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return (
          el.scrollLeft > 0 &&
          active.left >= box.left - 1 &&
          active.right <= box.right + 1
        );
      }),
      `${width}px: active page automatically scrolls into view`,
    );
    const surface = await page.locator(".page-frame").evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      border: getComputedStyle(el).borderWidth,
      shadow: getComputedStyle(el).boxShadow,
      texture: getComputedStyle(el, "::before").content,
    }));
    assert.deepEqual(surface, {
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      shadow: "none",
      texture: "none",
    });
    assert.equal(await page.locator(".david-previous-page-card").count(), 0);
    for (const collapsed of [false, true]) {
      const toggle = page.locator(".comment-rail-toggle");
      assert.equal(
        await toggle.getAttribute("aria-expanded"),
        String(!collapsed),
      );
      if (collapsed) {
        assert.ok(
          await page.locator(".comment-rail-badge").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.top < 48 && window.innerWidth - r.right < 24;
          }),
          `${width}px: the collapsed count stays with its top-right control`,
        );
      }
      assert.ok(
        await toggle.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const overlap = (other) => {
            const b = other.getBoundingClientRect();
            return (
              r.left < b.right &&
              r.right > b.left &&
              r.top < b.bottom &&
              r.bottom > b.top
            );
          };
          return (
            r.top >= 0 &&
            r.top < 48 &&
            window.innerWidth - r.right < 24 &&
            ![
              ...document.querySelectorAll(
                ".comment-rail:not(.is-collapsed) .comment-rail-row, .app-header button, .app-header summary",
              ),
            ].some(overlap) &&
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
              el
          );
        }),
        `${width}px: toggle remains reachable at top right without covering comments or tools`,
      );
      await toggle.click();
    }
  }
  await page.locator(".page-stack-item").last().click();
  assert.equal(await page.locator(".page-frame.is-ui-preview").count(), 0);
  assert.notEqual(
    await page
      .locator(".page-frame")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "logic canvas retains its own surface",
  );
  assert.deepEqual(errors, []);
  console.log(
    "initial layout: first-frame dimensions, resize, page-scoped actions, scrollable tabs, transparent UI preview and top-right comment toggle passed",
  );
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(-1200));
  throw error;
} finally {
  releaseFeedback();
  await browser.close();
  await vite.close();
  await service.close();
}
