import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = new URL(process.env.BASE_URL || "http://127.0.0.1:5196/").href;
const VIEWPORT = { width: 1440, height: 1100 };

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto(BASE_URL);
    await page.locator(".david-overview-surface").waitFor();
    await page.evaluate(() => {
      window.__effectiveOpacity = (el) => {
        let node = el;
        let value = 1;
        while (node && node.nodeType === 1) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden")
            return 0;
          value *= Number(style.opacity);
          node = node.parentElement;
        }
        return value;
      };
      window.__overview = document.querySelector(".david-overview-surface");
    });

    await page.getByTestId("overview-component-top-gmv-techniques").click();
    await page.waitForTimeout(600);

    const opened = await page.evaluate(() => {
      const overview = document.querySelector(".david-overview-surface");
      const details = document.querySelector(".component-details");
      const dock = document.querySelector(".component-dock");
      const detailsRect = details.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      return {
        sameNode: window.__overview === overview,
        connected: window.__overview.isConnected,
        inert: window.__overview.inert,
        overviewOpacity: window.__effectiveOpacity(window.__overview),
        detailsHeight: detailsRect.height,
        detailsScrollHeight: details.scrollHeight,
        detailsTop: detailsRect.top,
        dockCenterY: dockRect.top + dockRect.height / 2,
      };
    });
    assert.equal(
      opened.sameNode,
      true,
      "overview DOM identity must be preserved",
    );
    assert.equal(opened.connected, true, "overview must stay connected");
    assert.equal(
      opened.inert,
      true,
      "overview must be inert while details are open",
    );
    assert.ok(
      opened.overviewOpacity < 0.05,
      `overview effective opacity must be 0, got ${opened.overviewOpacity}`,
    );
    assert.ok(
      opened.detailsHeight >= opened.detailsScrollHeight - 3,
      `.component-details must not flex-shrink: rect ${opened.detailsHeight} vs scrollHeight ${opened.detailsScrollHeight}`,
    );
    assert.ok(
      opened.detailsTop >= 0,
      `.component-details top must be >= 0, got ${opened.detailsTop}`,
    );
    assert.ok(
      Math.abs(opened.dockCenterY - 550) <= 3,
      `.component-dock centerY must be ~550, got ${opened.dockCenterY}`,
    );

    // Persistent crossfade: sample both layers across the return transition.
    await page.evaluate(() => {
      window.__samples = [];
      window.__sampleStart = window.performance.now();
      const tick = (now) => {
        const overview = document.querySelector(".david-overview-surface");
        const inspector = document.querySelector(".inspector-shell");
        window.__samples.push({
          t: now,
          overview: overview ? window.__effectiveOpacity(overview) : 0,
          inspector: inspector ? window.__effectiveOpacity(inspector) : 0,
        });
        if (now - window.__sampleStart < 750) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const clickAt = await page.evaluate(() => window.performance.now());
    await page
      .getByTestId("david-breadcrumb")
      .getByRole("button", { name: "总览", exact: true })
      .click();
    await page.waitForTimeout(800);

    const samples = await page.evaluate(() => window.__samples);
    const afterClick = samples.filter((s) => s.t >= clickAt);
    assert.ok(
      afterClick.length > 0,
      "rAF sampler recorded no frames after click",
    );
    const firstVisible = afterClick.find((s) => s.overview > 0.05);
    assert.ok(
      firstVisible,
      "overview never became visible during return transition",
    );
    assert.ok(
      firstVisible.t - clickAt < 180,
      `overview first visible at ${firstVisible.t - clickAt}ms, expected < 180ms`,
    );
    const blankFrames = afterClick.filter(
      (s) => s.overview < 0.05 && s.inspector < 0.05,
    );
    assert.equal(
      blankFrames.length,
      0,
      "crossfade must not expose frames where both layers are invisible",
    );
    const identityKept = await page.evaluate(
      () =>
        window.__overview === document.querySelector(".david-overview-surface"),
    );
    assert.equal(
      identityKept,
      true,
      "overview DOM identity must survive the return transition",
    );

    // Reduced motion: transitions collapse, no errors, overview ends active.
    const reducedContext = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: "reduce",
    });
    const reducedPage = await reducedContext.newPage();
    reducedPage.on("pageerror", (error) => pageErrors.push(error));
    await reducedPage.goto(BASE_URL);
    await reducedPage.locator(".david-overview-surface").waitFor();
    await reducedPage.evaluate(() => {
      window.__overview = document.querySelector(".david-overview-surface");
    });
    await reducedPage
      .getByTestId("overview-component-top-gmv-techniques")
      .click();
    await reducedPage.waitForTimeout(100);
    await reducedPage
      .getByTestId("david-breadcrumb")
      .getByRole("button", { name: "总览", exact: true })
      .click();
    await reducedPage.waitForTimeout(100);
    const reducedState = await reducedPage.evaluate(() => {
      const overview = document.querySelector(".david-overview-surface");
      return {
        sameNode: window.__overview === overview,
        connected: overview.isConnected,
        inert: overview.inert,
      };
    });
    assert.equal(
      reducedState.sameNode,
      true,
      "reduced-motion overview identity must be preserved",
    );
    assert.equal(
      reducedState.connected,
      true,
      "reduced-motion overview must stay connected",
    );
    assert.equal(
      reducedState.inert,
      false,
      "reduced-motion overview must be active after return",
    );

    assert.equal(
      pageErrors.length,
      0,
      `expected no page errors, got: ${pageErrors.map((e) => e.message).join("; ")}`,
    );
    console.log("scene transitions OK");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
