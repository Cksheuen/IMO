#!/usr/bin/env node
// E2E drilldown smoke test for the david project.
// Boots `npx vite` on a kernel-assigned free loopback port (the real URL is
// parsed from vite's stdout), drives the drilldown UI with Playwright (system
// Chrome preferred, bundled chromium fallback), and exits non-zero on any
// assertion, console error, or pageerror.

import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { HOST, startViteCli, stopViteCli } from "./browser-test-server.mjs";

// Assigned in main() from the kernel-allocated vite port; read by the pass
// helpers. Tests never bind a fixed port, so concurrent runs and an occupied
// dev port cannot collide.
let BASE_URL;
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SERVE_FEEDBACK_PATH = fileURLToPath(
  new URL("./serve-feedback.mjs", import.meta.url),
);
const SAMPLE_REVIEW_PATH = fileURLToPath(
  new URL(
    "../src/samples/video-conversion-shooting-guide.review.json",
    import.meta.url,
  ),
);

const SELECTORS = {
  overview: '[data-testid="david-overview"]',
  topGmvButton: '[data-testid="overview-component-top-gmv-techniques"]',
  dock: '[data-testid="component-dock"]',
  inspector: ".component-details.is-open",
  technique:
    '[data-testid="component-dock"] [data-review-node-id="technique-chips-node"]',
  videoGrid:
    '[data-testid="component-dock"] [data-review-node-id="video-grid-node"]',
  videoCard:
    '[data-testid="component-dock"] [data-review-node-id="video-card-1-node"]',
  leaf: '[data-testid="component-dock"] [data-review-node-id="video-card-1-node"]',
  breadcrumb: '[data-testid="david-breadcrumb"]',
  breadcrumbItems: "button.david-breadcrumb-item",
  close: ".component-details button.close",
  feedbackOpen: '[data-testid="david-feedback-open"]',
  suggestion: '[data-testid="feedback-suggestion"]',
  submit: '[data-testid="feedback-submit"]',
  feedbackScript: "script#david-agent-feedback",
  pluginInput: '[data-testid="david-plugin-import"]',
  personalized: '[role="status"]:has-text("个性化:")',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadDrilldownReviewFixture(serviceBaseUrl) {
  const review = JSON.parse(readFileSync(SAMPLE_REVIEW_PATH, "utf8"));
  review.title = "显式复杂预览测试";
  // 评论唯一数据源是本机评论服务（HARD-GATE 14）。测试注入临时端口，
  // 避免占用默认 5180 撞上用户在跑的实例。
  if (serviceBaseUrl) review.service = { baseUrl: serviceBaseUrl };
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
  return {
    name: "video-conversion-shooting-guide.review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(review), "utf8"),
  };
}

async function importDrilldownReviewFixture(page, serviceBaseUrl) {
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles(loadDrilldownReviewFixture(serviceBaseUrl));
  await page
    .locator("h1.title")
    .filter({ hasText: "显式复杂预览测试" })
    .waitFor({ state: "visible" });
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`vite exited before serving (code ${child.exitCode})`);
    }
    try {
      const response = await globalThis.fetch(BASE_URL, {
        signal: globalThis.AbortSignal.timeout(1_000),
      });
      if (response.ok || response.status === 304) return;
    } catch {
      // server not up yet
    }
    await sleep(300);
  }
  throw new Error(`vite did not start within ${timeoutMs}ms`);
}

/** 取一个空闲端口：绑 0 让内核分配，读回后立即释放。 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/**
 * 起一个本机评论服务（HARD-GATE 14 的唯一数据源）。
 * 随机空闲端口 + mkdtemp 存储根：既不占默认 5180，也不污染真实 ~/.imo。
 */
async function startFeedbackService() {
  const port = await freePort();
  const storeRoot = mkdtempSync(join(tmpdir(), "david-drilldown-feedback-"));
  const child = spawn(process.execPath, [SERVE_FEEDBACK_PATH], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      IMO_GLOBAL_ROOT: storeRoot,
      DAVID_FEEDBACK_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const baseUrl = `http://${HOST}:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `feedback service exited early (code ${child.exitCode}):\n${stderr}`,
      );
    }
    try {
      const res = await globalThis.fetch(`${baseUrl}/health`, {
        signal: globalThis.AbortSignal.timeout(1_000),
      });
      if (res.ok) {
        return {
          baseUrl,
          storeDir: join(storeRoot, "runtime", "david", "feedback"),
          stop: async () => {
            if (child.exitCode === null) {
              child.kill("SIGTERM");
              // 等端口真正释放，否则页面刷新后可能仍探活成功。
              const stopDeadline = Date.now() + 10_000;
              while (child.exitCode === null && Date.now() < stopDeadline) {
                await sleep(50);
              }
            }
            await waitForServiceDown(baseUrl);
          },
          cleanup: () => rmSync(storeRoot, { recursive: true, force: true }),
        };
      }
    } catch {
      // 还没监听，继续等
    }
    await sleep(150);
  }
  child.kill("SIGTERM");
  rmSync(storeRoot, { recursive: true, force: true });
  throw new Error(`feedback service did not start within 20s:\n${stderr}`);
}

async function waitForServiceDown(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await globalThis.fetch(`${baseUrl}/health`, {
        signal: globalThis.AbortSignal.timeout(500),
      });
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error(`feedback service still reachable at ${baseUrl}`);
}

/** 直接读服务落盘的评论文件，证明写入真的到了服务，而不是只在内存里。 */
function readServiceEntries(service, slug) {
  const file = join(service.storeDir, `${slug}.json`);
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(doc.entries) ? doc.entries : [];
  } catch {
    return [];
  }
}

/** 服务存储目录下已落盘的 slug 文件名（用于证明离线时无任何新落盘）。 */
function serviceStoreFiles(service) {
  try {
    return readdirSync(service.storeDir).sort();
  } catch {
    return [];
  }
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

/**
 * 本机评论服务的预期噪音：探活时服务未起（ERR_CONNECTION_REFUSED），
 * 以及服务上该 slug 尚无评论数据（404，transport 按 undefined 处理）。
 * 只豁免 loopback 评论服务端点，其余资源/运行时错误一律计入失败。
 */
function isExpectedFeedbackServiceNoise(text, url) {
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/(health|feedback\/)/.test(
      url,
    )
  ) {
    return false;
  }
  return /ERR_CONNECTION_REFUSED/.test(text) || /status of 404/.test(text);
}

function attachErrorListeners(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text() || "";
    const url = msg.location()?.url || "";
    if (isExpectedFeedbackServiceNoise(text, url)) return;
    errors.push(`console.error: ${text}${url ? ` @ ${url}` : ""}`);
  });
  page.on("pageerror", (err) =>
    errors.push(`pageerror: ${err?.stack || String(err)}`),
  );
  return errors;
}

async function firstVisible(page, selectors, { timeout = 5_000 } = {}) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  // Child actions require the containing FLIP to have settled. Visibility
  // alone is true while the clone is still being replaced/animated.
  if (list.some((selector) => selector.includes("data-review-node-id"))) {
    await page
      .locator(".component-dock.is-visible:not(.flip-morph)")
      .waitFor({ state: "visible", timeout });
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of list) {
      const locator = page.locator(selector).first();
      if (
        (await locator.count().catch(() => 0)) > 0 &&
        (await locator.isVisible().catch(() => false))
      ) {
        return locator;
      }
    }
    await sleep(100);
  }
  throw new Error(`no visible element matched: ${list.join(" | ")}`);
}

async function clickIfVisible(page, selectors, timeout = 1_000) {
  try {
    await (await firstVisible(page, selectors, { timeout })).click();
    return true;
  } catch {
    return false;
  }
}

async function readRowKeys(page) {
  const inspector = await firstVisible(page, SELECTORS.inspector);
  return inspector
    .locator("[data-trd-row]")
    .evaluateAll((rows) =>
      rows.map((row) => row.dataset.trdRow).filter(Boolean),
    );
}

async function breadcrumbState(page, { optional = false } = {}) {
  try {
    const breadcrumb = await firstVisible(page, SELECTORS.breadcrumb, {
      timeout: optional ? 1_000 : 5_000,
    });
    const items = await breadcrumb.locator(SELECTORS.breadcrumbItems).count();
    const text = (await breadcrumb.textContent()) || "";
    return { items, text };
  } catch (err) {
    if (optional) return { items: 0, text: "" };
    throw err;
  }
}

async function toolbarState(page) {
  const inspector = await firstVisible(page, SELECTORS.inspector);
  const switches = inspector.locator(".inspector-actions .switch");
  const count =
    (await inspector.locator(".switch-count").textContent())?.trim() ?? "";
  const back = inspector.locator("button.close");
  return {
    prevDisabled: await switches.nth(0).isDisabled(),
    nextDisabled: await switches.nth(1).isDisabled(),
    count,
    backText: ((await back.textContent()) || "").replace(/\s+/g, " ").trim(),
    backLabel: await back.getAttribute("aria-label"),
  };
}

function assertToolbarState(actual, expected, message) {
  for (const [key, value] of Object.entries(expected)) {
    assert(
      actual[key] === value,
      `${message}: ${key} should be ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`,
    );
  }
}

async function clickSibling(page, direction) {
  const inspector = await firstVisible(page, SELECTORS.inspector);
  await inspector
    .locator(".inspector-actions .switch")
    .nth(direction < 0 ? 0 : 1)
    .click();
}

async function clickToolbarBack(page) {
  await (await firstVisible(page, SELECTORS.close)).click();
}

// Root -> overview restore: the overview cross-fades in immediately while the
// dock FLIPs back over 460ms, so overview visibility alone is not enough.
// Wait until the overview surface is interactive again (phase settled to
// "page", inert removed) and the dock has fully unmounted.
async function waitForOverviewRestored(page, label) {
  await firstVisible(page, ".david-overview-surface:not([inert])", {
    timeout: 5_000,
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const dockVisible = await page
      .locator(SELECTORS.dock)
      .first()
      .isVisible()
      .catch(() => false);
    if (!dockVisible) return;
    await sleep(50);
  }
  throw new Error(`dock should be settled closed ${label}`);
}

async function dockCloneSignature(page) {
  return (await firstVisible(page, SELECTORS.dock)).evaluate((dock) => {
    const clone = dock.firstElementChild;
    const hasNode = (id) =>
      clone?.getAttribute("data-review-node-id") === id ||
      !!clone?.querySelector(`[data-review-node-id="${id}"]`);
    return {
      componentId: clone?.getAttribute("data-component-id") || "",
      reviewNodeId: clone?.getAttribute("data-review-node-id") || "",
      hasTechnique: hasNode("technique-chips-node"),
      hasVideoGrid: hasNode("video-grid-node"),
      hasVideoCard: hasNode("video-card-1-node"),
    };
  });
}

function assertCloneSignature(actual, expected, message) {
  for (const [key, value] of Object.entries(expected)) {
    assert(
      actual[key] === value,
      `${message}: ${key} should be ${String(value)}, got ${String(actual[key])}`,
    );
  }
}

// Direct DOM read of the dock's cloned root: the firstElementChild must be an
// actual element carrying the component's data-component-id (not a stale or
// missing node). Used to prove root restoration after breadcrumb/Escape.
async function dockRootCloneId(page) {
  return (await firstVisible(page, SELECTORS.dock)).evaluate((dock) => {
    const clone = dock.firstElementChild;
    return clone instanceof HTMLElement
      ? clone.getAttribute("data-component-id") || ""
      : "";
  });
}

async function dockGeometry(page) {
  const dock = await firstVisible(page, SELECTORS.dock);
  const [size, box] = await Promise.all([
    dock.evaluate((element) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    })),
    dock.boundingBox(),
  ]);
  return {
    ...size,
    visibleWidth: box?.width ?? 0,
    visibleHeight: box?.height ?? 0,
  };
}

async function readFeedbackEntries(page) {
  const raw = await page.locator(SELECTORS.feedbackScript).textContent();
  if (!raw || !raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
}

async function drilldownClicks(page) {
  await firstVisible(page, SELECTORS.overview);
  await (await firstVisible(page, SELECTORS.topGmvButton)).click();
  await firstVisible(page, SELECTORS.dock);
  await (await firstVisible(page, SELECTORS.technique)).click();
  await (await firstVisible(page, SELECTORS.videoGrid)).click();
  await (await firstVisible(page, SELECTORS.leaf, { timeout: 3_000 })).click();
  const breadcrumb = await firstVisible(page, SELECTORS.breadcrumb);
  await breadcrumb.locator(SELECTORS.breadcrumbItems).nth(1).click();
  await (await firstVisible(page, SELECTORS.close)).click();
  await firstVisible(page, SELECTORS.overview);
}

async function reducedMotionPass(browser, serviceBaseUrl) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = attachErrorListeners(page);
  try {
    await page.goto(BASE_URL);
    await importDrilldownReviewFixture(page, serviceBaseUrl);
    await drilldownClicks(page);
    assert(
      errors.length === 0,
      `reducedMotion pass page errors: ${errors.join(" | ")}`,
    );
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * HARD-GATE 14 离线态：评论服务停掉后，离线横幅可见、评论不可写，
 * 且**不降级写 localStorage**（否则 agent 与页面会读到两份数据源）。
 * 在独立 context 里跑，避免污染主 pass 的存储与错误收集。
 */
async function offlinePass(browser, service) {
  const baseUrl = service.baseUrl;
  const filesBefore = serviceStoreFiles(service);
  await service.stop();

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = attachErrorListeners(page);

  try {
    await page.goto(BASE_URL);
    // 必须先导入注入了目标 service.baseUrl 的 fixture 再等横幅：
    // 导入前页面用默认 sample（指向未运行的默认端口），也会显示离线横幅，
    // 直接 waitFor(".feedback-offline-banner") 可能命中那个陈旧横幅而空过。
    await importDrilldownReviewFixture(page, baseUrl);

    // 绑定到「指向本轮临时服务地址」的横幅，而不是任意离线横幅。
    const banner = page.locator(".feedback-offline-banner", {
      hasText: baseUrl,
    });
    await banner.waitFor({ state: "visible", timeout: 10_000 });
    // 稳定性：离线态是终态而非探活过程中的瞬态，短暂等待后必须仍然成立。
    await sleep(500);
    assert(
      (await banner.count()) === 1 && (await banner.isVisible()),
      `offline banner naming ${baseUrl} should stay visible while the service is down`,
    );
    const bannerText = ((await banner.textContent()) || "").replace(/\s+/g, "");
    assert(
      bannerText.includes(baseUrl.replace(/\s+/g, "")),
      `offline banner should name the unreachable service (${baseUrl}), got "${bannerText}"`,
    );
    assert(
      (await banner.locator(".feedback-offline-copy").count()) > 0 &&
        (await banner.locator(".feedback-offline-retry").count()) > 0,
      "offline banner must offer 复制启动指令 / 重试连接",
    );

    const toolsDetails = page.locator(".review-tools");
    if ((await toolsDetails.getAttribute("open")) === null) {
      await toolsDetails.locator("summary").click();
    }
    await clickIfVisible(page, SELECTORS.feedbackOpen);
    const entriesBefore = await readFeedbackEntries(page);
    await (
      await firstVisible(page, SELECTORS.suggestion)
    ).fill("offline write probe");
    await (await firstVisible(page, SELECTORS.submit)).click();
    await sleep(400);

    const entriesAfter = await readFeedbackEntries(page);
    assert(
      entriesAfter.length === entriesBefore.length,
      `offline submit must not add entries (${entriesBefore.length} -> ${entriesAfter.length})`,
    );
    assert(
      !JSON.stringify(entriesAfter).includes("offline write probe"),
      "offline submit must not surface the rejected entry as saved",
    );
    const leaked = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => /^david:.+:feedback$/.test(k))
        .map((k) => localStorage.getItem(k))
        .join("\n"),
    );
    assert(
      !leaked.includes("offline write probe"),
      "offline submit must not fall back to localStorage",
    );
    assert(
      JSON.stringify(serviceStoreFiles(service)) ===
        JSON.stringify(filesBefore),
      "offline submit must not write any new file into the service store",
    );

    assert(
      errors.length === 0,
      `offline pass page errors: ${errors.join(" | ")}`,
    );
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const vite = await startViteCli(PROJECT_ROOT);
  const child = vite.child;
  BASE_URL = vite.baseUrl;
  let browser;
  let feedbackService;
  try {
    await waitForServer(child);
    feedbackService = await startFeedbackService();
    browser = await launchChromium();

    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = attachErrorListeners(page);
    await page.goto(BASE_URL);
    await importDrilldownReviewFixture(page, feedbackService.baseUrl);

    // overview -> top-gmv -> dock/inspector
    await firstVisible(page, SELECTORS.overview);
    await (await firstVisible(page, SELECTORS.topGmvButton)).click();
    const dock = await firstVisible(page, SELECTORS.dock);
    const rootCrumbs = await breadcrumbState(page, { optional: true });
    const rootClone = await dockCloneSignature(page);
    assert(
      rootClone.componentId.length > 0,
      "root clone should carry the component id",
    );
    assertCloneSignature(
      rootClone,
      {
        reviewNodeId: "",
        hasTechnique: true,
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "root clone",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: false,
        nextDisabled: false,
        count: "同级 2/3",
        backText: "←返回总览",
        backLabel: "返回总览",
      },
      "root toolbar",
    );

    // clicking the dock itself must not close it
    await dock.dispatchEvent("click");
    await sleep(150);
    assert(
      await dock.isVisible().catch(() => false),
      "dock must stay visible when clicking its own body",
    );

    // technique-chips drilldown: highlight + table only f2-chips
    const techniqueChipsNode = await firstVisible(page, SELECTORS.technique);
    await techniqueChipsNode.click();
    assert(
      await techniqueChipsNode.evaluate((el) =>
        el.classList.contains("is-node-highlight"),
      ),
      "technique-chips node should have is-node-highlight",
    );
    const chipsRows = await readRowKeys(page);
    assert(
      chipsRows.length > 0,
      "table should have rows after technique-chips click",
    );
    assert(
      chipsRows.every((key) => /f2-chips/i.test(key)),
      `table rows must only be f2-chips, got: ${chipsRows.join(", ")}`,
    );
    assert(
      chipsRows.some((key) => key.toLowerCase().includes("f2-chips")),
      "table must include f2-chips",
    );
    assert(
      await page
        .locator('[data-testid="david-deep-dive"]')
        .isVisible()
        .catch(() => false),
      "david-deep-dive should be visible",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: true,
        nextDisabled: false,
        count: "同级 1/2",
        backText: "←返回上一级",
        backLabel: "返回上一级",
      },
      "technique sibling toolbar",
    );

    // video-grid drilldown: breadcrumb grows, dock clone has video-card-1, table only f2-card
    const crumbsBefore = await breadcrumbState(page);
    await (await firstVisible(page, SELECTORS.videoGrid)).click();
    const crumbsAfter = await breadcrumbState(page);
    assert(
      crumbsAfter.items > crumbsBefore.items ||
        crumbsAfter.text.length > crumbsBefore.text.length,
      `breadcrumb should grow after video-grid click (items ${crumbsBefore.items} -> ${crumbsAfter.items})`,
    );
    const complexClone = await dockCloneSignature(page);
    assertCloneSignature(
      complexClone,
      { componentId: "", reviewNodeId: "video-grid-node", hasVideoCard: true },
      "complex drilldown clone",
    );
    const cardInDock = page.locator(SELECTORS.videoCard);
    assert(
      (await cardInDock.count()) > 0,
      "dock clone should contain video-card-1-node",
    );
    const cardRows = await readRowKeys(page);
    assert(
      cardRows.length > 0,
      "table should have rows after video-grid click",
    );
    assert(
      cardRows.every((key) => /f2-card/i.test(key)),
      `table rows must only be f2-card, got: ${cardRows.join(", ")}`,
    );
    assert(
      cardRows.some((key) => key.toLowerCase().includes("f2-card")),
      "table must include f2-card",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: false,
        nextDisabled: true,
        count: "同级 2/2",
        backText: "←返回上一级",
        backLabel: "返回上一级",
      },
      "video-grid sibling toolbar",
    );

    // leaf highlight
    const leaf = await firstVisible(page, SELECTORS.leaf);
    await leaf.click();
    assert(
      await leaf.evaluate(
        (el) =>
          el.classList.contains("is-node-highlight") ||
          !!el.closest(".is-node-highlight"),
      ),
      "leaf should be highlighted after click",
    );
    const simpleClone = await dockCloneSignature(page);
    assertCloneSignature(
      simpleClone,
      {
        componentId: "",
        reviewNodeId: "video-grid-node",
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "highlight leaf should keep the complex drilldown clone",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: true,
        nextDisabled: true,
        count: "同级 1/1",
        backText: "←返回上一级",
        backLabel: "返回上一级",
      },
      "single-child leaf toolbar",
    );

    // contextual back: leaf returns to its exact parent while keeping the clone
    await clickToolbarBack(page);
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: false,
        nextDisabled: true,
        count: "同级 2/2",
        backText: "←返回上一级",
        backLabel: "返回上一级",
      },
      "toolbar back from leaf to parent",
    );
    assertCloneSignature(
      await dockCloneSignature(page),
      { componentId: "", reviewNodeId: "video-grid-node", hasVideoCard: true },
      "clone after leaf back to parent",
    );

    // breadcrumb back to root
    const breadcrumb = await firstVisible(page, SELECTORS.breadcrumb);
    await breadcrumb.locator(SELECTORS.breadcrumbItems).nth(1).click();
    const rootCloneAfterBreadcrumb = await dockCloneSignature(page);
    assertCloneSignature(
      rootCloneAfterBreadcrumb,
      {
        componentId: rootClone.componentId,
        reviewNodeId: "",
        hasTechnique: true,
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "root clone after breadcrumb",
    );
    const rootCrumbsAfter = await breadcrumbState(page);
    assert(
      rootCrumbsAfter.items === rootCrumbs.items,
      `breadcrumb should be back at root (items ${rootCrumbsAfter.items} vs ${rootCrumbs.items})`,
    );
    assert(
      await dock.isVisible().catch(() => false),
      "dock should still be visible at root level",
    );
    // ACTUAL root cloned DOM: the dock's firstElementChild must carry the root
    // component id again after the nested breadcrumb navigation.
    const rootIdAfterBreadcrumb = await dockRootCloneId(page);
    assert(
      rootIdAfterBreadcrumb === rootClone.componentId,
      `dock root clone data-component-id should be restored after breadcrumb, got "${rootIdAfterBreadcrumb}"`,
    );

    // repeating the complex selection must replace the root clone again
    const rootGeometry = await dockGeometry(page);
    await (await firstVisible(page, SELECTORS.videoGrid)).click();
    const repeatedComplexClone = await dockCloneSignature(page);
    assertCloneSignature(
      repeatedComplexClone,
      { componentId: "", reviewNodeId: "video-grid-node", hasVideoCard: true },
      "repeated complex drilldown clone",
    );
    // the repeated complex click must actually re-mount a sized clone (dock
    // geometry changes), and must not accidentally close the dock
    const repeatedGeometry = await dockGeometry(page);
    assert(
      repeatedGeometry.width > 0 &&
        repeatedGeometry.height > 0 &&
        repeatedGeometry.visibleWidth > 0 &&
        repeatedGeometry.visibleHeight > 0,
      `dock should have positive visible dimensions after repeated complex click, got ${JSON.stringify(repeatedGeometry)}`,
    );
    assert(
      repeatedGeometry.width !== rootGeometry.width ||
        repeatedGeometry.height !== rootGeometry.height,
      `dock size should change after repeated complex click, root ${JSON.stringify(rootGeometry)} vs ${JSON.stringify(repeatedGeometry)}`,
    );
    assert(
      await dock.isVisible().catch(() => false),
      "dock must not accidentally close after repeated complex click",
    );

    // Escape must restore the actual root clone, not only breadcrumb/PRD state
    await page.keyboard.press("Escape");
    const rootCloneAfterEscape = await dockCloneSignature(page);
    assertCloneSignature(
      rootCloneAfterEscape,
      {
        componentId: rootClone.componentId,
        reviewNodeId: "",
        hasTechnique: true,
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "root clone after Escape",
    );
    const rootIdAfterEscape = await dockRootCloneId(page);
    assert(
      rootIdAfterEscape === rootClone.componentId,
      `dock root clone data-component-id should be restored after Escape, got "${rootIdAfterEscape}"`,
    );

    // Repeating the same root -> complex navigation must produce the same
    // positive, visible dock geometry, proving geometry is measured before the
    // source target is detached and replaced.
    await (await firstVisible(page, SELECTORS.videoGrid)).click();
    const repeatedComplexGeometryAfterEscape = await dockGeometry(page);
    assert(
      repeatedComplexGeometryAfterEscape.width > 0 &&
        repeatedComplexGeometryAfterEscape.height > 0 &&
        repeatedComplexGeometryAfterEscape.visibleWidth > 0 &&
        repeatedComplexGeometryAfterEscape.visibleHeight > 0,
      `dock should have positive visible dimensions after repeated complex root click, got ${JSON.stringify(repeatedComplexGeometryAfterEscape)}`,
    );
    assert(
      repeatedComplexGeometryAfterEscape.width === repeatedGeometry.width &&
        repeatedComplexGeometryAfterEscape.height === repeatedGeometry.height,
      `dock geometry should stay stable after repeated complex root click, first ${JSON.stringify(repeatedGeometry)} vs repeated ${JSON.stringify(repeatedComplexGeometryAfterEscape)}`,
    );

    // sibling navigation at the nested level: previous restores the actual
    // component-root clone and highlights the simple sibling inside it.
    await (await firstVisible(page, SELECTORS.leaf)).click();
    await clickToolbarBack(page);
    await clickSibling(page, -1);
    const chipsSiblingClone = await dockCloneSignature(page);
    assertCloneSignature(
      chipsSiblingClone,
      {
        componentId: rootClone.componentId,
        reviewNodeId: "",
        hasTechnique: true,
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "root clone after grid previous-sibling",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: true,
        nextDisabled: false,
        count: "同级 1/2",
      },
      "chips sibling toolbar after previous",
    );
    assert(
      await (
        await firstVisible(page, SELECTORS.technique)
      ).evaluate((el) => el.classList.contains("is-node-highlight")),
      "technique sibling should be highlighted in the restored root clone",
    );
    const siblingCrumbs = await breadcrumbState(page);
    assert(
      siblingCrumbs.text.includes("Top GMV video techniques"),
      `root component should remain selected after nested sibling switch, got "${siblingCrumbs.text}"`,
    );
    assert(
      await dock.isVisible().catch(() => false),
      "root clone should remain visible after nested sibling switch",
    );

    // forward sibling navigation rebuilds the complex containing view.
    await clickSibling(page, 1);
    assertCloneSignature(
      await dockCloneSignature(page),
      { componentId: "", reviewNodeId: "video-grid-node", hasVideoCard: true },
      "complex clone after chips next-sibling",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: false,
        nextDisabled: true,
        count: "同级 2/2",
      },
      "grid sibling toolbar after next",
    );

    // contextual back continues parent -> root -> overview.
    await clickToolbarBack(page);
    assertCloneSignature(
      await dockCloneSignature(page),
      {
        componentId: rootClone.componentId,
        reviewNodeId: "",
        hasTechnique: true,
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "root clone after nested toolbar back",
    );
    assertToolbarState(
      await toolbarState(page),
      {
        prevDisabled: false,
        nextDisabled: false,
        count: "同级 2/3",
        backText: "←返回总览",
        backLabel: "返回总览",
      },
      "root toolbar after nested back",
    );
    await clickToolbarBack(page);
    await waitForOverviewRestored(page, "after close click");

    // Escape has the same hierarchy semantics as the contextual back button.
    await (await firstVisible(page, SELECTORS.topGmvButton)).click();
    await firstVisible(page, SELECTORS.dock);
    await (await firstVisible(page, SELECTORS.technique)).click();
    await (await firstVisible(page, SELECTORS.videoGrid)).click();
    await (await firstVisible(page, SELECTORS.leaf)).click();
    await page.keyboard.press("Escape");
    assertToolbarState(
      await toolbarState(page),
      { count: "同级 2/2", backText: "←返回上一级" },
      "Escape parity from leaf to parent",
    );
    assertCloneSignature(
      await dockCloneSignature(page),
      { componentId: "", reviewNodeId: "video-grid-node", hasVideoCard: true },
      "clone after Escape leaf to parent",
    );
    await page.keyboard.press("Escape");
    assertToolbarState(
      await toolbarState(page),
      { count: "同级 2/3", backText: "←返回总览" },
      "Escape parity from parent to root",
    );
    assertCloneSignature(
      await dockCloneSignature(page),
      {
        componentId: rootClone.componentId,
        reviewNodeId: "",
        hasTechnique: true,
        hasVideoGrid: true,
        hasVideoCard: true,
      },
      "root clone after Escape parent to root",
    );
    await page.keyboard.press("Escape");
    await waitForOverviewRestored(page, "after Escape root to overview");

    // integrated feedback（HARD-GATE 14）：唯一数据源是本机评论服务。
    // 在线时写入必须落到服务磁盘、且不回落 localStorage；服务离线时评论不可写、
    // 离线横幅可见。这里不断言 localStorage 持久化——那正是第 14 条禁止的降级。
    const feedbackSlug = JSON.parse(
      await page.locator(SELECTORS.feedbackScript).textContent(),
    ).slug;
    const offlineBanner = page.locator(".feedback-offline-banner");
    assert(
      (await offlineBanner.count()) === 0,
      "offline banner must be hidden while the feedback service is running",
    );

    const toolsDetails = page.locator(".review-tools");
    if ((await toolsDetails.getAttribute("open")) === null) {
      await toolsDetails.locator("summary").click();
    }
    await clickIfVisible(page, SELECTORS.feedbackOpen);
    const entriesBefore = await readFeedbackEntries(page);
    const feedbackInput = await firstVisible(page, SELECTORS.suggestion);
    await feedbackInput.fill("e2e drilldown feedback");
    await (await firstVisible(page, SELECTORS.submit)).click();
    await page.waitForFunction(
      ({ selector, count }) => {
        const data = JSON.parse(
          document.querySelector(selector)?.textContent || "{}",
        );
        return (data.entries ?? []).length === count + 1;
      },
      { selector: SELECTORS.feedbackScript, count: entriesBefore.length },
      { timeout: 8000 },
    );
    const entriesAfter = await readFeedbackEntries(page);
    assert(
      entriesAfter.length === entriesBefore.length + 1,
      `feedback entries should grow by 1 (${entriesBefore.length} -> ${entriesAfter.length})`,
    );
    assert(
      entriesAfter.some((entry) =>
        JSON.stringify(entry).includes("e2e drilldown feedback"),
      ),
      "new feedback entry should contain submitted text",
    );
    const storedFeedback = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        /^david:.+:feedback$/.test(k),
      );
      return key ? localStorage.getItem(key) : null;
    });
    assert(
      storedFeedback === null,
      "feedback must NOT be persisted to localStorage (service is the only data source)",
    );
    // 服务端落盘才是持久化的判据：直接回读服务存储目录里的文件。
    const servedEntries = readServiceEntries(feedbackService, feedbackSlug);
    assert(
      servedEntries.some((entry) =>
        JSON.stringify(entry).includes("e2e drilldown feedback"),
      ),
      `submitted feedback should be persisted by the feedback service, got ${servedEntries.length} entries`,
    );
    await page.locator('button[aria-label="关闭反馈面板"]').first().click();

    // header plugin upload: david-plugin/v1 JSON, theme.accent, personalized
    const pluginPath = join(tmpdir(), `david-test-plugin-${process.pid}.json`);
    writeFileSync(
      pluginPath,
      JSON.stringify(
        {
          schema: "david-plugin/v1",
          schemaVersion: 1,
          id: "david-test-plugin",
          name: "David Test Plugin",
          version: "1.0.0",
          match: { slugs: [feedbackSlug] },
          theme: { accent: "#123456" },
        },
        null,
        2,
      ),
    );
    const pluginInput = page.locator(SELECTORS.pluginInput);
    assert(
      (await pluginInput.count()) > 0,
      "header plugin file input should exist",
    );
    await pluginInput.setInputFiles(pluginPath);
    const accentDeadline = Date.now() + 5_000;
    let accent = "";
    while (Date.now() < accentDeadline) {
      accent = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      );
      if (
        /123456/i.test(accent) ||
        /rgb\(\s*18\s*,\s*52\s*,\s*86\s*\)/i.test(accent)
      )
        break;
      await sleep(150);
    }
    assert(
      /123456/i.test(accent) ||
        /rgb\(\s*18\s*,\s*52\s*,\s*86\s*\)/i.test(accent),
      `--accent should be #123456, got "${accent}"`,
    );
    if ((await toolsDetails.getAttribute("open")) === null) {
      await toolsDetails.locator("summary").click();
    }
    await firstVisible(page, SELECTORS.personalized);

    // console/page errors fail the run
    assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);

    // reduced-motion context: repeat root + complex clicks without hanging
    await withTimeout(
      reducedMotionPass(browser, feedbackService.baseUrl),
      45_000,
      "reducedMotion pass",
    );

    // HARD-GATE 14 离线态：服务停掉后横幅可见、评论不可写、不回落 localStorage。
    await withTimeout(
      offlinePass(browser, feedbackService),
      45_000,
      "offline pass",
    );

    console.log("[test-david-drilldown] OK");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (feedbackService) {
      await feedbackService.stop().catch(() => {});
      feedbackService.cleanup();
    }
    await stopViteCli(child);
  }
}

main().catch((err) => {
  console.error("[test-david-drilldown] FAILED:", err);
  process.exit(1);
});
