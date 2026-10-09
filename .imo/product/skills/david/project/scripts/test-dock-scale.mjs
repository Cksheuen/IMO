import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = new URL(process.env.BASE_URL || "http://127.0.0.1:5196/").href;
// 钳制用例需要较矮视口：让 top-gmv-techniques（约 826px 高）超过可用高度，
// 触发 fitScale < MIN_DOCK_SCALE，走「可滚动视口」模型（见下方说明）。
const CLAMPED_VIEWPORT = { width: 1440, height: 500 };
const VIEWPORT = { width: 1440, height: 1100 };

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const pageErrors = [];

  const captureDockState = (page) =>
    page.evaluate(() => {
      const dock = document.querySelector(".component-dock");
      if (!dock) return null;
      const cs = getComputedStyle(dock);
      return {
        model: dock.dataset.dockModel,
        visible: dock.classList.contains("is-visible"),
        flipMorph: dock.classList.contains("flip-morph"),
        transform: dock.style.transform,
        overflow: cs.overflow,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        hasWrapper:
          dock.firstElementChild?.classList.contains(
            "component-dock-scroll-content",
          ) === true,
        baseWidth: Number(dock.dataset.baseWidth) || null,
        baseHeight: Number(dock.dataset.baseHeight) || null,
        scrollWidth: dock.scrollWidth,
        scrollHeight: dock.scrollHeight,
      };
    });

  try {
    // ---- 用例 1/2/4：钳制（可滚动视口）模型 ----------------------------------
    // 默认 sample（video-conversion-shooting-guide，.app-phone 手机壳）最宽组件
    // 仅 ~390px，且当前 dockMetricsFor 把 maxWidth 额外钳到 rect.width，
    // 因此「宽度触发钳制」在该页无法构造；改用矮视口触发「高度钳制」。
    // 两条路径走的是同一条 settleDockPose 钳制分支（wrapper + overflow:auto
    // + viewport 模型 + 滚动范围按 rect * scale 计算），断言目标完全一致。
    const clampedContext = await browser.newContext({
      viewport: CLAMPED_VIEWPORT,
    });
    const page = await clampedContext.newPage();
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto(BASE_URL);
    await page.locator(".david-overview-surface").waitFor();
    await page.getByTestId("overview-component-top-gmv-techniques").click();
    await page.waitForTimeout(800);

    let state = await captureDockState(page);
    assert.ok(state, "dock must be rendered");
    assert.equal(
      state.model,
      "viewport",
      "wide/tall dock must switch to the scrollable viewport model on clamp",
    );
    assert.equal(
      state.hasWrapper,
      true,
      "clamped dock must wrap content in .component-dock-scroll-content",
    );
    assert.equal(
      state.overflow,
      "auto",
      `clamped dock computed overflow must be auto, got ${state.overflow}`,
    );
    assert.equal(
      state.overflowX,
      "auto",
      `clamped dock overflow-x must be auto, got ${state.overflowX}`,
    );
    assert.equal(
      state.overflowY,
      "auto",
      `clamped dock overflow-y must be auto, got ${state.overflowY}`,
    );
    assert.equal(
      state.transform,
      "none",
      "clamped dock must not keep the FLIP transform",
    );

    // 用例 2：滚动范围按缩放后占位尺寸（rect * scale）计算，而不是自然尺寸。
    // transform: scale() 不改变布局占位盒，若没有 wrapper 把内容裁到 rect*scale，
    // 这里 scrollWidth 会等于自然宽度(390) 而非 rect*0.62。
    const dockScale = await page.evaluate(() => {
      const dock = document.querySelector(".component-dock");
      const rectWidth = Number(dock.dataset.baseWidth);
      const rectHeight = Number(dock.dataset.baseHeight);
      // 镜像 src/components/review-canvas/ReviewCanvas.tsx dockMetricsFor 的公式，常量读自同一文件：
      // DOCK_WIDTH=340, DOCK_WIDTH_AVAILABLE_RATIO=0.52, DOCK_WIDTH_MAX=560,
      // DOCK_TOP=22, DOCK_RIGHT=22, MIN_DOCK_SCALE=0.62。
      const DOCK_WIDTH = 340;
      const DOCK_WIDTH_AVAILABLE_RATIO = 0.52;
      const DOCK_WIDTH_MAX = 560;
      const DOCK_TOP = 22;
      const DOCK_RIGHT = 22;
      const MIN_DOCK_SCALE = 0.62;
      const rail = document.querySelector(".comment-rail");
      let rightInset = DOCK_RIGHT;
      if (rail && getComputedStyle(rail).position === "fixed") {
        const rect = rail.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rightInset = Math.max(DOCK_RIGHT, window.innerWidth - rect.left + 12);
        }
      }
      const available = Math.max(
        1,
        window.innerWidth - rightInset - DOCK_RIGHT,
      );
      const preferredWidth = Math.min(
        DOCK_WIDTH_MAX,
        Math.max(DOCK_WIDTH, available * DOCK_WIDTH_AVAILABLE_RATIO),
      );
      const maxWidth = Math.min(
        preferredWidth,
        available,
        Math.max(rectWidth, 1),
      );
      const maxHeight = Math.max(1, window.innerHeight - DOCK_TOP * 2);
      const fitScale = Math.min(
        1,
        maxWidth / rectWidth,
        maxHeight / rectHeight,
      );
      const scale = Math.max(MIN_DOCK_SCALE, fitScale);
      return {
        rectWidth,
        rectHeight,
        fitScale: Math.round(fitScale * 1000) / 1000,
        scale: Math.round(scale * 1000) / 1000,
        expectedScrollWidth: Math.round(rectWidth * scale),
        expectedScrollHeight: Math.round(rectHeight * scale),
      };
    });
    assert.ok(
      dockScale.fitScale < 0.62,
      `clamped case must start from fitScale < MIN_DOCK_SCALE, got ${dockScale.fitScale}`,
    );
    assert.equal(
      dockScale.scale,
      0.62,
      "clamped scale must be pinned to MIN_DOCK_SCALE",
    );

    state = await captureDockState(page);
    assert.ok(
      Math.abs(state.scrollWidth - dockScale.expectedScrollWidth) <= 2,
      `dock.scrollWidth ${state.scrollWidth} must be ~ rect.width(${dockScale.rectWidth}) * scale(${dockScale.scale}) = ${dockScale.expectedScrollWidth}`,
    );
    assert.ok(
      state.scrollWidth > 0,
      `scrollWidth must be defined, got ${state.scrollWidth}`,
    );
    assert.ok(
      Math.abs(state.scrollHeight - dockScale.expectedScrollHeight) <= 2,
      `dock.scrollHeight ${state.scrollHeight} must be ~ rect.height(${dockScale.rectHeight}) * scale(${dockScale.scale}) = ${dockScale.expectedScrollHeight}`,
    );

    // 用例 4：返回总览后清理 data 属性与非残留 wrapper。
    await page
      .getByTestId("david-breadcrumb")
      .getByRole("button", { name: "总览", exact: true })
      .click();
    await page.waitForTimeout(800);

    const cleared = await page.evaluate(() => {
      const dock = document.querySelector(".component-dock");
      return {
        modelUndefined: dock.dataset.dockModel === undefined,
        hasWrapper:
          dock.firstElementChild?.classList.contains(
            "component-dock-scroll-content",
          ) === true,
        visible: dock.classList.contains("is-visible"),
      };
    });
    assert.equal(
      cleared.modelUndefined,
      true,
      "dockModel must be deleted after returning to overview",
    );
    assert.equal(
      cleared.hasWrapper,
      false,
      "scroll wrapper must be removed after returning to overview",
    );
    assert.equal(
      cleared.visible,
      false,
      "dock must hide after returning to overview",
    );
    await clampedContext.close();

    // ---- 用例 3：窄组件不受影响（无回归） ------------------------------------
    const narrowContext = await browser.newContext({ viewport: VIEWPORT });
    const narrowPage = await narrowContext.newPage();
    narrowPage.on("pageerror", (error) => pageErrors.push(error));

    await narrowPage.goto(BASE_URL);
    await narrowPage.locator(".david-overview-surface").waitFor();
    await narrowPage.getByTestId("overview-component-what-to-feature").click();
    await narrowPage.waitForTimeout(800);

    const narrow = await captureDockState(narrowPage);
    assert.ok(narrow, "narrow dock must be rendered");
    assert.equal(
      narrow.model,
      "transform",
      "un-clamped dock must keep the transform FLIP model",
    );
    assert.equal(
      narrow.hasWrapper,
      false,
      "un-clamped dock must not wrap content in a scroll layer",
    );
    assert.ok(
      narrow.transform.includes("scale("),
      `un-clamped dock transform must contain scale(...), got ${narrow.transform}`,
    );
    assert.equal(
      narrow.overflow,
      "visible",
      `un-clamped dock overflow must stay visible, got ${narrow.overflow}`,
    );
    await narrowContext.close();

    assert.equal(
      pageErrors.length,
      0,
      `expected no page errors, got: ${pageErrors.map((e) => e.message).join("; ")}`,
    );
    console.log("dock scale OK");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
