#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * Flat API contract panel tests.
 *
 * Layer 1 (SSR, vite ssrLoadModule + renderToStaticMarkup):
 * - proposed/confirmed status badges
 * - request/response flat field rows (name/type/required/meaning)
 * - collapsed migration notes (<details>)
 * - contractIds resolution: order preserved, unknown/duplicate filtered
 * - field rows expose the highlight trigger contract
 *   (button.dv-contract-field + data-contract-field tokens), aligned with
 *   the existing api-field button assertions
 *
 * Layer 2 (chromium harness):
 * - hover/focus/click drives the shared .field-highlight channel on
 *   .page-frame, nested data-api-field nodes reduce to the innermost,
 *   click pins and toggles off
 * - RowContractPanel resolves api.contractIds from the embedded
 *   #review-data script (component-tree internal wiring, no App edits)
 *
 * Browser launch follows test-selection-context.mjs fallback order.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  validateApiContract,
  validateApiContractField,
} from "../src/lib/contractModel.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    failures += 1;
    console.error("FAIL - " + name + ": " + error.message);
  }
};

const server = await createSsrTestServer({
  root: projectRoot,
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const panelModule = await server.ssrLoadModule(
    "/src/components/api-contracts/ContractSchemaPanel.tsx",
  );
  const apiContractsModule = await server.ssrLoadModule(
    "/src/components/api-contracts/index.ts",
  );
  const { ContractSchemaPanel } = panelModule;
  const { resolveContractsByIds } = apiContractsModule;

  const proposedContract = {
    id: "contract-shooting-guide",
    status: "proposed",
    title: "拍摄指南接口",
    method: "POST",
    endpoint: "/api/guide/shooting",
    request: [
      { name: "guide_id", type: "i64", required: true, meaning: "指南 id" },
      { name: "scene", type: "string", meaning: "场景标识" },
    ],
    response: [
      {
        name: "guide.title",
        type: "string",
        required: true,
        meaning: "指南标题",
      },
      {
        name: "guide.tips",
        type: "list<Tip>",
        meaning: "拍摄要点",
      },
    ],
    notes: "后端接口尚未提供，字段按 PRD 预期列出；confirmed 后只改本契约。",
  };

  const confirmedContract = {
    id: "contract-user-profile",
    status: "confirmed",
    endpoint: "/api/user/profile",
    method: "GET",
    response: [{ name: "user.name", type: "string" }],
  };

  const renderPanel = (contracts, props = {}) =>
    renderToStaticMarkup(
      createElement(ContractSchemaPanel, { contracts, ...props }),
    );

  check(
    "backend coverage validates enums and distinguishes missing fields",
    () => {
      const contract = {
        ...confirmedContract,
        provision: "backend-defined",
        response: [
          { name: "provided", type: "string" },
          { name: "absent", type: "string", provision: "missing" },
          { name: "legacy", type: "string", provision: "existing" },
        ],
      };
      assert.deepEqual(validateApiContract(contract), []);
      assert.ok(
        validateApiContract({ ...contract, provision: "unknown" }).length,
      );
      assert.ok(
        validateApiContractField({ name: "x", provision: "unknown" }).length,
      );
      const html = renderPanel([contract]);
      assert.ok(html.includes("本次后端定义"));
      assert.ok(html.includes("后端未提供"));
      assert.ok(html.includes("已有协议"));
      assert.ok(html.includes("含待补字段"));
      assert.equal(html.split("dv-contract-field--missing").length - 1, 1);
      assert.ok(
        html.includes(
          'data-contract-field="provided" data-contract-provision="backend-defined"',
        ),
      );
      assert.ok(
        html.includes(
          'data-contract-field="absent" data-contract-provision="missing"',
        ),
      );
    },
  );

  check("all contracts start collapsed and retain status summaries", () => {
    const short = renderPanel([confirmedContract]);
    assert.doesNotMatch(short, /<details[^>]* open=""/);
    const long = renderPanel([
      {
        ...confirmedContract,
        response: Array.from({ length: 9 }, (_, i) => ({
          name: `field_${i}`,
          type: "string",
        })),
      },
    ]);
    assert.doesNotMatch(long, /<details[^>]* open=""/);
    assert.ok(long.includes('data-contract-badge="confirmed"'));
    const verbose = renderPanel([
      {
        ...confirmedContract,
        response: [{ name: "value", type: "string", meaning: "x".repeat(801) }],
      },
    ]);
    assert.doesNotMatch(verbose, /<details[^>]* open=""/);
  });

  // ---- ① pure rendering ------------------------------------------------
  check("proposed/confirmed 徽标文案", () => {
    const html = renderPanel([proposedContract, confirmedContract]);
    assert.ok(html.includes("预期契约 · 待后端确认"));
    assert.ok(html.includes("已确认契约"));
    assert.ok(html.includes('data-contract-badge="proposed"'));
    assert.ok(html.includes('data-contract-badge="confirmed"'));
  });

  check("proposed 卡有明确柔和视觉区分（状态类名 + 左条修饰）", () => {
    const html = renderPanel([proposedContract]);
    assert.ok(html.includes("dv-contract-card--proposed"));
    assert.ok(!html.includes("dv-contract-card--confirmed "));
  });

  check("标题回退 id + endpoint/method 小字", () => {
    const html = renderPanel([
      { id: "contract-no-title", status: "confirmed" },
    ]);
    assert.ok(html.includes("contract-no-title"));
    const withEndpoint = renderPanel([confirmedContract]);
    assert.ok(withEndpoint.includes("GET"));
    assert.ok(withEndpoint.includes("/api/user/profile"));
  });

  check("request/response 分区与扁平字段行", () => {
    const html = renderPanel([proposedContract]);
    assert.ok(html.includes("请求字段"));
    assert.ok(html.includes("响应字段"));
    for (const name of ["guide_id", "scene", "guide.title", "guide.tips"]) {
      assert.ok(
        html.includes(`data-contract-field="${name}"`),
        "missing field row token: " + name,
      );
    }
    // types / meanings are surfaced
    assert.ok(html.includes("i64"));
    assert.ok(html.includes("list&lt;Tip&gt;") || html.includes("list<Tip>"));
    assert.ok(html.includes("拍摄要点"));
  });

  check("required 星标", () => {
    const html = renderPanel([proposedContract]);
    assert.ok(html.includes('class="dv-contract-required"'));
    assert.ok(html.includes("必填字段"));
    // 2 required fields (guide_id + guide.title)
    assert.equal(html.split("dv-contract-required").length - 1, 2);
  });

  check("notes 默认折叠的迁移备注 details", () => {
    const html = renderPanel([proposedContract]);
    assert.ok(html.includes("<details"));
    assert.ok(html.includes("<summary>迁移备注</summary>"));
    assert.ok(html.includes("后端接口尚未提供"));
    // no notes -> no details
    const without = renderPanel([confirmedContract]);
    assert.ok(!without.includes("dv-contract-notes"));
  });

  check("空契约列表渲染 null", () => {
    assert.equal(renderPanel([]), "");
  });

  // ---- ② field row trigger contract -----------------------------------
  check("字段名为键盘可达按钮并携带高亮 token 属性", () => {
    const html = renderPanel([proposedContract]);
    const fieldButtons = html
      .split("<button")
      .slice(1)
      .filter((chunk) => chunk.includes("data-contract-field="));
    assert.equal(fieldButtons.length, 4);
    for (const chunk of fieldButtons) {
      assert.ok(chunk.includes('type="button"'));
      assert.ok(chunk.includes("dv-contract-field"));
    }
    assert.ok(html.includes('data-contract-section="request"'));
    assert.ok(html.includes('data-contract-section="response"'));
  });

  // ---- ③ contractIds filtering ----------------------------------------
  check("resolveContractsByIds 保序 + 容错过滤未知/重复", () => {
    const contracts = [
      { id: "c1", status: "confirmed" },
      { id: "c2", status: "proposed" },
      { id: "c3", status: "confirmed" },
    ];
    const resolved = resolveContractsByIds(contracts, [
      "c3",
      "missing",
      "c1",
      "c3",
    ]);
    assert.deepEqual(
      resolved.map((c) => c.id),
      ["c3", "c1"],
    );
    assert.deepEqual(resolveContractsByIds(contracts, undefined), []);
    assert.deepEqual(resolveContractsByIds(undefined, ["c1"]), []);
    assert.deepEqual(resolveContractsByIds([], ["c1"]), []);
  });
} finally {
  await server.close();
}

// --- 2. Browser: shared highlight channel ------------------------------
const harnessJs = `
import { ApiContractsContext } from "/src/components/api-contracts/useApiContracts.ts";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { focusWithinSelection } from "/src/lib/feedbackFocus.ts";
import {
  ContractSchemaPanel,
  RowContractPanel,
  previewContractField,
  toggleContractField,
  findContractFieldTargets,
  CONTRACT_FIELD_PREVIEW_EVENT,
} from "/src/components/api-contracts/index.ts";

const results = { events: [] };
const fail = (name, detail) => { results["FAIL:" + name] = detail || true; };

window.addEventListener(CONTRACT_FIELD_PREVIEW_EVENT, (e) => {
  results.events.push(e.detail);
});

// page fixture: outer and innermost nodes share the field token.
const frame = document.createElement("div");
frame.className = "page-frame";
frame.innerHTML =
  '<div data-api-field="guide.title"><section>' +
  '<span data-api-field="guide.title guide.tips">TITLE</span>' +
  '<i data-api-field="other.field">X</i>' +
  '</section></div>';
document.body.appendChild(frame);

// token lookup: whitespace-split tokens, innermost only
const targets = findContractFieldTargets("guide.title");
if (targets.length !== 1 || targets[0].tagName !== "SPAN") {
  fail("最小元素 token 匹配", targets.length);
}

// hover preview marks the innermost node through the shared channel
previewContractField("guide.tips");
const markedTips = frame.querySelectorAll(".field-highlight");
if (markedTips.length !== 1 || markedTips[0].tagName !== "SPAN") {
  fail("hover 走 .field-highlight 通道且只高亮最小元素");
}
if (results.events.at(-1)?.name !== "guide.tips" || results.events.at(-1)?.pinned !== false) {
  fail("hover 预览事件 pinned=false");
}

// hover end with no sticky selection clears
previewContractField(null);
if (frame.querySelectorAll(".field-highlight").length !== 0) {
  fail("hover 结束清除高亮");
}

// rendered panel: real click on a field button
const panelHost = document.createElement("div");
document.body.appendChild(panelHost);
const contracts = [{
  id: "c1",
  status: "proposed",
  provision: "backend-defined",
  title: "Contract fields",
  method: "GET",
  endpoint: "/api/guide",
  request: [{ name: "guide.title", type: "string", required: true, meaning: "标题", provision: "missing" }],
  response: [{ name: "other.field", type: "i64" }],
  notes: "迁移备注内容",
}];
createRoot(panelHost).render(createElement(ContractSchemaPanel, { contracts }));
await new Promise((r) => setTimeout(r, 30));

const btn = panelHost.querySelector('[data-contract-field="guide.title"]');
if (!btn || btn.tagName !== "BUTTON") fail("字段按钮渲染进 DOM");
if (getComputedStyle(btn.querySelector('.dv-contract-field-name')).color !== 'rgb(180, 35, 24)') fail("缺失字段渲染为红色");
const provided = panelHost.querySelector('[data-contract-field="other.field"]');
if (provided.dataset.contractProvision !== 'backend-defined' || provided.classList.contains('dv-contract-field--missing')) fail("已有定义正常显示并继承来源标签");
btn.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body }));
btn.click();
await new Promise((r) => setTimeout(r, 30));

const markedAfterClick = Array.from(frame.querySelectorAll(".field-highlight"));
if (markedAfterClick.length !== 1 || markedAfterClick[0].tagName !== "SPAN") {
  fail("点击后最小元素保持 .field-highlight", markedAfterClick.length);
}
if (!btn.classList.contains("is-field-active")) fail("点击行获得 is-field-active");
if (results.events.at(-1)?.pinned !== true) fail("点击事件 pinned=true");

// hover another field then leave -> sticky click highlight restored
const otherBtn = panelHost.querySelector('[data-contract-field="other.field"]');
otherBtn.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body }));
if (frame.querySelectorAll(".field-highlight").length !== 1 ||
    !frame.querySelector("i.field-highlight")) {
  fail("hover 切换到其他字段");
}
otherBtn.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
if (!frame.querySelector("span.field-highlight")) {
  fail("hover 离开后恢复点击字段的 sticky 高亮");
}
if (btn.classList.contains("is-field-active") === false) fail("sticky 行仍 active");

// toggle off
btn.click();
await new Promise((r) => setTimeout(r, 30));
if (frame.querySelectorAll(".field-highlight").length !== 0) fail("再次点击清除高亮");
if (btn.classList.contains("is-field-active")) fail("再次点击取消 active");

// RowContractPanel resolves api.contractIds from embedded #review-data
const dataNode = document.createElement("script");
dataNode.id = "review-data";
dataNode.type = "application/json";
dataNode.textContent = JSON.stringify({
  apiContracts: [
    { id: "embedded-a", status: "confirmed", response: [{ name: "a.f" }] },
    { id: "embedded-b", status: "proposed" },
  ],
});
document.body.appendChild(dataNode);

const rowHost = document.createElement("div");
document.body.appendChild(rowHost);
const row = { id: "r1", api: { contractIds: ["embedded-b", "ghost"] } };
const rowRoot = createRoot(rowHost);
const renderRow = (contracts) => rowRoot.render(createElement(ApiContractsContext.Provider, {value: contracts}, createElement(RowContractPanel, {row})));
renderRow(JSON.parse(dataNode.textContent).apiContracts);
await new Promise((r) => setTimeout(r, 30));
const card = rowHost.querySelector("[data-contract-id='embedded-b']");
if (!card) fail("RowContractPanel 经 contractIds 命中嵌入 apiContracts");
if (card.getAttribute("data-contract-status") !== "proposed") fail("命中契约状态");
if (rowHost.querySelector("[data-contract-id='embedded-a']")) fail("未引用契约不渲染");
renderRow([{id: "embedded-b", status: "confirmed", title: "current"}]);
await new Promise((r) => setTimeout(r, 30));
if (rowHost.querySelector("[data-contract-id='embedded-b']")?.dataset.contractStatus !== "confirmed") fail("current ReviewData 更新契约状态");
renderRow([]);
await new Promise((r) => setTimeout(r, 30));
if (rowHost.querySelector("[data-contract-id]")) fail("导入无契约后旧契约清除");

const emptyHost = document.createElement("div");
document.body.appendChild(emptyHost);
createRoot(emptyHost).render(
  createElement(RowContractPanel, { row: { id: "r2", api: {} } }),
);
await new Promise((r) => setTimeout(r, 30));
if (emptyHost.querySelector("[data-testid='dv-contract-panel']")) {
  fail("无 contractIds 渲染 null");
}

window.__contractResults = results;
window.__focusContractSelection = () => focusWithinSelection(panelHost, {
  context: { anchorChain: { apiFields: ["guide.title"] } },
});
`;

const harnessHtml = `<!doctype html><html><head><meta charset="utf-8"><title>contract-panel</title></head>
<body><script type="module" src="/__harness.mjs"></script></body></html>`;

const harnessVirtualId = "\0contract-test-harness";

const httpServer = await createServer({
  root: projectRoot,
  appType: "custom",
  server: { port: 0, strictPort: false },
  // Serve the harness as a virtual vite module so bare specifiers
  // (react-dom/client) go through the normal dev transform pipeline.
  plugins: [
    {
      name: "contract-test-harness",
      resolveId(id) {
        if (id === "/__harness.mjs") return harnessVirtualId;
        return null;
      },
      load(id) {
        if (id === harnessVirtualId) return harnessJs;
        return null;
      },
    },
  ],
});
await httpServer.listen();
const port = httpServer.config.server.port;
// transformIndexHtml injects the plugin-react preamble required when the
// harness entry pulls JSX modules.
const transformedHarnessHtml = await httpServer.transformIndexHtml(
  "/__harness",
  harnessHtml,
);
httpServer.middlewares.stack.unshift({
  route: "",
  handle: (req, res, next) => {
    if (req.url === "/__harness") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(transformedHarnessHtml);
      return;
    }
    next();
  },
});

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
    viewport: { width: 900, height: 700 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/__harness`);
  await page.waitForFunction(() => Boolean(window.__contractResults), null, {
    timeout: 10000,
  });
  const results = await page.evaluate(() => window.__contractResults);

  check("浏览器 harness 无 pageerror", () => {
    assert.equal(pageErrors.length, 0, pageErrors.join("; "));
  });
  for (const key of Object.keys(results)) {
    if (key.startsWith("FAIL:")) {
      failures += 1;
      console.error(
        `FAIL - ${key.slice(5)} ${results[key] === true ? "" : JSON.stringify(results[key])}`,
      );
    }
  }
  check("字段 hover/click 联动断言全部通过", () => {
    assert.ok(!Object.keys(results).some((k) => k.startsWith("FAIL:")));
  });
  const svgClone = await page.evaluate(async () => {
    const { mountComponentClone } =
      await import("/src/components/canvas/dockGeometry.ts");
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    const source = document.createElement("div");
    const icon =
      '<svg width="20" height="20" viewBox="0 0 20 20"><defs><clipPath id="shared-clip"><rect width="20" height="20"/></clipPath><linearGradient id="shared-paint"><stop stop-color="red"/></linearGradient><path id="shared-shape" d="M0 0h20v20H0z"/></defs><g clip-path="url(#shared-clip)"><use href="#shared-shape" fill="url(#shared-paint)"/></g></svg>';
    source.innerHTML = icon + icon;
    hidden.append(source);
    const host = document.createElement("div");
    document.body.append(hidden, host);
    const clone = mountComponentClone(host, source);
    const ids = [...clone.querySelectorAll("[id]")].map((el) => el.id);
    const links = [...clone.querySelectorAll("svg")].every((svg) => {
      const id = svg.querySelector("clipPath").id;
      const paint = svg.querySelector("linearGradient").id;
      const shape = svg.querySelector("path").id;
      return (
        document.getElementById(id) === svg.querySelector("clipPath") &&
        svg.querySelector("g").getAttribute("clip-path") === `url(#${id})` &&
        svg.querySelector("use").getAttribute("fill") === `url(#${paint})` &&
        svg.querySelector("use").getAttribute("href") === `#${shape}`
      );
    });
    const result = {
      links,
      unique: new Set(ids).size === ids.length,
      sourceUnchanged: source.querySelector("clipPath").id === "shared-clip",
    };
    hidden.remove();
    host.remove();
    return result;
  });
  check(
    "cloned SVG clip/paint/use resolve locally without changing hidden originals",
    () => {
      assert.deepEqual(svgClone, {
        links: true,
        unique: true,
        sourceUnchanged: true,
      });
    },
  );
  const card = page.locator('[data-contract-id="c1"]');
  const disclosure = card.locator(":scope > details");
  const field = card.locator('[data-contract-field="guide.title"]');
  assert.equal(await disclosure.evaluate((el) => el.open), false);
  assert.equal(await field.isVisible(), false);
  await card.locator(".dv-contract-title").click();
  assert.equal(await field.isVisible(), true);
  await card.locator(".dv-contract-title").click();
  assert.equal(await card.locator("[data-contract-badge]").isVisible(), true);
  await card.locator(".dv-contract-path").click();
  assert.equal(await field.isVisible(), true);
  await field.click();
  await card.locator(":scope > details > summary").click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new window.CustomEvent("david-contract-field-preview", {
        detail: { name: "other.field" },
      }),
    ),
  );
  assert.equal(
    await disclosure.evaluate((el) => el.open),
    false,
    "field-preview rerender preserves the reader's collapse choice",
  );
  await card.locator(":scope > details > summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await field.isVisible(), true);
  await page.keyboard.press("Space");
  assert.equal(await field.isVisible(), false);
  await page.evaluate(() => window.__focusContractSelection());
  assert.equal(
    await field.isVisible(),
    true,
    "comment field navigation expands the shared disclosure",
  );
  console.log(
    "ok - contract title/path, keyboard, rerender and comment disclosure",
  );
  await browser.close();
} catch (error) {
  failures += 1;
  console.error("FAIL - 浏览器 harness 执行失败: " + error.message);
} finally {
  await httpServer.close();
}

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log("\n扁平 API 契约面板全部断言通过");
