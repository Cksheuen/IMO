#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * selection.context 深度上下文单测。
 *
 * 两层验证：
 * - Vite SSR（node 侧）加载真源 TS，验证 schema 严格校验（未知字段/长度/枚举/坐标）
 *   与旧 v1 selection（无 context）兼容；
 * - Playwright chromium 加载 vite 提供的最小 harness 页面，验证 DOM 纯函数
 *   （anchorChain / heading / mapping / domPath / textSnippet）与 captureAppearance
 *   在真实布局下产出有界、可被 schema 接受的 context。
 *
 * 不引入 jsdom 等新依赖；浏览器启动回退顺序与 test-david-drilldown 一致。
 */
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

let failures = 0;
const check = (name, cond) => {
  if (!cond) {
    failures += 1;
    console.error(`FAIL - ${name}`);
  } else {
    console.log(`ok - ${name}`);
  }
};
const rejects = (name, fn, fragment) => {
  try {
    fn();
    failures += 1;
    console.error(`FAIL - ${name}（未抛错）`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (fragment && !message.includes(fragment)) {
      failures += 1;
      console.error(`FAIL - ${name}（报错不包含 ${fragment}: ${message}）`);
    } else {
      console.log(`ok - ${name}`);
    }
  }
};

const baseSelection = (context) => ({
  version: 1,
  kind: "appearance-selection",
  capturedAt: "2026-09-10T00:00:00.000Z",
  surface: "shell",
  scene: { pageId: "p1" },
  viewport: { width: 800, height: 600 },
  windowScroll: { x: 0, y: 0 },
  rect: { nx: 0.1, ny: 0.1, nw: 0.2, nh: 0.2 },
  targets: [{ targetId: "shell:layout", label: "布局", kind: "shell" }],
  ...(context ? { context } : {}),
});

// --- 1. Node SSR: schema 严格校验 -------------------------------------
const viteServer = await createSsrTestServer({
  root: projectRoot,
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const selectionSchema = await viteServer.ssrLoadModule(
    "/src/lib/feedback/selectionSchema.ts",
  );
  const feedback = await viteServer.ssrLoadModule("/src/lib/davidFeedback.ts");

  const fullContext = {
    anchorChain: {
      componentId: "comp-a",
      nodeId: "node-a-1",
      target: "comp-a:row-1:api",
      apiFields: ["field.x", "field.y"],
    },
    textSnippet: "命中文本",
    heading: "标题",
    mapping: { rowId: "row-1", column: "api", rowLabel: "行一" },
    scene: {
      phase: "docked",
      pageId: "p1",
      componentId: "comp-a",
      nodeId: "node-a-1",
      detailOpen: true,
    },
    canvasPoint: { x: 12.5, y: -3 },
    domPath: "article.trd-cell > div.row",
  };

  const validated = selectionSchema.validateSelectionContext(
    fullContext,
    "selection.context",
  );
  check("完整 context 校验通过并原样返回", validated.canvasPoint.x === 12.5);

  selectionSchema.validateAppearanceSelection(
    baseSelection(fullContext),
    "selection",
  );
  check("完整 context 的 AppearanceSelection 校验通过", true);

  selectionSchema.validateAppearanceSelection(
    baseSelection(undefined),
    "selection",
  );
  check("旧 v1 selection（无 context）仍然合法", true);

  rejects(
    "context 未知字段拒绝",
    () =>
      selectionSchema.validateSelectionContext(
        { ...fullContext, bogus: 1 },
        "c",
      ),
    "未知或危险字段",
  );
  rejects(
    "anchorChain 未知字段拒绝",
    () =>
      selectionSchema.validateSelectionContext(
        { anchorChain: { componentId: "c", x: 1 } },
        "c",
      ),
    "未知或危险字段",
  );
  rejects("空 anchorChain 拒绝", () =>
    selectionSchema.validateSelectionContext({ anchorChain: {} }, "c"),
  );
  rejects("textSnippet 超长拒绝（>120）", () =>
    selectionSchema.validateSelectionContext(
      { textSnippet: "a".repeat(121) },
      "c",
    ),
  );
  check(
    "textSnippet 120 字符为上限",
    (() => {
      selectionSchema.validateSelectionContext(
        { textSnippet: "a".repeat(120) },
        "c",
      );
      return true;
    })(),
  );
  rejects("heading 超长拒绝（>160）", () =>
    selectionSchema.validateSelectionContext({ heading: "h".repeat(161) }, "c"),
  );
  rejects("mapping.column 非法枚举拒绝", () =>
    selectionSchema.validateSelectionContext(
      { mapping: { rowId: "r", column: "nope" } },
      "c",
    ),
  );
  check(
    "mapping.column 允许 trd（整行）",
    (() => {
      selectionSchema.validateSelectionContext(
        { mapping: { rowId: "r", column: "trd" } },
        "c",
      );
      return true;
    })(),
  );
  rejects("scene.phase 非法枚举拒绝", () =>
    selectionSchema.validateSelectionContext(
      { scene: { phase: "flying" } },
      "c",
    ),
  );
  rejects(
    "canvasPoint NaN 拒绝",
    () =>
      selectionSchema.validateSelectionContext(
        { canvasPoint: { x: Number.NaN, y: 1 } },
        "c",
      ),
    "有限数字",
  );
  rejects("canvasPoint 坐标越界拒绝", () =>
    selectionSchema.validateSelectionContext(
      { canvasPoint: { x: 1e12, y: 0 } },
      "c",
    ),
  );
  rejects("canvasPoint 未知字段拒绝", () =>
    selectionSchema.validateSelectionContext(
      { canvasPoint: { x: 1, y: 2, z: 3 } },
      "c",
    ),
  );
  rejects("apiFields 超过 16 项拒绝", () =>
    selectionSchema.validateSelectionContext(
      {
        anchorChain: {
          apiFields: Array.from({ length: 17 }, (_, i) => `f${i}`),
        },
      },
      "c",
    ),
  );
  rejects("apiFields 非字符串数组拒绝", () =>
    selectionSchema.validateSelectionContext(
      { anchorChain: { apiFields: ["ok", 1] } },
      "c",
    ),
  );
  rejects("domPath 超长拒绝（>200）", () =>
    selectionSchema.validateSelectionContext({ domPath: "d".repeat(201) }, "c"),
  );
  rejects(
    "selection 根未知字段拒绝",
    () =>
      selectionSchema.validateAppearanceSelection(
        { ...baseSelection(), injected: true },
        "s",
      ),
    "未知或危险字段",
  );

  // 端到端：含 context 的 selection 经 parseFeedback 严格解析
  const doc = {
    schema: "david-feedback/v1",
    schemaVersion: 1,
    slug: "ctx-test",
    updatedAt: "2026-09-10T00:00:00.000Z",
    mode: "integrated",
    entries: [
      {
        id: "e1",
        category: "visual",
        suggestion: "ok",
        createdAt: "2026-09-10T00:00:00.000Z",
        scope: { selection: baseSelection(fullContext) },
      },
    ],
  };
  const parsed = feedback.parseFeedback(doc);
  check(
    "parseFeedback 接受带 context 的条目",
    parsed.entries[0].scope.selection.context.canvasPoint.x === 12.5,
  );
  rejects(
    "parseFeedback 拒绝 context 注入未知字段",
    () =>
      feedback.parseFeedback({
        ...doc,
        entries: [
          {
            ...doc.entries[0],
            scope: {
              selection: baseSelection({ ...fullContext, evil: 1 }),
            },
          },
        ],
      }),
    "未知或危险字段",
  );
} finally {
  await viteServer.close();
}

// --- 2. 浏览器：DOM 纯函数 + captureAppearance ------------------------
const harnessJs = `
import {
  captureAppearance,
  collectAnchorChain,
  collectTextSnippet,
  findNearestHeading,
  findMappingContext,
  buildDomPath,
  deriveSelectionContext,
} from "/src/lib/globalSelection.ts";
import { validateAppearanceSelection } from "/src/lib/feedback/selectionSchema.ts";

const results = {};
const fail = (name, detail) => { results["FAIL:" + name] = detail || true; };

// fixture A：组件 TRD 表的 API 单元格
const root = document.createElement("section");
root.setAttribute("data-component-id", "comp-a");
root.setAttribute("data-review-node-id", "node-a-1");
root.setAttribute("aria-label", "区域标签");
root.style.position = "fixed";
root.style.left = "0";
root.style.top = "0";
const row = document.createElement("div");
row.className = "mapping-row trd-table-row";
row.setAttribute("data-trd-row", "row-1");
const title = document.createElement("span");
title.className = "trd-feature-title";
title.textContent = "功能点一";
row.appendChild(title);
const grid = document.createElement("div");
grid.className = "trd-cells-grid";
const cell = document.createElement("article");
cell.className = "map-card trd-cell trd-cell-api";
cell.setAttribute("data-review-target", "comp-a:row-1:api");
cell.setAttribute("data-review-label", "组件 · API 改动 1");
cell.style.position = "fixed";
cell.style.left = "90px";
cell.style.top = "90px";
cell.style.width = "60px";
cell.style.height = "60px";
cell.style.background = "#fff";
const field = document.createElement("span");
field.setAttribute("data-api-field", "resp.title resp.url");
field.textContent = "  标题字段   标题字段  ".repeat(20);
cell.appendChild(field);
grid.appendChild(cell);
row.appendChild(grid);
root.appendChild(row);
document.body.appendChild(root);

const chain = collectAnchorChain(field);
results.anchorChain = chain;
if (!chain || chain.componentId !== "comp-a") fail("anchorChain.componentId");
if (!chain || chain.nodeId !== "node-a-1") fail("anchorChain.nodeId");
if (!chain || chain.target !== "comp-a:row-1:api") fail("anchorChain.target");
if (!chain || JSON.stringify(chain.apiFields) !== JSON.stringify(["resp.title","resp.url"])) fail("anchorChain.apiFields 空格拆分去重");

const snippet = collectTextSnippet(field);
results.snippetLen = snippet ? snippet.length : 0;
if (!snippet || snippet.length > 120) fail("textSnippet ≤120");
if (snippet && /\\s{2,}/.test(snippet)) fail("textSnippet 压缩空白");

const heading = findNearestHeading(cell);
results.heading = heading;
if (heading !== "组件 · API 改动 1") fail("heading 取最近 data-review-label: " + heading);

const mapping = findMappingContext(cell);
results.mapping = mapping;
if (!mapping || mapping.rowId !== "row-1" || mapping.column !== "api" || mapping.rowLabel !== "功能点一") {
  fail("mapping TRD 行列与行标题");
}

const domPath = buildDomPath(field);
results.domPath = domPath;
if (!domPath || domPath.length > 200 || !domPath.includes("span")) fail("domPath 有界");

// fixture B：rich-detail dialog
const detail = document.createElement("div");
detail.setAttribute("data-david-surface", "rich-detail");
const drow = document.createElement("div");
drow.setAttribute("data-david-row-id", "row-9");
drow.setAttribute("data-david-column", "requirement");
drow.setAttribute("data-david-component-id", "comp-b");
drow.setAttribute("data-david-node-id", "node-b-2");
const dtarget = document.createElement("button");
dtarget.setAttribute("data-review-target", "comp-b:row-9:requirement");
dtarget.textContent = "详情按钮";
drow.appendChild(dtarget);
detail.appendChild(drow);
document.body.appendChild(detail);

const dmapping = findMappingContext(dtarget);
results.richMapping = dmapping;
if (!dmapping || dmapping.rowId !== "row-9" || dmapping.column !== "requirement") {
  fail("rich-detail mapping 行列");
}

// fixture C：h1 祖先 + 无列标记的 TRD 行（应归 trd 整行）
const plain = document.createElement("div");
plain.setAttribute("data-trd-row", "row-plain");
const h = document.createElement("h3");
h.textContent = "节点逻辑标题";
const inner = document.createElement("p");
inner.textContent = "正文";
h.appendChild(inner);
plain.appendChild(h);
document.body.appendChild(plain);
const heading3 = findNearestHeading(inner);
results.headingH3 = heading3;
if (heading3 !== "节点逻辑标题正文") fail("heading 识别 h1-h6: " + heading3);
const mappingPlain = findMappingContext(inner);
results.mappingPlain = mappingPlain;
if (!mappingPlain || mappingPlain.rowId !== "row-plain" || mappingPlain.column !== "trd") {
  fail("行内无列标记 → trd 整行");
}

// captureAppearance：矩形 90,90 - 150,150，命中 fixture A
const surfaces = {
  page: { current: null },
  overview: { current: null },
  inspector: { current: null },
  dock: { current: null },
};
const selection = captureAppearance(
  { x: 90, y: 90, width: 60, height: 60 },
  surfaces,
  { pageId: "p1", componentId: "comp-a", nodeId: "node-a-1" },
  "2026-09-10T00:00:00.000Z",
);
results.selectionContext = selection.context;
results.selectionSurface = selection.surface;
if (!selection.context) fail("captureAppearance 产出 context");
if (selection.context && selection.context.canvasPoint) fail("无画板时省略 canvasPoint");
if (selection.context && selection.context.scene.detailOpen !== true) {
  fail("rich-detail 在 DOM 中时 detailOpen=true");
}
if (selection.context && selection.context.anchorChain?.componentId !== "comp-a") {
  fail("capture context anchorChain");
}
if (selection.context && selection.context.mapping?.column !== "api") {
  fail("capture context mapping column");
}
validateAppearanceSelection(selection, "captured");
results.capturedValid = true;

// 传入显式 canvasPoint 时落盘
const selectionWithPoint = captureAppearance(
  { x: 90, y: 90, width: 60, height: 60 },
  surfaces,
  { pageId: "p1" },
  "2026-09-10T00:00:00.000Z",
  { x: 42, y: 7 },
);
if (!selectionWithPoint.context?.canvasPoint || selectionWithPoint.context.canvasPoint.x !== 42) {
  fail("canvasPoint 透传");
}
validateAppearanceSelection(selectionWithPoint, "captured-point");

// 旧选择无 context 时 schema 仍通过
validateAppearanceSelection({
  version: 1, kind: "appearance-selection", capturedAt: "t", surface: "shell",
  scene: { pageId: "p" }, viewport: { width: 100, height: 100 },
  windowScroll: { x: 0, y: 0 }, rect: { nx: 0, ny: 0, nw: 0.1, nh: 0.1 },
  targets: [{ targetId: "a", label: "b", kind: "shell" }],
}, "legacy");
results.legacyValid = true;

window.__selCtxResults = results;
`;

const harnessHtml = `<!doctype html><html><head><meta charset="utf-8"><title>sel-ctx</title></head>
<body><script type="module" src="/__harness.mjs"></script></body></html>`;

const httpServer = await createServer({
  root: projectRoot,
  appType: "custom",
  server: { port: 0, strictPort: false },
});
httpServer.middlewares.use((req, res, next) => {
  if (req.url === "/__harness") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(harnessHtml);
    return;
  }
  if (req.url === "/__harness.mjs") {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.end(harnessJs);
    return;
  }
  next();
});
await httpServer.listen();
const port = httpServer.config.server.port;

let browser;
try {
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
      browser = await chromium.launch({ headless: true, ...options });
      break;
    } catch {
      // try next candidate
    }
  }
  if (!browser) throw new Error("failed to launch Playwright chromium");

  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/__harness`);
  await page.waitForFunction(() => Boolean(window.__selCtxResults), null, {
    timeout: 8000,
  });
  const results = await page.evaluate(() => window.__selCtxResults);

  check("浏览器 harness 无 pageerror", pageErrors.length === 0);
  if (pageErrors.length > 0) console.error(pageErrors);

  for (const [key, value] of Object.entries(results)) {
    if (key.startsWith("FAIL:")) {
      failures += 1;
      console.error(
        `FAIL - ${key.slice(5)} ${value === true ? "" : JSON.stringify(value)}`,
      );
    }
  }
  check(
    "anchorChain 收集组件/节点/锚点/字段",
    !results["FAIL:anchorChain.componentId"] &&
      !results["FAIL:anchorChain.nodeId"] &&
      !results["FAIL:anchorChain.target"] &&
      !results["FAIL:anchorChain.apiFields 空格拆分去重"],
  );
  check(
    "textSnippet 压缩空白且 ≤120",
    (results.snippetLen ?? 0) > 0 && results.snippetLen <= 120,
  );
  check(
    "heading 取最近 data-review-label",
    results.heading === "组件 · API 改动 1",
  );
  check(
    "mapping 解析 TRD 行/列/行标题",
    results.mapping?.rowId === "row-1" &&
      results.mapping?.column === "api" &&
      results.mapping?.rowLabel === "功能点一",
  );
  check(
    "rich-detail mapping 解析 data-david-row-id/column",
    results.richMapping?.rowId === "row-9" &&
      results.richMapping?.column === "requirement",
  );
  check("h1-h6 祖先标题识别", results.headingH3 === "节点逻辑标题正文");
  check("行内无列标记归为 trd 整行", results.mappingPlain?.column === "trd");
  check(
    "domPath 存在且有界",
    Boolean(results.domPath) && results.domPath.length <= 200,
  );
  check(
    "captureAppearance 产出 context（anchorChain/mapping/detailOpen）",
    Boolean(results.selectionContext) &&
      results.selectionContext?.anchorChain?.componentId === "comp-a" &&
      results.selectionContext?.mapping?.column === "api" &&
      results.selectionContext?.scene?.detailOpen === true &&
      results.capturedValid === true,
  );
  check(
    "无画板时省略 canvasPoint",
    results.selectionContext && !results.selectionContext.canvasPoint,
  );
  check(
    "canvasPoint 显式透传并通过校验",
    results["FAIL:canvasPoint 透传"] === undefined,
  );
  check("旧 selection（无 context）浏览器侧合法", results.legacyValid === true);

  await context.close();
} finally {
  await browser?.close();
  await httpServer.close();
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");
