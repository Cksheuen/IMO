import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
import { fixture } from "./review-fixes-fixture.mjs";

const service = await startBrowserFeedbackService();
const server = await startViteServer(projectRoot);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await service.attach(page);
const dock = page.locator(".component-dock");
const control = (surface, name) =>
  page.locator(`${surface} [data-test-control="${name}"]`);
const waitDock = async (id = "a") => {
  await page.waitForFunction((componentId) => {
    const element = document.querySelector(".component-dock");
    return (
      element?.classList.contains("is-visible") &&
      !element.classList.contains("flip-morph") &&
      element.querySelector(`[data-component-id="${componentId}"]`)
    );
  }, id);
};
const importFixture = async (spec = fixture()) => {
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.waitForFunction(
    (title) => document.querySelector("h1.title")?.textContent === title,
    spec.title,
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".component-dock")
        ?.classList.contains("is-visible"),
  );
};
const back = async () => {
  await page
    .locator('[data-testid="david-breadcrumb"] button')
    .filter({ hasText: "总览" })
    .click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".component-dock")
        ?.classList.contains("is-visible"),
  );
};
const checkedBoth = async (checked) => {
  assert.equal(await control(".page-frame", "check-a").isChecked(), checked);
  assert.equal(
    await control(".component-dock", "check-a").isChecked(),
    checked,
  );
};
const assertHit = async (locator) => {
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.9, 0.9],
    ].map(([x, y]) => {
      const hit = document.elementFromPoint(
        rect.left + rect.width * x,
        rect.top + rect.height * y,
      );
      return hit === element || element.contains(hit);
    });
  });
  assert.deepEqual(result, [true, true, true]);
};

try {
  await page.goto(server.baseUrl);
  await importFixture();
  const entry = page.getByTestId("overview-component-a");
  await entry.scrollIntoViewIfNeeded();
  assert.equal(await entry.evaluate((el) => el.tagName), "BUTTON");
  assert.equal(await entry.evaluate((el) => el.parentElement.tagName), "TH");
  assert.equal(
    await entry.evaluate((el) => el.parentElement.getAttribute("role")),
    null,
  );
  assert.match(
    await page.locator(".david-overview-mapping").ariaSnapshot(),
    /rowheader/,
  );
  const cellFill = await entry.evaluate((el) => {
    const button = el.getBoundingClientRect(),
      cell = el.parentElement.getBoundingClientRect();
    const style = getComputedStyle(el.parentElement);
    return {
      width:
        cell.width -
        button.width -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth),
      height: cell.height - button.height,
    };
  });
  assert.ok(
    cellFill.width <= 1 && cellFill.height <= 2,
    JSON.stringify(cellFill),
  );
  await assertHit(entry);
  for (const key of ["Enter", "Space"]) {
    await entry.focus();
    await page.keyboard.press(key);
    await waitDock();
    await back();
  }
  console.log(
    "ok: rowheader AX semantics, full-cell button hit tests, Enter/Space",
  );

  // Default controls run before a detail snapshot; bubbling remains observable.
  await page.evaluate(() => {
    window.nativeClicks = 0;
    document.addEventListener("click", (event) => {
      if (event.target.matches('[data-test-control="check-a"]'))
        window.nativeClicks++;
    });
  });
  await control(".page-frame", "check-a").click();
  await waitDock();
  await checkedBoth(true);
  assert.equal(await page.evaluate(() => window.nativeClicks), 1);
  await control(".component-dock", "check-a").press("Space");
  await checkedBoth(false);
  await control(".component-dock", "text-a").fill("edited in dock");
  await control(".component-dock", "select-a").selectOption("two");
  await back();
  assert.equal(
    await control(".page-frame", "text-a").inputValue(),
    "edited in dock",
  );
  assert.equal(await control(".page-frame", "select-a").inputValue(), "two");

  await control(".page-frame", "details-a").locator("summary").click();
  await waitDock();
  for (const surface of [".page-frame", ".component-dock"])
    assert.equal(
      await control(surface, "details-a").evaluate((el) => el.open),
      true,
    );
  await control(".component-dock", "details-a")
    .locator("summary")
    .press("Enter");
  await page.waitForFunction(
    () =>
      !document.querySelector('.page-frame [data-test-control="details-a"]')
        .open,
  );
  await back();
  assert.equal(
    await control(".page-frame", "details-a").evaluate((el) => el.open),
    false,
  );

  await page.locator('.page-frame a[href="#native-a"]').click();
  await waitDock();
  assert.equal(new URL(page.url()).hash, "#native-a");
  await back();
  const submitted = page.waitForRequest((req) =>
    req.url().includes("/native-submit?q=submitted"),
  );
  await page.locator('.page-frame button[type="submit"]').first().click();
  await submitted;
  await waitDock();
  console.log(
    "ok: checkbox/details/link/form native defaults and source/dock/return state",
  );

  // A native details control in the current dock can select another component.
  const cross = fixture({ title: "Cross-component native toggle" });
  cross.pages[0].interactions.find(
    (item) => item.source === "details-a",
  ).targetNodeId = "node-b";
  await importFixture(cross);
  await page.getByTestId("overview-component-a").click();
  await waitDock();
  await control(".component-dock", "details-a").locator("summary").click();
  await waitDock("b");
  assert.equal(
    await control(".page-frame", "details-a").evaluate((el) => el.open),
    true,
  );
  await back();
  await page.getByTestId("overview-component-a").click();
  await waitDock();
  assert.equal(
    await control(".component-dock", "details-a").evaluate((el) => el.open),
    true,
  );
  await back();
  console.log("ok: docked cross-component details toggle snapshot");

  await importFixture(fixture({ title: "Zoomed entry" }));
  await page
    .locator('.page-frame .dv-canvas-controls button[aria-label="缩小"]')
    .click();
  await page
    .locator('.page-frame .dv-canvas-controls button[aria-label="缩小"]')
    .click();
  const rootSource = page.locator('.page-frame [data-component-id="a"]');
  const natural = await rootSource.evaluate((el) => ({
    width: el.offsetWidth,
    height: el.offsetHeight,
  }));
  await rootSource.locator(".rf-root-title").click();
  await waitDock();
  const layout = await dock.evaluate((el) => ({
    width: Number(el.dataset.baseWidth),
    height: Number(el.dataset.baseHeight),
  }));
  assert.deepEqual(layout, natural);
  await assertHit(dock.locator('[data-test-control="check-a"]'));
  await back();
  assert.equal(
    await page.locator(".page-frame .dv-canvas-zoom-ratio").textContent(),
    "64%",
  );
  console.log(
    "ok: plain component click restored; zoomed overview enters dock with natural dimensions and returns at same zoom",
  );

  // Release outside stage without ever crossing 5px; reentry without buttons must not pan.
  const stage = page.locator(".dv-canvas-stage");
  const box = await stage.boundingBox();
  const before = await page
    .locator(".dv-canvas-world")
    .evaluate((el) => el.style.transform);
  await page.mouse.move(box.x + 1, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x - 1, box.y + 30);
  await page.mouse.up();
  await page.mouse.move(box.x + 60, box.y + 80);
  assert.equal(
    await page.locator(".dv-canvas-world").evaluate((el) => el.style.transform),
    before,
  );
  console.log(
    "ok: off-stage release below click threshold leaves no drag state",
  );

  await importFixture(fixture({ graph: true, title: "Graph gestures" }));
  const graph = page.getByRole("button", { name: "Graph A", exact: true });
  assert.equal(
    await graph.evaluate((el) => Boolean(el.closest(".dv-canvas-world"))),
    true,
  );
  let graphBox = await graph.boundingBox();
  const worldBefore = await page
    .locator(".dv-canvas-world")
    .evaluate((el) => el.style.transform);
  await page.mouse.move(
    graphBox.x + graphBox.width / 2,
    graphBox.y + graphBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    graphBox.x + graphBox.width / 2 + 35,
    graphBox.y + graphBox.height / 2 + 10,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.notEqual(
    await page.locator(".dv-canvas-world").evaluate((el) => el.style.transform),
    worldBefore,
  );
  assert.equal(await dock.isVisible(), false);
  await page
    .locator('.page-frame .dv-canvas-controls button[aria-label="缩小"]')
    .click();
  const afterZoom = await graph.boundingBox();
  assert.ok(Math.abs(afterZoom.width / graphBox.width - 0.8) < 0.03);
  await graph.click();
  await waitDock();
  console.log(
    "ok: graph follows pan/zoom, drag suppresses click, real click activates node",
  );

  await importFixture(
    fixture({ title: "Original confirmed", status: "confirmed" }),
  );
  assert.equal(
    await page.locator('[data-contract-id="contract-1"]').count(),
    0,
  );
  await page.getByTestId("overview-component-a").click();
  await waitDock();
  assert.equal(
    await page
      .locator('[data-contract-id="contract-1"]')
      .first()
      .getAttribute("data-contract-status"),
    "confirmed",
  );
  await importFixture(
    fixture({ title: "Imported proposed", status: "proposed" }),
  );
  await page.getByTestId("overview-component-a").click();
  await waitDock();
  const cards = page.locator('[data-contract-id="contract-1"]');
  assert.ok((await cards.count()) > 0);
  for (const card of await cards.all()) {
    assert.equal(await card.getAttribute("data-contract-status"), "proposed");
    assert.match(await card.textContent(), /Imported proposed contract/);
    assert.doesNotMatch(await card.textContent(), /Original confirmed/);
  }
  await page
    .locator(".inspector")
    .getByRole("button", { name: "查看接口", exact: true })
    .click();
  await assertHit(page.getByRole("button", { name: "关闭详情", exact: true }));
  await page
    .locator(".rich-detail button.api-field")
    .filter({ hasText: "legacy" })
    .first()
    .click();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page
    .locator('.inspector [data-contract-id="contract-1"] > details > summary')
    .click();
  await page.locator('.inspector [data-contract-field="contract"]').hover();
  await page.locator(".inspector .david-breadcrumb").hover();
  assert.equal(
    await dock
      .locator('[data-review-target="legacy-a"]')
      .evaluate((el) => el.classList.contains("field-highlight")),
    true,
  );
  await dock.locator('[data-api-field="other"]').hover();
  await page.waitForFunction(() =>
    document
      .querySelector('.inspector [data-contract-field="other"]')
      ?.classList.contains("is-field-active"),
  );
  await dock.locator('[data-api-field="other"]').click();
  await page.locator(".inspector .david-breadcrumb").hover();
  assert.equal(
    await dock
      .locator('[data-api-field="other"]')
      .evaluate((el) => el.classList.contains("field-highlight")),
    true,
  );
  console.log(
    "ok: actual JSON import refreshes confirmed/proposed contracts; legacy hover restoration and page-to-panel selection",
  );

  // Actual appearance-selection commits through a private daemon. Derive expected
  // content point independently from the painted clone rectangle, not context code.
  for (const height of [430, 2000]) {
    await importFixture(fixture({ height, title: `Capture ${height}` }));
    await page.getByTestId("overview-component-a").click();
    await waitDock();
    await page
      .locator('.dv-canvas-dock-controls-anchor button[aria-label="放大"]')
      .click();
    await dock.evaluate((el) => {
      el.scrollTop = 125;
      el.scrollLeft = 0;
    });
    const geometry = await dock.evaluate((el) => {
      const clone = el.querySelector('[data-component-id="a"]');
      const visual = clone.getBoundingClientRect();
      const viewport = el.getBoundingClientRect();
      const x = Math.max(viewport.left, visual.left) + 80;
      const y = Math.max(viewport.top, visual.top) + 80;
      return {
        x,
        y,
        expected: {
          x: (x - visual.left) / (visual.width / clone.offsetWidth),
          y: (y - visual.top) / (visual.height / clone.offsetHeight),
        },
        model: el.dataset.dockModel,
      };
    });
    assert.equal(geometry.model, height === 430 ? "transform" : "viewport");
    await page
      .getByRole("button", { name: "进入框选评价模式", exact: true })
      .click();
    await page.mouse.move(geometry.x - 12, geometry.y - 12);
    await page.mouse.down();
    await page.mouse.move(geometry.x + 12, geometry.y + 12, { steps: 3 });
    await page.mouse.up();
    const panel = page.getByTestId("david-feedback-panel");
    await panel.waitFor();
    await panel.getByPlaceholder("描述你的反馈…").fill(`Capture ${height}`);
    await panel.getByRole("button", { name: "提交反馈", exact: true }).click();
    await page.waitForFunction(
      (note) =>
        JSON.parse(
          document.querySelector("#david-agent-feedback").textContent,
        ).entries.some((entry) => entry.suggestion === note),
      `Capture ${height}`,
    );
    const doc = await service.read("review-regression");
    const selection = doc.entries.find(
      (entry) => entry.suggestion === `Capture ${height}`,
    ).scope.selection;
    const point = selection.context.canvasPoint;
    assert.ok(point, JSON.stringify(selection.context));
    assert.ok(
      Math.abs(point.x - geometry.expected.x) < 1.5 &&
        Math.abs(point.y - geometry.expected.y) < 1.5,
      JSON.stringify({ point, geometry }),
    );
    await page.keyboard.press("Escape");
    console.log(
      `ok: saved dock capture coordinates (${geometry.model}, user zoom and native scroll)`,
    );
  }
  // Overlap live mounted surfaces deterministically without changing z-index.
  // Each probe is a real hit-tested button inside its original stacking context.
  const probeLayers = async (layers) => {
    const observed = await page.evaluate((selectors) => {
      const saved = [];
      try {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`missing layer ${selector}`);
          saved.push({ element, style: element.getAttribute("style") });
          Object.assign(element.style, {
            position: "fixed",
            inset: "auto",
            left: "80px",
            top: "80px",
            width: "120px",
            height: "120px",
            transform: "none",
            opacity: "1",
            visibility: "visible",
            overflow: "hidden",
            pointerEvents: "auto",
          });
          const button = document.createElement("button");
          button.dataset.layerProbe = selector;
          button.style.cssText =
            "position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:auto";
          element.appendChild(button);
        }
        const hits = [];
        for (const selector of [...selectors].reverse()) {
          const hit = document.elementFromPoint(140, 140);
          hits.push(
            [...selectors].reverse().find((candidate) => {
              const root = document.querySelector(candidate);
              return root === hit || root.contains(hit);
            }),
          );
          document.querySelector(selector).style.visibility = "hidden";
          document.querySelector(selector).style.pointerEvents = "none";
          // Explicit descendant pointer-events overrides require removal too.
          document.querySelector(`[data-layer-probe='${selector}']`).remove();
        }
        return hits;
      } finally {
        document
          .querySelectorAll("[data-layer-probe]")
          .forEach((el) => el.remove());
        saved.forEach(({ element, style }) => {
          if (style === null) element.removeAttribute("style");
          else element.setAttribute("style", style);
        });
      }
    }, layers);
    assert.deepEqual(observed, [...layers].reverse());
  };
  await page
    .locator(".inspector")
    .getByRole("button", { name: "查看接口", exact: true })
    .click();
  await page.evaluate(async () => {
    const { mountLayerPopover } =
      await import("/scripts/browser-layer-probe.mjs");
    window.closeLayerPopover = mountLayerPopover();
  });
  await page.locator(".hover-popover").waitFor();
  const selectors = [
    ".inspector-shell",
    ".rich-detail-host",
    ".component-dock",
    ".comment-rail",
    ".hover-popover",
  ];
  const z = await page.evaluate(
    (list) =>
      list.map((selector) =>
        Number(getComputedStyle(document.querySelector(selector)).zIndex),
      ),
    selectors,
  );
  assert.deepEqual(z, [30, 35, 40, 45, 950]);
  await probeLayers(selectors);
  await page.evaluate(() => window.closeLayerPopover());
  // Capture on the real rich dialog brings up feedback above it, without a click-through.
  const detailRect = await page.locator(".rich-detail-title").boundingBox();
  await page
    .getByRole("button", { name: "进入框选评价模式", exact: true })
    .click();
  await page.mouse.move(detailRect.x + 5, detailRect.y + 5);
  await page.mouse.down();
  await page.mouse.move(detailRect.x + 95, detailRect.y + 25, { steps: 2 });
  await page.mouse.up();
  await page.getByTestId("david-feedback-panel").waitFor();
  await page.evaluate(() =>
    document
      .querySelector('[data-testid="david-feedback-panel"]')
      .parentElement.setAttribute("data-feedback-backdrop-probe", ""),
  );
  assert.equal(
    await page
      .locator("[data-feedback-backdrop-probe]")
      .evaluate((el) => Number(getComputedStyle(el).zIndex)),
    1000,
  );
  await probeLayers([
    ".inspector-shell",
    ".rich-detail-host",
    ".component-dock",
    ".comment-rail",
    "[data-feedback-backdrop-probe]",
    ".david-global-capture",
  ]);
  assert.equal(
    await page
      .locator(".david-global-capture")
      .evaluate((el) => Number(getComputedStyle(el).zIndex)),
    10000,
  );
  console.log(
    "ok: live inspector/dock/rail/rich-detail/popover/feedback/global-capture overlap hit testing, exact layer contract preserved",
  );

  assert.deepEqual(errors, []);
  console.log("review fixes browser regressions passed");
} catch (error) {
  console.error("review fixes FAILED at", page.url(), error);
  await page.screenshot({
    path: "/tmp/david-review-fixes-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await server.close();
  await service.close();
}
