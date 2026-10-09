#!/usr/bin/env node
// E2E smoke for pages/page-transitions runtime wiring (HARD-GATE 29).
// Boots `npx vite` on a kernel-assigned free loopback port (--port 0 with
// strictPort; the real URL is parsed from vite's stdout), imports a multi-page
// + canvas fixture through the file input, and asserts:
//   - 左侧叠层页: .page-stack renders N cards; active/visited/adjacent classes
//   - 键盘翻页: ArrowRight/ArrowLeft flip pages, no wrap at boundaries
//   - canvas 页逻辑节点 hover 浮层与深层入口: popover appears on hover;
//     click opens dock with .is-canvas-view (等比放大深层画板)
//   - Escape 沿 history 栈回退一层并回到 page 相位
//   - 向后兼容: 无 pages 的单页 sample 不渲染叠层页、翻页 no-op
//
// 离线态隔离（不依赖开发机 5180 恰好空闲）：启动 vite 时经
// VITE_DAVID_FEEDBACK_BASE_URL 把评论服务指向本测试独占、且已先断言
// ECONNREFUSED 的高位端口；用户机器上常驻的正式 5180 服务不受任何影响。
import { Buffer } from "node:buffer";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import {
  HOST,
  assertPortUnused,
  freePort,
  startViteCli,
  stopViteCli,
  waitForServer,
} from "./browser-test-server.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
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

/** 多页 + canvas 交互 fixture（parseReviewSpec 合法；锚点与页面 HTML 一一对应）。 */
function loadPagesReviewFixture(serviceBaseUrl) {
  const pageHtml = (body) => `<main style="padding:24px">${body}</main>`;
  const nodeBox = (id, label, hint = "", children = "") =>
    `<div data-review-node-id="${id}" style="margin:10px 0;padding:10px;border:1px solid #999;border-radius:8px">
      <strong>${label}</strong>${hint ? ` · ${hint}` : ""}
      ${children}
    </div>`;
  // canvas 逻辑图块：孙节点嵌套在面板内（深层画板可逐层下钻）。
  const canvasBlock = nodeBox(
    "canvas-node-a",
    "画板主节点",
    "复杂节点，进入深层画板",
    nodeBox(
      "canvas-node-b",
      "画板子节点",
      "",
      nodeBox("canvas-node-leaf", "画板叶子"),
    ),
  );
  const componentRoot = (extra = "") =>
    `<section data-component-id="comp-a" style="border:1px solid #ddd;border-radius:12px;padding:16px;margin-top:16px">
      <h3>流量链路</h3>
      ${nodeBox("logical-node-a", "逻辑节点一", "普通逻辑点")}
      ${extra}
    </section>`;

  return {
    name: "pages-interaction.review.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        slug: "pages-interaction",
        title: "多页交互夹具",
        subtitle: "pages + canvas 运行时接线验证",
        // 评论服务指向本测试独占的离线端口，导入后也保持确定性离线态
        // （不回退默认 5180、不依赖开发机外部端口状态）。
        service: { baseUrl: serviceBaseUrl },
        pages: [
          {
            id: "landing",
            label: "落地页",
            kind: "screen",
            pageHtml: pageHtml(
              `<p>第一页：普通屏幕。</p><button data-review-interaction-source="open-modal">打开弹窗</button><div data-review-overlay-backdrop>遮罩</div><div data-review-element-id="landing-modal" data-review-overlay-id="landing-modal"><strong>弹窗内容</strong><button data-review-interaction-source="close-modal">关闭</button></div>${componentRoot()}`,
            ),
            interactions: [
              {
                source: "open-modal",
                trigger: "click",
                action: "show",
                targetElementId: "landing-modal",
              },
              {
                source: "close-modal",
                trigger: "click",
                action: "close",
              },
            ],
          },
          {
            id: "flow",
            label: "画板",
            kind: "canvas",
            pageHtml: pageHtml(
              `<p>第二页：逻辑图画板。</p>${componentRoot(canvasBlock)}`,
            ),
          },
          {
            id: "result",
            label: "结论",
            kind: "screen",
            pageHtml: pageHtml(`<p>第三页：结论沉淀。</p>${componentRoot()}`),
          },
        ],
        components: [
          {
            id: "comp-a",
            label: "流量链路",
            kind: "ui",
            kindLabel: "主预览",
            mapping: [
              {
                id: "m1",
                requirement: "首屏展示三条卖点。",
                change: "仅渲染前三条，移除展开态。",
                api: { summary: "无接口改动。" },
              },
              {
                id: "m2",
                requirement: "逻辑图可下钻。",
                change: "画板节点进入深层画板。",
                api: { summary: "无接口改动。" },
              },
            ],
            children: [
              {
                id: "logical-node-a",
                label: "逻辑节点一",
                target: "logical-node-a",
                mappingIds: ["m1"],
              },
              {
                id: "canvas-node-a",
                label: "画板主节点",
                target: "canvas-node-a",
                canvas: true,
                mappingIds: ["m2"],
                children: [
                  {
                    id: "canvas-node-b",
                    label: "画板子节点",
                    target: "canvas-node-b",
                    canvas: true,
                    mappingIds: ["m2"],
                    children: [
                      {
                        id: "canvas-node-leaf",
                        label: "画板叶子",
                        target: "canvas-node-leaf",
                        interaction: "highlight",
                        mappingIds: ["m2"],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "utf8",
    ),
  };
}

async function importPagesReviewFixture(page, serviceBaseUrl) {
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles(loadPagesReviewFixture(serviceBaseUrl));
  await page
    .locator("h1.title")
    .filter({ hasText: "多页交互夹具" })
    .waitFor({ state: "visible" });
}

async function activeStackPage(page) {
  const active = page.locator(".page-stack-item.is-active");
  return {
    count: await page.locator(".page-stack-item").count(),
    label: ((await active.locator(".page-stack-label").textContent()) || "")
      .replace(/\s+/g, " ")
      .trim(),
    hasBadge: (await active.locator(".page-stack-badge").count()) > 0,
    visitedLabels: await page
      .locator(".page-stack-item.is-visited .page-stack-label")
      .allTextContents(),
  };
}

async function run() {
  // ── 确定性离线端口：本测试独占、无监听、已验证连接拒绝 ──
  // 绝不复用默认 5180——用户机器上可能常驻正式 serve-feedback.mjs；
  // 也绝不杀任何外部进程。
  const offlineFeedbackPort = await freePort();
  await assertPortUnused(offlineFeedbackPort);
  const offlineFeedbackBaseUrl = `http://${HOST}:${offlineFeedbackPort}`;

  const { child, baseUrl: BASE_URL } = await startViteCli(PROJECT_ROOT, {
    extraEnv: {
      VITE_DAVID_FEEDBACK_BASE_URL: offlineFeedbackBaseUrl,
    },
  });
  let browser;
  try {
    await waitForServer(child, BASE_URL);
    browser = await launchChromium();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    const page = await context.newPage();
    const errors = [];
    const escapedOfflineOrigin = offlineFeedbackBaseUrl.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const expectedOfflineOrigin = new RegExp(`^${escapedOfflineOrigin}`);
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text() || "";
      const url = msg.location()?.url || "";
      // 只豁免**本测试独占的 loopback 评论服务端口**的探测失败（预期离线降级，
      // 由离线横幅兜底）；5180 或其他任何资源/运行时错误一律保留并计入失败。
      if (
        expectedOfflineOrigin.test(url) &&
        /ERR_CONNECTION_REFUSED/.test(text)
      ) {
        return;
      }
      errors.push(`console.error: ${text} ${url ? `@ ${url}` : ""}`);
    });
    page.on("pageerror", (err) =>
      errors.push(`pageerror: ${err?.stack || String(err)}`),
    );

    await page.goto(BASE_URL);
    await page.locator(".david-overview-surface").waitFor();

    // ── 向后兼容：单页 sample 不渲染叠层页、箭头 no-op ──
    assert(
      (await page.locator(".page-stack-item").count()) === 0,
      "single-page sample must not render page-stack",
    );
    assert(
      (await page.locator(".page-tabs").count()) === 0,
      "legacy .page-tabs must not render (replaced by .page-stack)",
    );
    await page.keyboard.press("ArrowRight");
    await sleep(120);
    assert(
      (await page.locator(".page-stack-item").count()) === 0,
      "ArrowRight on single-page sample must be a no-op",
    );

    // ── 离线降级（HARD-GATE 14）：评论服务不可达时横幅可见、写入不可落盘 ──
    // 横幅必须点名本测试独占的离线端口——证明页面走的是 VITE 覆盖地址，
    // 而不是默认 5180（那台机器上此刻正被正式服务占用）。
    const offlineBanner = page.locator(".feedback-offline-banner", {
      hasText: offlineFeedbackBaseUrl,
    });
    await offlineBanner.waitFor({ state: "visible", timeout: 10_000 });
    // 稳定性：离线态是终态而非探活过程中的瞬态，短暂等待后必须仍然成立。
    await sleep(500);
    assert(
      (await offlineBanner.count()) === 1 && (await offlineBanner.isVisible()),
      `offline banner naming ${offlineFeedbackBaseUrl} should stay visible when comments service is down`,
    );
    const entriesAttr = async () =>
      Number(
        await page
          .locator("script#david-agent-feedback")
          .getAttribute("data-entries"),
      );
    const tools = page.locator(".review-tools");
    if ((await tools.getAttribute("open")) === null) {
      await tools.locator("summary").click();
    }
    await page.getByTestId("david-feedback-open").click();
    await page.getByTestId("feedback-suggestion").fill("offline write probe");
    await page.getByTestId("feedback-submit").click();
    await sleep(300);
    assert(
      (await entriesAttr()) === 0,
      "offline feedback submit must not persist any entries (localStorage/service), got " +
        (await entriesAttr()),
    );
    await page.locator('button[aria-label="关闭反馈面板"]').first().click();

    // ── 导入多页 fixture：叠层页出现，p1 激活 ──
    await importPagesReviewFixture(page, offlineFeedbackBaseUrl);
    await page.locator(".page-stack").waitFor({ state: "visible" });
    let state = await activeStackPage(page);
    assert(
      state.count === 3,
      `page-stack should show 3 cards, got ${state.count}`,
    );
    assert(state.label === "落地页", `p1 active, got "${state.label}"`);

    // 声明式 overlay：打开后既可 Escape 回退，也可点击 close 触点关闭。
    const modal = page.locator('[data-review-element-id="landing-modal"]');
    await page.locator('[data-review-interaction-source="open-modal"]').click();
    await modal.waitFor({ state: "attached" });
    assert(
      await modal.evaluate((element) =>
        element.classList.contains("is-overlay-show"),
      ),
      "声明式 show 应打开目标 overlay",
    );
    await page.keyboard.press("Escape");
    assert(
      !(await modal.evaluate((element) =>
        element.classList.contains("is-overlay-show"),
      )),
      "Escape 应关闭当前 overlay",
    );
    await page.locator('[data-review-interaction-source="open-modal"]').click();
    await page
      .locator('[data-review-interaction-source="close-modal"]')
      .click();
    assert(
      !(await modal.evaluate((element) =>
        element.classList.contains("is-overlay-show"),
      )),
      "显式 close interaction 应关闭当前 overlay",
    );
    await page.locator('[data-review-interaction-source="open-modal"]').click();
    await page.locator("[data-review-overlay-backdrop]").click();
    assert(
      !(await modal.evaluate((element) =>
        element.classList.contains("is-overlay-show"),
      )),
      "点击 overlay backdrop 应关闭当前 overlay",
    );

    // ── 键盘翻页 + 边界无 wrap ──
    await page.keyboard.press("ArrowRight");
    await sleep(150);
    state = await activeStackPage(page);
    assert(
      state.label === "画板",
      `ArrowRight → p2 active, got "${state.label}"`,
    );
    await page.keyboard.press("ArrowLeft");
    await sleep(150);
    state = await activeStackPage(page);
    assert(
      state.label === "落地页",
      `ArrowLeft → p1 active, got "${state.label}"`,
    );
    await page.keyboard.press("ArrowLeft"); // 边界：首页 no-op
    await sleep(150);
    state = await activeStackPage(page);
    assert(
      state.label === "落地页",
      `ArrowLeft boundary → stays p1, got "${state.label}"`,
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await sleep(200);
    state = await activeStackPage(page);
    assert(
      state.label === "结论",
      `two×ArrowRight → p3 active, got "${state.label}"`,
    );
    assert(
      state.visitedLabels.length >= 1,
      "previous pages should be marked visited",
    );
    await page.keyboard.press("ArrowRight"); // 边界：末页 no-op
    await sleep(150);
    state = await activeStackPage(page);
    assert(
      state.label === "结论",
      `ArrowRight boundary → stays p3, got "${state.label}"`,
    );

    // ── 回到画板页：canvas 页逻辑节点 hover 浮层 ──
    await page.keyboard.press("ArrowLeft");
    await sleep(150);
    state = await activeStackPage(page);
    assert(
      state.label === "画板",
      `ArrowLeft → back to p2, got "${state.label}"`,
    );

    const nodeAnchor = '[data-review-node-id="canvas-node-a"]';
    // 外层逻辑节点盒内含嵌套子节点，偏移到盒体左上角定位自身（避开子块）。
    const topBand = { position: { x: 8, y: 8 } };
    await page.locator(nodeAnchor).hover(topBand);
    const popover = page.locator(".canvas-node-popover");
    await popover.waitFor({ state: "visible", timeout: 4_000 });
    const popoverText = ((await popover.textContent()) || "")
      .replace(/\s+/g, " ")
      .trim();
    assert(
      popoverText.includes("画板主节点"),
      `hover overlay should show node label, got "${popoverText}"`,
    );
    assert(
      popoverText.includes("深层画板"),
      `hover overlay should hint deep board, got "${popoverText}"`,
    );

    // 叶子逻辑节点 hover：普通 highlight 提示
    await page.locator('[data-review-node-id="canvas-node-leaf"]').hover();
    await popover.waitFor({ state: "visible", timeout: 4_000 });
    const leafText = ((await popover.textContent()) || "")
      .replace(/\s+/g, " ")
      .trim();
    assert(
      leafText.includes("画板叶子") && leafText.includes("高亮预览"),
      `leaf hover should hint highlight, got "${leafText}"`,
    );

    // ── 深层入口：点击进入等比放大深层画板 ──
    await page.locator(nodeAnchor).click(topBand);
    await page
      .locator(".component-dock.is-visible")
      .waitFor({ state: "visible", timeout: 6_000 });
    await page
      .locator(".component-dock.is-canvas-view")
      .waitFor({ state: "attached", timeout: 6_000 });
    assert(
      (await page.locator(".component-dock.is-canvas-view").count()) > 0,
      "canvas deep-board requires .is-canvas-view on dock",
    );
    const cloneHasNode = await page.locator(
      '.component-dock [data-review-node-id="canvas-node-a"]',
    );
    await cloneHasNode.waitFor({ state: "attached", timeout: 4_000 });

    // ── Escape 沿 history 栈回退一层并回到 page 相位 ──
    await page.keyboard.press("Escape");
    await page
      .locator(".david-overview-surface.is-active")
      .waitFor({ state: "visible", timeout: 6_000 });
    const dockVisibleAfter = await page
      .locator(".component-dock.is-visible")
      .count();
    assert(
      dockVisibleAfter === 0,
      `Escape should restore page phase (dock hidden), got ${dockVisibleAfter}`,
    );

    // ── 释放后再翻页正常（状态机未被 stale detail 卡死）──
    await page.keyboard.press("ArrowRight");
    await sleep(150);
    state = await activeStackPage(page);
    assert(
      state.label === "结论",
      `page flip works after Escape, got "${state.label}"`,
    );

    assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
    console.log("[test-pages-runtime] OK");
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopViteCli(child);
  }
}

run().catch((err) => {
  console.error("[test-pages-runtime] FAILED:", err);
  process.exit(1);
});
