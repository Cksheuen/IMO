#!/usr/bin/env node
// E2E full-page host test for the david project.
// 覆盖「嵌套整页宿主」的判定、落位与清理：
//   - 双击条件（作者显式 interaction=drilldown 且锚点 data-review-host=fullpage）→
//     进整页宿主：dataset.dockModel === "fullpage"、无滚动 wrapper、clone 不缩放；
//   - 只有 interaction=drilldown 无 data-review-host → 仍走既有 dock 行为（防回归）；
//   - 整页宿主激活时 overview surface 仍在 DOM 且 inert（HARD-GATE 13）；
//   - 退出后 dockModel 清理、is-fullpage-host 状态 class 移除。
// 默认自带 vite 实例（内核分配的空闲 loopback 端口）；被聚合器
// （test-ui-regressions）调用时读 BASE_URL 复用共享 server，不再起自己的 vite。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { startViteServer } from "./browser-test-server.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
// Assigned in main(): aggregator-provided BASE_URL or a kernel-allocated port.
let BASE_URL = process.env.BASE_URL || "";
const SAMPLE_PATH = fileURLToPath(
  new URL(
    "../src/samples/video-conversion-shooting-guide.review.json",
    import.meta.url,
  ),
);

const SELECTORS = {
  overviewTopGmv: '[data-testid="overview-component-top-gmv-techniques"]',
  dockVisible: ".component-dock.is-visible:not(.flip-morph)",
  videoGridInDock:
    '[data-testid="component-dock"] [data-review-node-id="video-grid-node"]',
  videoCardInDock:
    '[data-testid="component-dock"] [data-review-node-id="video-card-1-node"]',
  overviewSurface: ".david-overview-surface",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 构造测试 fixture：沿用既有「测试内注入」手法，不落盘评审 JSON。
 * host=true 时同时注入 interaction=drilldown 与锚点 data-review-host="fullpage"；
 * host=false 时只注入 interaction=drilldown（防回归：无锚点属性应走旧 dock 行为）。
 */
function buildReviewFixture(host) {
  const review = JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));
  review.title = host ? "整页宿主注入测试" : "整页宿主防回归测试";
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.id === "video-grid-node") node.interaction = "drilldown";
      visit(node.children);
    }
  };
  const components = Array.isArray(review.components)
    ? review.components
    : Object.values(review.components ?? {});
  for (const component of components) visit(component.children);

  if (host) {
    const marker = `<div class="app-video-grid" data-review-node-id="video-grid-node">`;
    const withHost = `<div class="app-video-grid" data-review-node-id="video-grid-node" data-review-host="fullpage">`;
    assert.ok(
      review.pageHtml.includes(marker),
      "既有 video-grid-node 锚点标记应存在于 pageHtml",
    );
    review.pageHtml = review.pageHtml.replace(marker, withHost);
  }
  return {
    name: "video-conversion-shooting-guide.review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(review), "utf8"),
  };
}

async function importFixture(page, host) {
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles(buildReviewFixture(host));
  await page
    .locator("h1.title")
    .filter({ hasText: host ? "整页宿主注入测试" : "整页宿主防回归测试" })
    .waitFor({ state: "visible" });
}

/** 镜像 src/components/review-canvas/ReviewCanvas.tsx readTransformScale：读 clone 的缩放比例。 */

async function captureDockState(page) {
  return page.evaluate(() => {
    // 镜像 ReviewCanvas.tsx readTransformScale，须内联（evaluate 回调无法访问 Node 侧函数）。
    const readTransformScale = (transform) => {
      if (!transform || transform === "none") return 1;
      const values = transform
        .match(/-?\d+(?:\.\d+)?/g)
        ?.map((value) => Number(value));
      if (!values || values.length < 2) return 1;
      return Math.hypot(values[0], values[1]) || 1;
    };
    const dock = document.querySelector('[data-testid="component-dock"]');
    if (!dock) return null;
    const stage = document.querySelector(".stage");
    const clone = dock.firstElementChild;
    const overview = document.querySelector(".david-overview-surface");
    const cloneTransform = clone
      ? getComputedStyle(clone).transform || "none"
      : "none";
    return {
      model: dock.dataset.dockModel,
      visible: dock.classList.contains("is-visible"),
      flipMorph: dock.classList.contains("flip-morph"),
      hasScrollWrapper:
        clone?.classList.contains("component-dock-scroll-content") === true,
      cloneTransform,
      cloneScale: readTransformScale(cloneTransform),
      stageFullpage: stage?.classList.contains("is-fullpage-host") === true,
      overviewInDom: overview !== null,
      overviewInert: overview?.hasAttribute("inert") === true,
      overviewHidden: overview?.classList.contains("is-hidden") === true,
    };
  });
}

async function waitForDockModel(page, model, { timeout = 6_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await captureDockState(page);
    if (state && state.model === model) return state;
    await sleep(100);
  }
  const state = await captureDockState(page);
  throw new Error(
    `dockModel should be "${model}", got ${JSON.stringify(state)}`,
  );
}

async function waitForDockSettled(page, { timeout = 6_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await captureDockState(page);
    if (
      state &&
      state.visible &&
      !state.flipMorph &&
      state.model !== undefined &&
      state.model !== "fullpage"
    ) {
      return state;
    }
    await sleep(100);
  }
  throw new Error(
    `dock never settled out of fullpage, got ${JSON.stringify(await captureDockState(page))}`,
  );
}

async function firstVisible(page, selector, { timeout = 5_000 } = {}) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  return locator;
}

async function launchChromium() {
  const { chromium } = await import("playwright");
  const candidates = [
    { channel: "chrome" },
    { channel: "chromium" },
    ...(process.env.CHROME_BIN
      ? [{ executablePath: process.env.CHROME_BIN }]
      : []),
    {},
  ];
  for (const options of candidates) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "failed to launch Playwright chromium (tried chrome, chromium, CHROME_BIN, bundled)",
  );
}

async function main() {
  const errors = [];
  let server;
  let browser;
  try {
    if (!process.env.BASE_URL) {
      const vite = await startViteServer(PROJECT_ROOT);
      server = vite.server;
      BASE_URL = vite.baseUrl;
    }
    browser = await launchChromium();

    // ---- 用例 A：双重条件满足 → 整页宿主 --------------------------------------
    const fullContext = await browser.newContext();
    const page = await fullContext.newPage();
    page.on("pageerror", (error) => errors.push(error));
    await page.goto(BASE_URL);
    await importFixture(page, true);

    await (await firstVisible(page, SELECTORS.overviewTopGmv)).click();
    await (await firstVisible(page, SELECTORS.dockVisible)).waitFor();
    const rootState = await captureDockState(page);
    assert.ok(rootState, "root dock should be rendered");
    assert.ok(
      rootState.model === "transform" || rootState.model === "viewport",
      `root dockModel must be transform/viewport, got "${rootState.model}"`,
    );
    assert.equal(
      rootState.stageFullpage,
      false,
      "root must not be fullpage host",
    );

    await (await firstVisible(page, SELECTORS.videoGridInDock)).click();
    const fullState = await waitForDockModel(page, "fullpage");

    assert.equal(fullState.visible, true, "fullpage dock must be visible");
    assert.equal(
      fullState.flipMorph,
      false,
      "fullpage dock must not keep flip-morph",
    );
    assert.equal(
      fullState.hasScrollWrapper,
      false,
      "fullpage dock must not wrap content in .component-dock-scroll-content",
    );
    assert.ok(
      Math.abs(fullState.cloneScale - 1) < 0.001,
      `fullpage clone scale must be 1, got ${fullState.cloneTransform} (scale ${fullState.cloneScale})`,
    );
    assert.equal(
      fullState.stageFullpage,
      true,
      ".stage must carry is-fullpage-host while fullpage host is active",
    );

    // HARD-GATE 13: overview 常驻 surface 不得被卸载，仍 inert + 隐藏。
    assert.ok(
      fullState.overviewInDom,
      "overview surface must stay in the DOM during fullpage host",
    );
    assert.ok(
      fullState.overviewInert,
      "overview surface must stay inert during fullpage host",
    );
    assert.ok(
      fullState.overviewHidden,
      "overview surface must stay hidden during fullpage host",
    );

    // 退出整页宿主：Escape 从 drilldown 节点回根 → dockModel 不再是 fullpage、状态 class 移除。
    await page.keyboard.press("Escape");
    const exitedState = await waitForDockSettled(page);
    assert.ok(
      exitedState.model === "transform" || exitedState.model === "viewport",
      `after exit dockModel should be transform/viewport, got "${exitedState.model}"`,
    );
    assert.equal(
      exitedState.stageFullpage,
      false,
      "is-fullpage-host must be removed after exit",
    );
    assert.equal(
      exitedState.hasScrollWrapper,
      false,
      "no scroll wrapper after exit",
    );
    // 返回总览：dockModel 数据属性被清理。
    await page.keyboard.press("Escape");
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const st = await captureDockState(page);
      if (st && st.model === undefined) break;
      await sleep(100);
    }
    const finalState = await captureDockState(page);
    assert.equal(
      finalState.model,
      undefined,
      "dockModel must be cleaned up after returning to overview",
    );
    assert.equal(
      finalState.stageFullpage,
      false,
      "is-fullpage-host must be removed after returning to overview",
    );

    // ---- 用例 B：只有 drilldown、无 data-review-host → 走旧 dock 行为（防回归） ----
    const regContext = await browser.newContext();
    const regPage = await regContext.newPage();
    regPage.on("pageerror", (error) => errors.push(error));
    await regPage.goto(BASE_URL);
    await importFixture(regPage, false);

    await (await firstVisible(regPage, SELECTORS.overviewTopGmv)).click();
    await (await firstVisible(regPage, SELECTORS.dockVisible)).waitFor();
    await (await firstVisible(regPage, SELECTORS.videoGridInDock)).click();
    const regState = await waitForDockSettled(regPage);
    assert.ok(
      regState.model === "transform" || regState.model === "viewport",
      `drilldown without data-review-host must keep old dock model (transform/viewport), got "${regState.model}"`,
    );
    assert.equal(
      regState.stageFullpage,
      false,
      "regression case must not enter fullpage host",
    );
    assert.equal(
      regState.hasScrollWrapper,
      regState.model === "viewport",
      "regression case scroll wrapper should follow its dock model",
    );

    assert.equal(
      errors.length,
      0,
      `expected no page errors, got: ${errors.map((e) => e?.stack || String(e)).join("; ")}`,
    );
    console.log("[test-fullpage-host] OK");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[test-fullpage-host] FAILED:", error);
  process.exit(1);
});
