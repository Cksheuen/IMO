#!/usr/bin/env node
// Headless integration regression for OverviewDetails grouping and linking.
// Uses a kernel-assigned free vite port by default, or BASE_URL when provided.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import {
  startViteCli,
  stopViteCli,
  waitForServer,
} from "./browser-test-server.mjs";

// Assigned in main() from the kernel-allocated vite port (or BASE_URL when the
// aggregator supplies a shared server).
let BASE_URL = process.env.BASE_URL ? new URL(process.env.BASE_URL).href : "";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SAMPLE_PATH = fileURLToPath(
  new URL(
    "../src/samples/video-conversion-shooting-guide.review.json",
    import.meta.url,
  ),
);

const DEFAULT_GROUPS = [
  {
    id: "what-to-feature",
    label: "Selling points",
    rows: 2,
    rowSpan: 2,
  },
  {
    id: "top-gmv-techniques",
    label: "Top GMV video techniques",
    rows: 4,
    rowSpan: 4,
  },
  {
    id: "avoid-content-violation",
    label: "Avoid content violation",
    rows: 1,
    rowSpan: 1,
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function waitForVite(child) {
  return waitForServer(child, BASE_URL);
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
      // Try the next installed headless browser candidate.
    }
  }
  throw new Error(
    "failed to launch headless Chromium (tried chrome, chromium, CHROME_BIN, bundled)",
  );
}

function attachErrorListeners(page) {
  const errors = [];
  page.on("console", (msg) => {
    // Feedback service 未启动时的 loopback 连接拒绝是预期离线态，App 会展示离线横幅；
    // 服务在运行但某 slug 尚无评论数据时，GET /feedback/<slug> 返回 404 也是
    // transport 明确约定的“空数据而非错误”（见 feedbackTransport load()）。
    // 其余 console.error 仍必须让回归测试失败。
    if (msg.type() !== "error") return;
    if (/ERR_CONNECTION_REFUSED/.test(msg.text())) return;
    const expectedFeedbackEmpty =
      msg.location().url.includes("/feedback/") &&
      /status of 404/.test(msg.text());
    if (!expectedFeedbackEmpty) errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) =>
    errors.push(`pageerror: ${err?.stack || String(err)}`),
  );
  return errors;
}

async function waitForCondition(fn, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (err) {
      lastError = err;
    }
    await sleep(50);
  }
  throw new Error(
    `${message}${lastError ? ` (last error: ${lastError.message})` : ""}`,
  );
}

async function linkedState(page) {
  return page.evaluate(() => ({
    overview: [
      ...new Set(
        Array.from(
          document.querySelectorAll(
            ".david-overview-mapping .david-overview-linked",
          ),
        )
          .map(
            (el) => el.closest("tbody[data-component-id]")?.dataset.componentId,
          )
          .filter(Boolean),
      ),
    ],
    source: [
      ...new Set(
        Array.from(
          document.querySelectorAll(".page-frame .david-overview-linked"),
        )
          .map((el) => el.closest("[data-component-id]")?.dataset.componentId)
          .filter(Boolean),
      ),
    ],
  }));
}

async function assertLinked(page, id) {
  const state = await linkedState(page);
  assert.deepEqual(
    state,
    { overview: id ? [id] : [], source: id ? [id] : [] },
    `unexpected linked state for ${id ?? "no component"}`,
  );
}

async function waitForLinked(page, id) {
  await waitForCondition(
    async () => {
      const state = await linkedState(page);
      return (
        state.overview.length === (id ? 1 : 0) &&
        state.source.length === (id ? 1 : 0) &&
        (id ? state.overview[0] === id && state.source[0] === id : true)
      );
    },
    `timed out waiting for linked state ${id ?? "empty"}`,
  );
  await assertLinked(page, id);
}

async function assertNoOverlay(page) {
  const counts = await page.evaluate(() => ({
    inspector: document.querySelectorAll(".component-details.is-open").length,
    dock: document.querySelectorAll(".component-dock.is-visible").length,
    overviewNav: document.querySelectorAll(".david-overview-components").length,
  }));
  assert.deepEqual(
    counts,
    { inspector: 0, dock: 0, overviewNav: 0 },
    "hover/focus must not open inspector/dock or legacy overview nav",
  );
}

async function clearLinking(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.mouse.move(1, 1);
  await waitForLinked(page, null);
}

async function hoverWithStableGeometry(page, selector) {
  const locator = page.locator(selector);
  await locator.evaluate((element) => element.scrollIntoViewIfNeeded());
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await locator.hover();
}

async function hoverAndAssert(page, selector, id) {
  await hoverWithStableGeometry(page, selector);
  await waitForLinked(page, id);
  await assertNoOverlay(page);
}

async function parkMouse(page) {
  await page.mouse.move(1, 1);
}

async function waitForOverviewReturn(page) {
  await page.locator(".david-overview-surface:not([inert])").waitFor();
}

async function assertDefaultStructure(page) {
  const table = page.locator(".david-overview-mapping");
  await table.waitFor({ state: "visible" });

  const groups = await table.evaluate((element) =>
    Array.from(element.querySelectorAll("tbody[data-component-id]")).map(
      (tbody) => {
        // 跳转直接绑定在 th[scope=rowgroup] 单元格自身，不再嵌套 button。
        const firstCell = tbody.querySelector("th[scope='rowgroup']");
        return {
          id: tbody.dataset.componentId,
          label:
            firstCell
              ?.querySelector(".overview-component-label")
              ?.textContent?.trim() ?? "",
          rows: tbody.querySelectorAll("tr").length,
          rowSpan: firstCell?.rowSpan ?? 0,
          testid:
            firstCell?.querySelector("button[data-testid]")?.dataset.testid ??
            "",
        };
      },
    ),
  );
  assert.deepEqual(
    groups,
    DEFAULT_GROUPS.map(({ id, label, rows, rowSpan }) => ({
      id,
      label,
      rows,
      rowSpan,
      testid: `overview-component-${id}`,
    })),
  );
  assert.equal(
    await table.locator("tbody[data-component-id] tr").count(),
    7,
    "default sample should render exactly seven mapping rows",
  );
  assert.equal(
    await table.locator("colgroup col").count(),
    4,
    "overview table should retain four columns",
  );
  assert.equal(
    await page.locator(".david-overview-components").count(),
    0,
    "legacy bottom overview nav must not exist",
  );

  const layout = await page.evaluate(() => {
    const overviewTable = document.querySelector(".david-overview-mapping");
    const cells = Array.from(overviewTable.querySelectorAll("thead th")).map(
      (cell) => cell.getBoundingClientRect().width,
    );
    return {
      cells,
      tableWidth: overviewTable.getBoundingClientRect().width,
      tableScrollWidth: overviewTable.scrollWidth,
      tableClientWidth: overviewTable.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  assert.equal(layout.cells.length, 4);
  assert.ok(
    layout.tableScrollWidth <= layout.tableClientWidth,
    `overview table must not scroll horizontally: ${layout.tableScrollWidth} > ${layout.tableClientWidth}`,
  );
  assert.ok(
    layout.documentScrollWidth <= layout.viewportWidth,
    `page must not scroll horizontally at desktop width: ${layout.documentScrollWidth} > ${layout.viewportWidth}`,
  );
  const cellTotal = layout.cells.reduce((sum, width) => sum + width, 0);
  const expectedRatios = [0.24, 0.28, 0.28, 0.2];
  layout.cells.forEach((width, index) => {
    assert.ok(
      Math.abs(width / cellTotal - expectedRatios[index]) < 0.01,
      `column ${index + 1} width ratio should be ${expectedRatios[index]}, got ${width / cellTotal}`,
    );
  });
  assert.ok(
    Math.abs(cellTotal - layout.tableWidth) < 8,
    `four columns should fill the table width: cells ${cellTotal} vs table ${layout.tableWidth}`,
  );
}

async function previewDimensions(page) {
  return page.locator(".page-frame").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width.toFixed(3),
      height: rect.height.toFixed(3),
    };
  });
}

async function runDefaultChecks(page) {
  await assertDefaultStructure(page);

  const dimensionsBefore = await previewDimensions(page);
  await hoverAndAssert(
    page,
    '.david-overview-mapping tbody[data-component-id="top-gmv-techniques"] tr:nth-of-type(2)',
    "top-gmv-techniques",
  );
  await clearLinking(page);

  await hoverAndAssert(
    page,
    '[data-testid="overview-component-avoid-content-violation"]',
    "avoid-content-violation",
  );
  await clearLinking(page);

  await hoverAndAssert(
    page,
    '.page-frame [data-component-id="what-to-feature"]',
    "what-to-feature",
  );
  assert.deepEqual(
    await previewDimensions(page),
    dimensionsBefore,
    "preview dimensions must remain unchanged while linking",
  );
  await clearLinking(page);

  const topButton = page.locator(
    '[data-testid="overview-component-top-gmv-techniques"]',
  );
  await topButton.focus();
  await waitForLinked(page, "top-gmv-techniques");
  await assertNoOverlay(page);
  await topButton.evaluate((element) => element.blur());
  await waitForLinked(page, null);

  await topButton.click();
  await page.locator(".component-details.is-open").waitFor();
  await page.locator(".component-dock.is-visible:not(.flip-morph)").waitFor();
  await waitForLinked(page, null);
  assert.equal(
    await page.locator(".david-overview-linked").count(),
    0,
    "opening the inspector must clean up all overview link classes",
  );

  await page.locator(".component-details.is-open button.close").click();
  await waitForOverviewReturn(page);
  await hoverAndAssert(
    page,
    '.page-frame [data-component-id="top-gmv-techniques"]',
    "top-gmv-techniques",
  );
  await clearLinking(page);
}

function cloneSample() {
  return JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));
}

function componentRow(fixture, componentId, rowId) {
  const component = fixture.components.find(
    (candidate) => candidate.id === componentId,
  );
  const row = component?.mapping.find((candidate) => candidate.id === rowId);
  assert.ok(row, `fixture row ${componentId}/${rowId} must exist`);
  return JSON.parse(JSON.stringify(row));
}

async function importReview(page, fixture, expectedTitle) {
  const input = page
    .locator("label.import-control", {
      hasText: /^\s*导入 review\s*$/,
    })
    .locator('input[type="file"]');
  await input.setInputFiles({
    name: "overview-linking.review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.locator("h1.title", { hasText: expectedTitle }).waitFor();
  await page.locator(".david-overview-mapping").waitFor({ state: "visible" });
}

async function tableGroupState(page) {
  return page.locator(".david-overview-mapping").evaluate((table) =>
    Array.from(table.querySelectorAll("tbody")).map((tbody) => ({
      id: tbody.hasAttribute("data-component-id")
        ? tbody.dataset.componentId
        : null,
      rowSpan: tbody.querySelector("th[scope='rowgroup']")?.rowSpan ?? null,
      firstCellText:
        tbody
          .querySelector("th[scope='rowgroup']")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ?? "",
      rows: Array.from(tbody.querySelectorAll("tr")).map(
        (tr) =>
          (
            tr.querySelector("td .disclosure-summary") ?? tr.querySelector("td")
          )?.textContent
            ?.replace(/\s+/g, " ")
            .trim() ?? "",
      ),
      entryTestids: Array.from(
        tbody.querySelectorAll("th[scope='rowgroup'] button[data-testid]"),
      ).map((cell) => cell.dataset.testid ?? ""),
    })),
  );
}

async function assertExplicitMappingImport(page) {
  const fixture = cloneSample();
  fixture.slug = "overview-linking-explicit";
  fixture.title = "Explicit overview linking";
  fixture.subtitle = "Explicit overview mapping import regression";

  const scopedRow = componentRow(fixture, "what-to-feature", "f1-evidence");
  scopedRow.id = "what-to-feature:f1-evidence";
  scopedRow.requirement = "Explicit scoped mapping row";
  delete scopedRow.trd;
  delete scopedRow.overviewSummary;

  const rawRow = componentRow(fixture, "top-gmv-techniques", "f2-chips");
  rawRow.id = "f2-chips";
  rawRow.requirement = "Explicit raw mapping row";
  delete rawRow.trd;
  delete rawRow.overviewSummary;

  const unknownRow = {
    id: "unknown-overview-row",
    requirement: "Unknown overview row",
    change: "This row has no component mapping match.",
    api: { summary: "Neutral API summary" },
  };
  const ambiguousWhatRow = componentRow(
    fixture,
    "what-to-feature",
    "f1-top-three",
  );
  ambiguousWhatRow.id = "shared-ambiguous-row";
  ambiguousWhatRow.requirement = "Ambiguous component row in Selling points";
  delete ambiguousWhatRow.trd;
  delete ambiguousWhatRow.overviewSummary;
  const ambiguousTopRow = componentRow(
    fixture,
    "top-gmv-techniques",
    "f2-source",
  );
  ambiguousTopRow.id = "shared-ambiguous-row";
  ambiguousTopRow.requirement = "Ambiguous component row in Top GMV";
  delete ambiguousTopRow.trd;
  delete ambiguousTopRow.overviewSummary;
  fixture.components[0].mapping.push(ambiguousWhatRow);
  fixture.components[1].mapping.push(ambiguousTopRow);

  const ambiguousOverviewRow = JSON.parse(JSON.stringify(ambiguousWhatRow));
  ambiguousOverviewRow.requirement = "Ambiguous overview row";
  delete ambiguousOverviewRow.trd;
  delete ambiguousOverviewRow.overviewSummary;
  fixture.overview = {
    title: "Explicit overview",
    summary: "Raw, scoped, unknown, and ambiguous IDs are grouped correctly.",
    mapping: [scopedRow, rawRow, unknownRow, ambiguousOverviewRow],
  };

  await importReview(page, fixture, fixture.title);
  const groups = await tableGroupState(page);
  assert.deepEqual(groups, [
    {
      id: "what-to-feature",
      rowSpan: 1,
      firstCellText: "Selling points改动点 / F11 个功能",
      rows: ["Explicit scoped mapping row"],
      entryTestids: ["overview-component-what-to-feature"],
    },
    {
      id: "top-gmv-techniques",
      rowSpan: 1,
      firstCellText: "Top GMV video techniques改动点 / F21 个功能",
      rows: ["Explicit raw mapping row"],
      entryTestids: ["overview-component-top-gmv-techniques"],
    },
    {
      id: "avoid-content-violation",
      rowSpan: 1,
      firstCellText: "Avoid content violation隐藏 / F31 条映射",
      rows: ["暂无映射说明"],
      entryTestids: ["overview-component-avoid-content-violation"],
    },
    {
      id: null,
      rowSpan: 2,
      firstCellText: "整体说明",
      rows: ["Unknown overview row", "Ambiguous overview row"],
      entryTestids: [],
    },
  ]);
  assert.equal(
    await page.locator(".david-overview-components").count(),
    0,
    "explicit mapping import must not add legacy overview nav",
  );
}

async function closeInspector(page) {
  await page.locator(".component-details.is-open button.close").click();
  await waitForOverviewReturn(page);
}

async function assertEmptyMappingImport(page) {
  const fixture = cloneSample();
  fixture.slug = "overview-linking-empty";
  fixture.title = "Empty explicit overview";
  fixture.subtitle = "Empty explicit overview mapping legacy navigation";
  fixture.overview = {
    title: "Empty explicit overview",
    summary: "An empty mapping still exposes component entry buttons.",
    mapping: [],
  };

  await importReview(page, fixture, fixture.title);
  const groups = await tableGroupState(page);
  assert.deepEqual(
    groups.map((group) => ({
      id: group.id,
      rowSpan: group.rowSpan,
      rows: group.rows,
      buttonCount: group.entryTestids.length,
    })),
    DEFAULT_GROUPS.map((group) => ({
      id: group.id,
      rowSpan: 1,
      rows: ["暂无映射说明"],
      buttonCount: 1,
    })),
  );
  assert.equal(
    await page.locator(".david-overview-components").count(),
    0,
    "empty mapping import must not add legacy overview nav",
  );

  for (const group of DEFAULT_GROUPS) {
    await page
      .locator(`[data-testid="overview-component-${group.id}"]`)
      .click();
    await page.locator(".component-details.is-open").waitFor();
    await page.locator(".component-dock.is-visible:not(.flip-morph)").waitFor();
    await closeInspector(page);
  }
}

async function runImportChecks(page) {
  await assertExplicitMappingImport(page);
  await assertEmptyMappingImport(page);
}

async function reducedMotionPass(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = attachErrorListeners(page);
  try {
    await page.goto(BASE_URL);
    await page.evaluate(() => window.scrollTo(0, 0));
    await parkMouse(page);
    await runDefaultChecks(page);
    assert.equal(
      errors.length,
      0,
      `reduced-motion page errors: ${errors.join(" | ")}`,
    );
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const vite = process.env.BASE_URL ? null : await startViteCli(PROJECT_ROOT);
  const child = vite?.child;
  if (vite) BASE_URL = vite.baseUrl;
  let browser;
  try {
    if (child) await waitForVite(child);
    browser = await launchChromium();

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors = attachErrorListeners(page);

    await page.goto(BASE_URL);
    await parkMouse(page);
    await withTimeout(
      runDefaultChecks(page),
      60_000,
      "default overview checks",
    );
    await withTimeout(runImportChecks(page), 60_000, "import overview checks");
    assert.equal(errors.length, 0, `page errors: ${errors.join(" | ")}`);
    await withTimeout(
      reducedMotionPass(browser),
      45_000,
      "reduced-motion pass",
    );

    console.log("[test-overview-linking] OK");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child) await stopViteCli(child);
  }
}

main().catch((err) => {
  console.error("[test-overview-linking] FAILED:", err);
  process.exit(1);
});
