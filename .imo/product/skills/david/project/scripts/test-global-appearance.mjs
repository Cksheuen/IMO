import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";

const BASE_URL = process.env.BASE_URL || "http://localhost:5198";
const TIMEOUT = 5000;

const feedbackService = await startBrowserFeedbackService();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await feedbackService.attach(page);
  page.on("pageerror", (err) => errors.push(["pageerror", err.message]));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (
      msg
        .text()
        .includes(
          "Failed to load resource: the server responded with a status of 404",
        )
    )
      return;
    errors.push(["console", msg.text()]);
  });
  page.setDefaultTimeout(TIMEOUT);

  const modeButton = page.getByRole("button", { name: "进入框选评价模式" });
  const feedbackPanel = page.getByTestId("david-feedback-panel");
  const selectionContext = page.getByTestId("feedback-selection-context");
  const suggestion = page.getByTestId("feedback-suggestion");
  const submit = page.getByTestId("feedback-submit");

  // --- Verified capture flow -------------------------------------------
  await page.goto(BASE_URL);
  await modeButton.click();
  assert.equal(
    await page.locator(".comment-rail-toggle").isVisible(),
    false,
    "capture hides the comment toggle from sight and keyboard navigation",
  );

  const titleBox = await page.locator("h1.title").boundingBox();
  assert(titleBox, "h1.title bounding box");
  await page.mouse.move(titleBox.x + 5, titleBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(titleBox.x + 205, titleBox.y + 65, { steps: 10 });

  const rect = page.locator(".david-gc-rect[data-positioned]");
  await rect.waitFor({ state: "visible" });
  const rectBox = await rect.boundingBox();
  assert.equal(Math.round(rectBox.width), 200);
  assert.equal(Math.round(rectBox.height), 60);
  await page.mouse.up();

  await selectionContext.waitFor({ state: "visible" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const panelBox = await feedbackPanel.boundingBox();
    const closeBox = await feedbackPanel
      .getByRole("button", { name: "关闭反馈面板" })
      .boundingBox();
    const gap = panelBox.x + panelBox.width - closeBox.x - closeBox.width;
    assert.ok(
      gap >= 0 && gap <= 18,
      `feedback close keeps the normal edge inset: ${gap}`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await page.locator(".comment-rail-toggle").isVisible(),
    false,
    "the feedback editor remains above the comment toggle",
  );
  const contextText = (await selectionContext.textContent()) || "";
  assert.match(contextText, /shell/);
  assert.match(contextText, /200\s*×\s*60/);
  assert.equal(await modeButton.getAttribute("aria-pressed"), "false");

  const note = `regression-note-${Date.now()}`;
  await suggestion.fill(note);
  await submit.click();
  const saved = page.getByText("反馈已保存");
  await saved.waitFor({ state: "visible" });

  // --- Feedback document round-trip ------------------------------------
  const readFeedback = () => feedbackService.readAny();

  const doc1 = await readFeedback();
  assert.ok(Array.isArray(doc1.entries) && doc1.entries.length > 0, "entries");
  const savedEntry = doc1.entries[doc1.entries.length - 1];
  const selection1 = savedEntry.scope.selection;
  assert.equal(selection1.surface, "shell");
  assert.equal(selection1.viewport.width, 1440);
  assert.equal(selection1.viewport.height, 1000);
  assert.equal(Math.round(selection1.rect.nw * selection1.viewport.width), 200);
  assert.equal(Math.round(selection1.rect.nh * selection1.viewport.height), 60);
  assert.ok(
    Array.isArray(selection1.targets) && selection1.targets.length > 0,
    "targets",
  );

  await page.reload();
  const doc2 = await readFeedback();
  assert.deepEqual(doc2.entries[doc2.entries.length - 1], savedEntry);

  // --- Verified cancellation -------------------------------------------
  const toolsDetails = page.locator(".review-tools");
  if ((await toolsDetails.getAttribute("open")) === null) {
    await toolsDetails.locator("summary").click();
  }
  await page.getByTestId("david-feedback-open").click();
  await feedbackPanel.waitFor({ state: "visible" });
  await suggestion.fill("keep-draft");
  await modeButton.click();
  await page.mouse.move(100, 110);
  await page.mouse.down();
  await page.mouse.move(220, 180, { steps: 10 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await feedbackPanel.waitFor({ state: "visible" });
  assert.equal(await suggestion.inputValue(), "keep-draft");
  assert.equal(await modeButton.getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "关闭反馈面板" }).click();
  await page.locator(".comment-rail-toggle").waitFor({ state: "visible" });
  await page.locator(".comment-rail-toggle").click();
  assert.equal(
    await page.locator(".comment-rail-toggle").getAttribute("aria-expanded"),
    "false",
  );
  await modeButton.click();
  assert.equal(await page.locator(".comment-rail-toggle").isVisible(), false);
  await page.keyboard.press("Escape");
  await page.locator(".comment-rail-toggle").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".comment-rail-toggle").getAttribute("aria-expanded"),
    "false",
    "cancel restores the prior collapsed state",
  );
  await page.locator(".comment-rail-toggle").click();

  // --- Verified rich capture -------------------------------------------
  const overviewCell = page.locator(
    'td[data-review-target="overview:what-to-feature:f1-top-three:change"]',
  );
  await overviewCell.locator(".disclosure-open").click();

  const detail = page.locator(".rich-detail").first();
  await detail.waitFor({ state: "visible" });
  assert.equal(await detail.getAttribute("data-david-row-id"), "f1-top-three");
  assert.equal(await detail.getAttribute("data-david-column"), "change");
  assert.ok(
    (await detail.locator(".trd-codeblk").count()) > 0,
    "codeblk present",
  );

  const codeBox = await detail.locator(".trd-codeblk").first().boundingBox();
  assert(codeBox, "code block bounding box");
  await modeButton.click();
  await page.mouse.move(codeBox.x + 8, codeBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(codeBox.x + 150, codeBox.y + 60, { steps: 10 });
  await page.mouse.up();
  await feedbackPanel.waitFor({ state: "visible" });

  const richNote = `rich-note-${Date.now()}`;
  await suggestion.fill(richNote);
  await submit.click();
  await page.getByText("反馈已保存").waitFor({ state: "visible" });

  const doc3 = await readFeedback();
  assert.equal(doc3.entries.length, doc1.entries.length + 1);
  const richEntry = doc3.entries[doc3.entries.length - 1];
  assert.equal(richEntry.scope.selection.surface, "rich-detail");
  assert.equal(richEntry.scope.selection.detail.rowId, "f1-top-three");
  assert.equal(richEntry.scope.selection.detail.column, "change");

  await page.getByRole("button", { name: "关闭反馈面板" }).click();
  await modeButton.focus();
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "hidden" });
  await feedbackPanel.waitFor({ state: "hidden" });
  assert.equal(await modeButton.getAttribute("aria-pressed"), "false");

  // Default logical depth must not crop away the small neighboring filters.
  // 组件详情入口固定走 Overview 列表；画板组件本身只负责展示。
  await page
    .locator('[data-testid="overview-component-top-gmv-techniques"]')
    .click();
  await page.locator(".component-dock.is-visible:not(.flip-morph)").waitFor();
  await page.evaluate(() => {
    window.__appearanceRootClone =
      document.querySelector(".component-dock").firstElementChild;
  });
  for (const id of [
    "technique-chips-node",
    "video-grid-node",
    "video-card-1-node",
  ]) {
    await page
      .locator('.component-dock [data-review-node-id="' + id + '"]')
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          window.__appearanceRootClone ===
          document.querySelector(".component-dock").firstElementChild,
      ),
      true,
    );
    assert.equal(
      await page
        .locator('.component-dock [data-review-node-id="technique-chips-node"]')
        .count(),
      1,
    );
  }
  assert.ok(
    (await page.getByTestId("david-breadcrumb").textContent()).includes(
      "视频卡片 1",
    ),
  );
  assert.deepEqual(
    await page
      .locator(".component-details [data-trd-row]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.trdRow)),
    ["f2-card"],
  );

  // --- Dock 几何：rail 展开无交叠、收起释放空间、窄屏不虚扣 ----------
  const dockBox = () => page.locator(".component-dock").boundingBox();
  const railBox = () => page.locator(".comment-rail").boundingBox();
  const openDock = await dockBox();
  const openRail = await railBox();
  assert.ok(openDock && openRail, "dock/rail bounding boxes");
  assert.ok(
    openDock.x + openDock.width <= openRail.x + 1,
    "rail 展开时 dock 不压在 rail 下",
  );
  // 收起 rail：dock 右缘释放到视口右缘附近
  await page.locator(".comment-rail-toggle").click();
  await page.waitForFunction(
    () => !document.body.classList.contains("comment-rail-open"),
  );
  await page.waitForTimeout(100);
  const collapsedDock = await dockBox();
  assert.ok(collapsedDock, "rail 收起后 dock 仍可测量");
  // 重新展开：恢复无交叠
  await page.locator(".comment-rail-toggle").click();
  await page.waitForFunction(() =>
    document.body.classList.contains("comment-rail-open"),
  );
  await page.waitForFunction((railLeft) => {
    const el = document.querySelector(".component-dock");
    return Boolean(el) && el.getBoundingClientRect().right <= railLeft + 1;
  }, openRail.x);
  // 窄屏：rail 进入文档流（static），dock 不虚扣右缘
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForFunction(() => {
    const rail = document.querySelector(".comment-rail");
    return Boolean(rail) && getComputedStyle(rail).position === "static";
  });
  const narrowDock = await dockBox();
  assert.ok(narrowDock && narrowDock.x >= 0, "窄屏流式 dock 保持在视口内");
  await page.setViewportSize({ width: 1440, height: 1000 });

  const railHeader = await page.locator(".comment-rail-header").boundingBox();
  await modeButton.click();
  await page.mouse.move(railHeader.x + 8, railHeader.y + 8);
  await page.mouse.down();
  await page.mouse.move(railHeader.x + 190, railHeader.y + 35, { steps: 10 });
  await page.mouse.up();
  await suggestion.fill("foreground rail appearance");
  await submit.click();
  await page.getByText("反馈已保存", { exact: true }).waitFor();
  const railEntry = (await readFeedback()).entries.at(-1);
  assert.equal(railEntry.scope.selection.surface, "shell");
  assert.ok(
    railEntry.scope.selection.targets.some(
      (target) => target.targetId === "shell:comment-rail",
    ),
  );
  assert.ok(
    railEntry.scope.selection.targets.every(
      (target) => target.kind === "shell",
    ),
  );
  assert.deepEqual(errors, [], "no page or console errors");
  console.log(
    "global appearance: header, modal, context, cancel, persistence and foreground rail passed",
  );
} finally {
  await browser.close();
  await feedbackService.close();
}
