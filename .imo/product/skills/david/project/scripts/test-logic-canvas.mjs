import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
import {
  isValidLogicGraph,
  isValidCodeFlow,
  layoutLogicGraph,
  normalizeGraphLabel,
} from "../src/lib/logicGraph.ts";
const graph = {
  nodes: [
    {
      id: "request",
      label: "读取后端配置",
      description: ["只读取数据，不在这里保存授权。"],
    },
    {
      id: "filter",
      label: "按页面参数筛选",
      description: ["缺省展示两项，非法参数不提交。"],
      status: "changed",
    },
    {
      id: "save",
      label: "确认后保存",
      description: ["回读服务端状态后更新展示。"],
      status: "result",
    },
    {
      id: "long",
      label:
        "很长的中文节点标签不能挤出边界<br/>第二行也必须完整显示\\nthird line",
      description: ["多行文字撑开节点。"],
    },
  ],
  edges: [
    { from: "request", to: "filter", label: "可用项" },
    { from: "filter", to: "save", label: "草稿" },
    { from: "save", to: "long" },
    { from: "save", to: "request", label: "反馈" },
  ],
};
assert.ok(isValidLogicGraph(graph));
assert.ok(
  !isValidLogicGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }),
);
assert.ok(
  !isValidLogicGraph({ ...graph, edges: [{ from: "request", to: "missing" }] }),
);
assert.ok(
  !isValidLogicGraph({ ...graph, nodes: [{ id: "x", label: "x", row: 1 }] }),
);
assert.equal(normalizeGraphLabel("a<br/>b\\nc"), "a\nb\nc");
const layout = layoutLogicGraph(graph);
const badgedLayout = layoutLogicGraph(graph, { [graph.nodes[0].id]: "前端" });
assert.equal(badgedLayout.nodes[0].height, layout.nodes[0].height + 24);
assert.equal(badgedLayout.nodes[0].width, layout.nodes[0].width);
assert.ok(badgedLayout.height >= layout.height);
assert.deepEqual(layoutLogicGraph(graph, {}), layout);

assert.ok(layout.nodes[3].height > 68);
const code = Array.from(
  { length: 65 },
  (_, i) => `const value${i} = ${i};`,
).join("\n");
const row = (id, technical) => ({
  id,
  title: id,
  requirement: "需求",
  change: "技术实现",
  api: { changed: false },
  trd: { technical },
});
const spec = {
  slug: "logic-canvas-isolated-test",
  title: "Logic canvas test",
  subtitle: "isolation",
  pageHtml:
    '<div data-component-id="a" style="width:320px;height:480px">Preview</div>',
  components: [
    {
      id: "a",
      label: "A",
      mapping: [
        row("graph", { techPoints: [{ title: "逻辑链路", graph }] }),
        row("single", {
          techPoints: [
            {
              title: "代码",
              pseudoCode: code,
              codeAnnotations: [
                {
                  startLine: 1,
                  endLine: 3,
                  title: "代码解释",
                  bullets: ["仍可查看注释"],
                },
              ],
            },
          ],
        }),
        row("multiple", {
          techPoints: [{ pseudoCode: code }, { pseudoCode: code }],
        }),
      ],
    },
  ],
};
const flow = {
  nodes: [
    { id: "caller", label: "调用方" },
    { id: "save", label: "保存函数" },
    { id: "host", label: "宿主", description: ["外部上下文"] },
  ],
  edges: [
    { from: "caller", to: "save", label: "await 保存" },
    { from: "host", to: "caller", label: "触发" },
  ],
};
const points = [
  { id: "caller", title: "调用方", pseudoCode: "await save();" },
  {
    id: "save",
    title: "保存函数",
    pseudoCode: "async function save() { return persisted; }",
  },
];
assert.ok(isValidCodeFlow(flow, points));
assert.ok(!isValidCodeFlow(flow, points.slice(0, 1)));
assert.ok(
  !isValidCodeFlow(flow, [
    ...points,
    { id: "unreachable", pseudoCode: "code" },
  ]),
);
assert.ok(!isValidCodeFlow(flow, [points[0], { ...points[1], id: "caller" }]));
spec.components[0].mapping.push(
  row("flow", { codeFlow: flow, techPoints: points }),
);
spec.pageHtml +=
  '<div data-component-id="short" style="width:900px;height:180px">Short wide board</div>';
spec.components.push({
  id: "short",
  label: "Short",
  mapping: [row("short-row", { techPoints: [{ pseudoCode: code }] })],
});
// A board grows after a content update, but still leaves room for the TRD.
// Its height exceeds both former percentage thresholds at the reported viewport.
spec.pageHtml +=
  '<div data-component-id="grown" style="width:650px;height:435px">Board with presentation examples</div>';
spec.components.push({
  id: "grown",
  label: "Grown board",
  mapping: [
    row("grown-row", {
      techPoints: [
        { id: "grown-graph", title: "Current feature graph", graph },
        { pseudoCode: code },
      ],
    }),
    row("grown-flow", { codeFlow: flow, techPoints: points }),
    row("grown-multiple", {
      techPoints: [
        { title: "First graph", graph },
        { title: "Second graph", graph },
      ],
    }),
  ],
});
const service = await startBrowserFeedbackService();
const server = await startViteServer(
  fileURLToPath(new URL("../", import.meta.url)),
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await service.attach(page);
try {
  await page.goto(server.baseUrl);
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "test.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.getByTestId("overview-component-a").click();
  const open = async (id) => {
    const row = page.locator(`.inspector [data-trd-row="${id}"]`);
    const toggle = row.locator(".trd-row-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    await row
      .locator('[data-disclosure-column="change"] .disclosure-open')
      .click();
    await page.locator(".rich-detail").waitFor();
  };
  await open("graph");
  const stage = page.locator(".dv-logic-canvas .dv-canvas-stage");
  const before = await stage.boundingBox();
  assert.ok(before.height <= 260);
  const toolbar = await page
    .locator('.dv-logic-canvas [role="toolbar"]')
    .boundingBox();
  assert.ok(
    toolbar.x >= before.x &&
      toolbar.x + toolbar.width <= before.x + before.width,
  );
  assert.ok(toolbar.y >= before.y);
  const frameWidth = await page
    .locator(".dv-logic-canvas")
    .evaluate((el) => el.clientWidth);
  assert.ok(
    Math.abs(frameWidth - before.width) < 2,
    "Toolbar overlays full-width canvas",
  );
  assert.ok(toolbar.y + toolbar.height <= before.y + before.height);
  assert.ok(
    await page
      .locator(".dv-logic-canvas .dv-canvas-control-wide")
      .evaluateAll((labels) =>
        labels.every((label) => {
          const range = document.createRange();
          range.selectNodeContents(label);
          return range.getClientRects().length === 1;
        }),
      ),
  );

  await page.locator('.dv-logic-canvas [aria-label="放大"]').click();
  const after = await stage.boundingBox();
  assert.deepEqual(after, before);
  const world = page.locator(".dv-logic-canvas .dv-canvas-world");
  const prior = await world.getAttribute("style");
  await page.mouse.move(before.x + 8, before.y + 8);
  await page.mouse.wheel(0, -160);
  assert.notEqual(await world.getAttribute("style"), prior);
  await page.mouse.move(before.x + 12, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + 80, before.y + 60, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await stage.boundingBox(), before);
  await page.locator('.dv-logic-canvas [aria-label="适应内容"]').click();
  const node = page.locator('[data-logic-node-id="request"]');
  const loopLabel = await page
    .locator(".dv-logic-edges text")
    .filter({ hasText: "反馈" })
    .boundingBox();
  assert.ok(loopLabel.y + loopLabel.height < (await node.boundingBox()).y);
  await node.hover();
  await page.getByRole("tooltip").filter({ hasText: "只读取数据" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".rich-detail").count(), 1);
  assert.equal(await page.getByRole("tooltip").count(), 0);
  await node.focus();
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape");
  const clipping = await stage.evaluate((el) => ({
    overflow: getComputedStyle(el).overflow,
    bodyOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  assert.equal(clipping.overflow, "hidden");
  assert.equal(clipping.bodyOverflow, false);
  await page.locator(".rich-detail-close").click();
  await open("single");
  let body = page.locator(".rich-detail .trd-cb-body");
  const height = (await body.boundingBox()).height;
  assert.ok(height > 220, `single code ${height}`);
  const panel = await page.locator(".rich-detail").boundingBox();
  assert.ok(panel.y >= 0 && panel.y + panel.height <= 1000);
  await body.locator(".is-annotation").first().hover();
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".rich-detail-close").click();
  await open("multiple");
  const multiHeight = (
    await page.locator(".rich-detail .trd-cb-body").first().boundingBox()
  ).height;
  assert.ok(
    multiHeight > 220 && multiHeight <= 520,
    `multi code reading height ${multiHeight}`,
  );
  await page.locator(".rich-detail-close").click();
  await open("flow");
  assert.equal(
    await page.locator(".trd-code-flow-detail .trd-codeblk").count(),
    1,
  );
  await page.locator('[data-logic-node-id="save"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 2);
  assert.ok(
    (await page.locator('[data-active-code-id="save"]').innerText()).includes(
      "return persisted",
    ),
  );
  await page.locator('[data-logic-node-id="host"]').click();
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 2);
  await page.locator('[data-logic-node-id="caller"]').click();
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 1);
  await page.locator('[data-logic-node-id="save"]').focus();
  await page.keyboard.press("Space");
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 0);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 1);
  await page.locator(".rich-detail-close").click();
  await page.locator(".inspector .david-breadcrumb-item").first().click();
  await page.getByTestId("overview-component-short").click();
  await page.waitForFunction(
    () => document.querySelector(".stage")?.dataset.previewLayout === "stacked",
  );
  let shortDock = await page.locator(".component-dock").boundingBox();
  let inspector = await page.locator(".inspector").boundingBox();
  assert.ok(
    shortDock.y < 30 && inspector.y >= shortDock.y + shortDock.height + 12,
  );
  await open("short-row");
  assert.ok(
    (await page.locator(".rich-detail").boundingBox()).y >=
      shortDock.y + shortDock.height + 12,
  );
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.waitForTimeout(100);
  shortDock = await page.locator(".component-dock").boundingBox();
  assert.ok(
    (await page.locator(".rich-detail").boundingBox()).y >=
      shortDock.y + shortDock.height + 12,
  );
  await page.locator(".rich-detail-close").click();
  await page.setViewportSize({ width: 1488, height: 891 });
  await page.locator(".inspector .david-breadcrumb-item").first().click();
  await page.getByTestId("overview-component-grown").click();
  await page.waitForFunction(
    () => document.querySelector(".stage")?.dataset.previewLayout === "stacked",
  );
  const grownDock = await page.locator(".component-dock").boundingBox();
  inspector = await page.locator(".inspector").boundingBox();
  assert.ok(grownDock.y < 30 && grownDock.height >= 434);
  assert.ok(inspector.y >= grownDock.y + grownDock.height + 12);
  assert.ok(inspector.height >= 320);
  await open("grown-row");
  const grownDetail = await page.locator(".rich-detail").boundingBox();
  assert.ok(grownDetail.y >= grownDock.y + grownDock.height + 12);
  assert.ok(grownDetail.width > 900 && grownDetail.height >= 320);
  const graphPanel = page.locator(".rich-detail-graphs");
  await graphPanel.waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".rich-detail-body .dv-logic-canvas").count(),
    0,
  );
  assert.equal(await graphPanel.locator(".dv-logic-canvas").count(), 1);
  const graphPanelBox = await graphPanel.boundingBox();
  assert.ok(graphPanelBox.x > grownDock.x + grownDock.width);
  assert.ok(graphPanelBox.y + graphPanelBox.height < grownDetail.y);
  const sideFrame = await graphPanel.locator(".dv-canvas-stage").boundingBox();
  await graphPanel.getByRole("button", { name: "放大", exact: true }).click();
  assert.deepEqual(
    await graphPanel.locator(".dv-canvas-stage").boundingBox(),
    sideFrame,
  );
  await graphPanel
    .getByRole("button", { name: "适应内容", exact: true })
    .click();
  const sideCapture = await page.evaluate(async () => {
    const { captureAppearance } = await import("/src/lib/globalSelection.ts");
    const node = document.querySelector(
      '.rich-detail-graphs [data-logic-node-id="request"]',
    );
    const rect = node.getBoundingClientRect();
    return captureAppearance(
      {
        x: rect.x + 2,
        y: rect.y + 2,
        width: rect.width - 4,
        height: rect.height - 4,
      },
      {},
      { pageId: "test", componentId: "grown", phase: "docked" },
    );
  });
  assert.equal(sideCapture.surface, "rich-detail");
  assert.equal(sideCapture.detail.rowId, "grown-row");
  assert.equal(sideCapture.detail.componentId, "grown");
  assert.ok(sideCapture.context.regionText.text.includes("读取后端配置"));
  await page.setViewportSize({ width: 1100, height: 891 });
  await graphPanel.waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".rich-detail-body .dv-logic-canvas").count(),
    1,
  );
  await page.setViewportSize({ width: 1488, height: 720 });
  await page.waitForFunction(
    () => !document.querySelector(".stage")?.dataset.previewLayout,
  );
  await page.setViewportSize({ width: 1488, height: 891 });
  await page.waitForFunction(
    () => document.querySelector(".stage")?.dataset.previewLayout === "stacked",
  );
  await graphPanel.waitFor({ state: "visible" });
  assert.equal(await page.locator(".rich-detail .dv-logic-canvas").count(), 1);
  await page.locator(".rich-detail-close").click();
  await open("grown-flow");
  await graphPanel.waitFor({ state: "visible" });
  await graphPanel.locator('[data-logic-node-id="save"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator(".rich-detail-body .trd-code-flow-detail").count(),
    2,
  );
  await page.setViewportSize({ width: 1100, height: 891 });
  await graphPanel.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 2);
  await page.setViewportSize({ width: 1488, height: 891 });
  await graphPanel.waitFor({ state: "visible" });
  assert.equal(await page.locator(".trd-code-flow-detail").count(), 2);
  await page.locator(".rich-detail-close").click();
  await open("grown-multiple");
  await graphPanel.waitFor({ state: "visible" });
  assert.equal(await graphPanel.locator(".dv-logic-canvas").count(), 2);
  assert.equal(
    await page.locator(".rich-detail-body .dv-logic-canvas").count(),
    0,
  );
  const secondGraphNode = graphPanel
    .getByRole("button", { name: "读取后端配置", exact: true })
    .last();
  await secondGraphNode.scrollIntoViewIfNeeded();
  await secondGraphNode.focus();
  await page.getByRole("tooltip").filter({ hasText: "只读取数据" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".rich-detail-close").click();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.locator(".inspector .david-breadcrumb-item").first().click();
  await page.getByTestId("overview-component-a").click();
  await page.waitForFunction(
    () => !document.querySelector(".stage")?.dataset.previewLayout,
  );
  await open("graph");
  await page.setViewportSize({ width: 700, height: 650 });
  assert.ok((await stage.boundingBox()).width < 700);
  assert.ok((await stage.boundingBox()).height <= 650);
  await page.locator('.dv-logic-canvas [aria-label="适应内容"]').click();

  await page.locator(".rich-detail-close").click();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open("graph");
  const entrance = await page.locator(".dv-logic-canvas").evaluate((el) => ({
    frames: el.getAnimations().flatMap((a) => a.effect.getKeyframes()),
    animatedTransform: el
      .querySelector(".dv-canvas-world")
      .getAttribute("data-animated"),
  }));
  assert.ok(entrance.frames.length > 0);
  assert.ok(
    entrance.frames.every(
      (frame) => frame.transform === undefined || frame.transform === "none",
    ),
  );
  assert.equal(entrance.animatedTransform, null);
  await page.locator(".rich-detail-close").click();
  await open("flow");
  const selectSave = page.locator('[data-logic-node-id="save"]');
  await selectSave.click();
  const entering = page
    .locator('[data-code-id="save"]')
    .locator("..")
    .locator("..");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-code-id="save"]')
        ?.parentElement.parentElement.getAnimations().length > 0,
  );
  await page.waitForTimeout(60);
  const duringEntry = await entering.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    full:
      el.querySelector(".trd-code-flow-detail").getBoundingClientRect().height +
      14,
  }));
  assert.ok(
    duringEntry.height > 0 && duringEntry.height < duringEntry.full,
    "addition transitions its occupied height",
  );
  await page.waitForTimeout(320);
  const fullHeight = (await entering.boundingBox()).height;
  await selectSave.click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('[data-code-id="save"]').count(),
    1,
    "exit content stays mounted for transition",
  );
  assert.equal(await entering.getAttribute("inert"), "");
  assert.ok((await entering.boundingBox()).height < fullHeight);
  await selectSave.click(); // Reverse before exit is discarded.
  await page.waitForTimeout(350);
  assert.equal(await page.locator('[data-active-code-id="save"]').count(), 1);
  assert.equal(await entering.getAttribute("inert"), null);
  await selectSave.click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('[data-code-id="save"]').count(), 0);
  await page.locator(".rich-detail-close").click();
  await page.evaluate(() => {
    window.__boardAnimations = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains("component-dock"))
        window.__boardAnimations.push(frames);
      return original.call(this, frames, options);
    };
  });
  const canvasSpec = {
    ...spec,
    title: "Canvas entrance",
    pages: [
      { id: "logic", label: "Logic", kind: "canvas", pageHtml: spec.pageHtml },
    ],
  };
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "canvas.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(canvasSpec)),
    });
  await page.getByTestId("overview-component-a").click();
  const boardFrames = await page.evaluate(() =>
    window.__boardAnimations.flat(),
  );
  assert.ok(boardFrames.some((frame) => frame.opacity === 0));
  assert.ok(
    boardFrames.every(
      (frame) =>
        frame.transform === undefined &&
        frame.left === undefined &&
        frame.top === undefined,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS graph validation, multiline layout, fixed frame, fit/pan/zoom, hover/keyboard, single/multiple code sizing, narrow viewport",
  );
} finally {
  await browser.close();
  await server.close();
  await service.close();
}
