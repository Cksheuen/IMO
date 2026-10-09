import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const htmlPath =
  process.argv[2] ||
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../tech_docs/video_conversion_skill_test/video-conversion-breakdown.review.html",
  );

async function runSmokeTest() {
  if (!chromium) return;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  console.log("1. 打开生成的 HTML 评审页:", htmlPath);
  await page.goto(`file://${htmlPath}`);
  await page.waitForSelector(".page-frame");

  console.log("2. 验证初始页面结构");
  const title = await page.locator(".app-header h1").innerText();
  console.log("   - 标题:", title);
  if (!title.includes("LATAM 视频转化提升") && !title.includes("方案评审")) {
    throw new Error("标题不匹配");
  }

  console.log("3. 点击 video-techniques 组件进行 FLIP morph 展开");
  await page.click('[data-component-id="video-techniques"]');
  await page.waitForSelector(".component-details", { state: "visible" });
  await page.waitForTimeout(500); // 等待 FLIP 动画完成

  console.log("4. 验证三列表格与富文本增强元素");
  const featureTitles = await page
    .locator(".trd-feature-title")
    .allInnerTexts();
  console.log("   - 功能点标题列表:", featureTitles);
  if (featureTitles.length < 4) {
    throw new Error(`功能点数量预期 >= 4，实际为: ${featureTitles.length}`);
  }

  // 验证 Chips
  const chipCount = await page.locator(".trd-brief-chips .trd-bchip").count();
  console.log("   - Chips 数量:", chipCount);
  if (chipCount === 0) throw new Error("未渲染 brief chips");

  // 验证 代码路径
  const codePaths = await page.locator(".trd-code-paths").allInnerTexts();
  console.log("   - 代码路径条数:", codePaths.length, codePaths[0]);

  // 验证 模块徽章与变更色条
  const badges = await page.locator(".trd-badge").allInnerTexts();
  console.log("   - 模块变更徽章:", badges);

  // 验证 代码块与行号高亮
  const highlightLines = await page.locator(".trd-ln.is-highlight").count();
  console.log("   - 高亮变更代码行数:", highlightLines);
  if (highlightLines === 0) throw new Error("未渲染高亮变更代码行");

  // 验证 BE 契约徽章
  const beBadges = await page.locator(".trd-be-badge").allInnerTexts();
  console.log("   - BE 契约徽章:", beBadges);
  if (beBadges.length === 0) throw new Error("未渲染 BE 契约徽章");

  // 验证 跨模块折叠卡片
  const crossDetails = await page.locator(".trd-cross summary").allInnerTexts();
  console.log("   - 跨模块折叠区:", crossDetails);
  if (crossDetails.length === 0) throw new Error("未渲染跨模块折叠区");

  console.log("5. 验证字段点击高亮与页面联动");
  const firstFieldBtn = page.locator("button.api-field").first();
  const fieldText = await firstFieldBtn.innerText();
  console.log("   - 点击字段按钮:", fieldText);
  await firstFieldBtn.click();
  await page.waitForTimeout(300);

  const isFieldActive = await firstFieldBtn.evaluate((el) =>
    el.classList.contains("is-field-active"),
  );
  console.log("   - 字段按钮 active 状态:", isFieldActive);
  if (!isFieldActive) throw new Error("字段按钮点击后未激活");

  console.log("6. 验证组件连续切换 (‹ › 导航)");
  await page.click('button[aria-label="上一个组件"]');
  await page.waitForTimeout(400);
  const prevCompTitle = await page
    .locator('.david-breadcrumb [aria-current="page"]')
    .innerText();
  console.log("   - 切换后组件标题:", prevCompTitle);

  console.log("7. 验证 Dock 点击恢复");
  await page.click(".component-dock");
  await page.waitForSelector(".component-details", {
    state: "detached",
    timeout: 5000,
  });
  const isDetailsClosed =
    (await page.locator(".component-details").count()) === 0;
  console.log("   - 详情面板是否已关闭:", isDetailsClosed);
  if (!isDetailsClosed) throw new Error("点击 dock 后详情面板未关闭");

  console.log("✅ 所有自动化 Smoke Test 校验通过！");
  await browser.close();
}

runSmokeTest().catch((err) => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
