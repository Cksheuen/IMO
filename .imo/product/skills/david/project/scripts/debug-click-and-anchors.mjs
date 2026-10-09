#!/usr/bin/env node
/**
 * 调试脚本：测试点击事件和评论锚点位置
 *
 * 使用方法：
 * 1. 先启动 dev server: npm run dev
 * 2. 运行此脚本: node scripts/debug-click-and-anchors.mjs
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  if (process.env.PLAYWRIGHT_PATH) {
    try {
      ({ chromium } = require(process.env.PLAYWRIGHT_PATH));
    } catch {
      // ignore optional path failure
    }
  }
  if (!chromium) {
    console.log(
      "Playwright is not installed. Set PLAYWRIGHT_PATH or install playwright.",
    );
    process.exit(0);
  }
}

const BASE_URL = "http://localhost:5173";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  // 收集 console 日志
  const consoleLogs = [];
  page.on("console", (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    console.log("[Browser Console]", text);
  });

  console.log("=== 步骤 1: 打开页面 ===");
  await page.goto(BASE_URL);
  await page.waitForTimeout(2000);

  console.log("\n=== 步骤 2: 检查页面结构 ===");
  const pageInfo = await page.evaluate(() => {
    const frame = document.querySelector(".page-frame");
    const components = document.querySelectorAll("[data-component-id]");
    const reviewTargets = document.querySelectorAll("[data-review-target]");

    // 检查 page-frame 的子元素结构
    const frameChildren = frame
      ? Array.from(frame.children).map((c) => ({
          tagName: c.tagName,
          className: c.className,
          id: c.id,
          childCount: c.children.length,
        }))
      : [];

    // 检查是否有元素覆盖在 page-frame 上
    const frameRect = frame?.getBoundingClientRect();
    const centerX = frameRect ? frameRect.left + frameRect.width / 2 : 0;
    const centerY = frameRect ? frameRect.top + frameRect.height / 2 : 0;
    const elementAtCenter = document.elementFromPoint(centerX, centerY);

    return {
      hasFrame: !!frame,
      frameRect: frameRect,
      frameChildren,
      elementAtCenter: elementAtCenter
        ? {
            tagName: elementAtCenter.tagName,
            className: elementAtCenter.className,
            id: elementAtCenter.id,
            isInFrame: frame?.contains(elementAtCenter),
          }
        : null,
      componentCount: components.length,
      reviewTargetCount: reviewTargets.length,
      firstComponent: components[0]
        ? {
            id: components[0].getAttribute("data-component-id"),
            rect: components[0].getBoundingClientRect(),
            visible: components[0].offsetParent !== null,
          }
        : null,
    };
  });
  console.log("页面信息:", JSON.stringify(pageInfo, null, 2));

  console.log("\n=== 步骤 3: 测试点击事件 ===");
  // 找到第一个组件并点击
  const firstComponent = await page.$("[data-component-id]");
  if (firstComponent) {
    const box = await firstComponent.boundingBox();
    console.log("第一个组件位置:", box);

    // 点击组件中心
    if (box) {
      const clickX = box.x + box.width / 2;
      const clickY = box.y + box.height / 2;

      // 检查点击位置上的元素
      const elementAtPoint = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return {
            tagName: el?.tagName,
            className: el?.className,
            id: el?.id,
            dataComponentId: el?.getAttribute("data-component-id"),
            dataReviewTarget: el?.getAttribute("data-review-target"),
            pointerEvents: el ? getComputedStyle(el).pointerEvents : null,
            parentChain: (() => {
              const chain = [];
              let current = el;
              while (current && chain.length < 5) {
                chain.push({
                  tagName: current.tagName,
                  className: current.className,
                  id: current.id,
                });
                current = current.parentElement;
              }
              return chain;
            })(),
          };
        },
        { x: clickX, y: clickY },
      );
      console.log("点击位置上的元素:", JSON.stringify(elementAtPoint, null, 2));

      // 检查 page-frame 的 pointer-events
      const framePointerEvents = await page.evaluate(() => {
        const frame = document.querySelector(".page-frame");
        return frame ? getComputedStyle(frame).pointerEvents : null;
      });
      console.log("page-frame pointer-events:", framePointerEvents);

      // 点击组件中心
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(1000);

      console.log("点击后的 console 日志数量:", consoleLogs.length);

      // 检查是否进入了 inspector
      const phase = await page.evaluate(() => {
        const frame = document.querySelector(".page-frame");
        return {
          hasInspectorOpen: frame?.classList.contains("is-inspector-open"),
          phase: window.location.hash,
        };
      });
      console.log("点击后状态:", phase);
    }
  } else {
    console.log("未找到组件元素");
  }

  console.log("\n=== 步骤 4: 测试划选功能 ===");
  // 先回到页面状态
  await page.evaluate(() => {
    // 重置状态
    window.location.hash = "";
  });
  await page.waitForTimeout(500);

  // 模拟划选
  const frame = await page.$(".page-frame");
  if (frame) {
    const box = await frame.boundingBox();
    if (box) {
      console.log("开始划选...");
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 300, box.y + 200, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(1000);

      console.log("划选后的 console 日志:");
      consoleLogs.slice(-10).forEach((log) => console.log("  ", log));
    }
  }

  console.log("\n=== 步骤 5: 检查评论锚点 ===");
  // 先添加一些测试区域评论数据
  await page.evaluate(() => {
    const testRegions = {
      "test-region-1": {
        id: "test-region-1",
        rect: { nx: 0.5, ny: 0.3, nw: 0.2, nh: 0.1 },
        targets: ["what-to-feature"],
        label: "测试区域 1",
        records: [{ body: "测试评论 1", at: new Date().toISOString() }],
      },
      "test-region-2": {
        id: "test-region-2",
        rect: { nx: 0.5, ny: 0.5, nw: 0.2, nh: 0.1 },
        targets: ["what-to-feature"],
        label: "测试区域 2",
        records: [{ body: "测试评论 2", at: new Date().toISOString() }],
      },
    };
    // 使用正确的键：tech-review:${slug}:regions
    localStorage.setItem(
      "tech-review:dev:regions",
      JSON.stringify(testRegions),
    );
  });

  // 刷新页面以加载测试数据
  await page.reload();
  await page.waitForTimeout(2000);

  const anchorsInfo = await page.evaluate(() => {
    const anchors = document.querySelectorAll(".comment-anchor");
    const anchorData = Array.from(anchors).map((a) => ({
      id: a.getAttribute("data-region-id"),
      rect: a.getBoundingClientRect(),
      visible: a.offsetParent !== null,
      style: {
        left: a.style.left,
        top: a.style.top,
      },
    }));

    // 检查绑定元素
    const regions = JSON.parse(
      localStorage.getItem("tech-review:regions") || "{}",
    );
    const regionData = Object.values(regions).map((r) => ({
      id: r.id,
      targets: r.targets,
      rect: r.rect,
    }));

    // 检查绑定元素的位置
    const targetElements = Object.values(regions)
      .flatMap((r) =>
        r.targets.map((targetId) => {
          const el = document.querySelector(
            `[data-review-target="${targetId}"]`,
          );
          return el
            ? {
                targetId,
                rect: el.getBoundingClientRect(),
                visible: el.offsetParent !== null,
              }
            : null;
        }),
      )
      .filter(Boolean);

    return {
      anchorCount: anchors.length,
      anchors: anchorData,
      regions: regionData,
      targetElements,
    };
  });
  console.log("锚点信息:", JSON.stringify(anchorsInfo, null, 2));

  console.log("\n=== 步骤 6: 测试滚动时锚点位置 ===");
  // 滚动页面
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);

  const anchorsAfterScroll = await page.evaluate(() => {
    const anchors = document.querySelectorAll(".comment-anchor");
    return Array.from(anchors).map((a) => ({
      id: a.getAttribute("data-region-id"),
      rect: a.getBoundingClientRect(),
    }));
  });
  console.log("滚动后锚点位置:", JSON.stringify(anchorsAfterScroll, null, 2));

  console.log("\n=== 调试完成 ===");
  console.log("总共收集到", consoleLogs.length, "条 console 日志");

  // 保持浏览器打开 5 秒以便观察
  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch((err) => {
  console.error("调试脚本执行失败:", err);
  process.exit(1);
});
