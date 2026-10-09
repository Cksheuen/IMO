#!/usr/bin/env node
/**
 * 测试锚点跟随绑定元素移动
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

  console.log("=== 步骤 1: 打开页面并设置测试数据 ===");
  await page.goto(BASE_URL);
  await page.waitForTimeout(2000);

  // 设置测试数据
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
    localStorage.setItem(
      "tech-review:latam-video-conversion-shooting-guide:regions",
      JSON.stringify(testRegions),
    );
  });

  // 刷新页面
  await page.reload();
  await page.waitForTimeout(2000);

  console.log("\n=== 步骤 2: 检查绑定元素和锚点位置 ===");
  const initialPositions = await page.evaluate(() => {
    const targetEl = document.querySelector(
      '[data-review-target="what-to-feature"]',
    );
    const anchors = document.querySelectorAll(".comment-anchor");

    return {
      targetExists: !!targetEl,
      targetRect: targetEl?.getBoundingClientRect(),
      anchors: Array.from(anchors).map((a) => ({
        id: a.getAttribute("data-region-id"),
        rect: a.getBoundingClientRect(),
        style: {
          transform: a.style.transform,
          positioned: a.dataset.positioned,
        },
      })),
    };
  });
  console.log("初始位置:", JSON.stringify(initialPositions, null, 2));

  console.log("\n=== 步骤 3: 滚动页面并检查锚点位置 ===");
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);

  const afterScroll = await page.evaluate(() => {
    const targetEl = document.querySelector(
      '[data-review-target="what-to-feature"]',
    );
    const anchors = document.querySelectorAll(".comment-anchor");

    return {
      targetRect: targetEl?.getBoundingClientRect(),
      anchors: Array.from(anchors).map((a) => ({
        id: a.getAttribute("data-region-id"),
        rect: a.getBoundingClientRect(),
        style: {
          transform: a.style.transform,
          positioned: a.dataset.positioned,
        },
      })),
    };
  });
  console.log("滚动后位置:", JSON.stringify(afterScroll, null, 2));

  console.log("\n=== 步骤 4: 测试视口检测 ===");
  // 滚动到页面底部，使绑定元素不在视口中
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  const viewportTest = await page.evaluate(() => {
    const targetEl = document.querySelector(
      '[data-review-target="what-to-feature"]',
    );
    const anchors = document.querySelectorAll(".comment-anchor");

    return {
      targetRect: targetEl?.getBoundingClientRect(),
      anchorCount: anchors.length,
      anchors: Array.from(anchors).map((a) => ({
        id: a.getAttribute("data-region-id"),
        visible: a.offsetParent !== null,
        rect: a.getBoundingClientRect(),
      })),
    };
  });
  console.log("视口检测:", JSON.stringify(viewportTest, null, 2));

  console.log("\n=== 步骤 5: 测试重叠处理 ===");
  // 滚动回顶部
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // 检查两个锚点是否重叠
  const overlapTest = await page.evaluate(() => {
    const anchors = document.querySelectorAll(".comment-anchor");
    const anchorRects = Array.from(anchors).map((a) =>
      a.getBoundingClientRect(),
    );

    // 检查是否重叠
    let hasOverlap = false;
    for (let i = 0; i < anchorRects.length; i++) {
      for (let j = i + 1; j < anchorRects.length; j++) {
        const a = anchorRects[i];
        const b = anchorRects[j];
        const dx = Math.abs(a.left - b.left);
        const dy = Math.abs(a.top - b.top);
        if (dx < 28 && dy < 28) {
          hasOverlap = true;
          break;
        }
      }
    }

    return {
      anchorCount: anchors.length,
      hasOverlap,
      anchors: Array.from(anchors).map((a) => ({
        id: a.getAttribute("data-region-id"),
        rect: a.getBoundingClientRect(),
      })),
    };
  });
  console.log("重叠检测:", JSON.stringify(overlapTest, null, 2));

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
