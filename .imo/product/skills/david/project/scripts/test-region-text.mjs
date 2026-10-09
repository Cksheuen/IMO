import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { createSsrTestServer } from "./ssr-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
const server = await createServer({
  configFile: false,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  appType: "custom",
});
server.middlewares.use("/__region", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><html><body></body></html>");
});
let browser;
const ssr = await createSsrTestServer({
  root: process.cwd(),
  appType: "custom",
  server: { middlewareMode: true },
});
try {
  await server.listen();
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__region`,
  );
  const results = await page.evaluate(async () => {
    const { collectRegionText } = await import("/src/lib/regionText.ts");
    const { captureAppearance } = await import("/src/lib/globalSelection.ts");
    const checks = [];
    const check = (name, valid, actual) => {
      checks.push({ name, valid, actual });
    };
    const fixture = (html, style = "") => {
      document.body.innerHTML = `<style>body{margin:0;font:20px/30px monospace}p{margin:0}#fixture{position:absolute;left:60px;top:60px;width:750px} ${style}</style><div id="fixture">${html}</div>`;
      return document.querySelector("#fixture");
    };
    const bounds = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const capture = (rect) => collectRegionText(rect);
    let el = fixture(
      '<p data-review-target="a">第一段完整文字</p><p data-review-target="b">第二段 <b>加粗文字</b> tail</p><div style="display:flex;gap:50px"><span>LEFT</span><span>RIGHT</span></div>',
    );
    let result = capture(bounds(el));
    check(
      "multi-paragraph / inline / columns",
      ["第一段完整文字", "第二段", "加粗文字", "tail", "LEFT", "RIGHT"].every(
        (t) => result.text.includes(t),
      ),
      result,
    );
    const surfaces = Object.fromEntries(
      ["page", "overview", "inspector", "dock"].map((k) => [
        k,
        { current: null },
      ]),
    );
    const selected = captureAppearance(bounds(el), surfaces, {
      pageId: "fixture",
    });
    check(
      "real capture retains region text and all text anchors",
      selected.context.regionText.text === result.text &&
        ["a", "b"].every((id) =>
          selected.targets.some((t) => t.targetId === id),
        ),
      selected.context,
    );
    fixture('<p id="slice">ABCDEFGHIJ</p>');
    const r = document.createRange();
    r.setStart(document.querySelector("#slice").firstChild, 3);
    r.setEnd(document.querySelector("#slice").firstChild, 6);
    let box = bounds(r);
    box.x += 0.5;
    box.width -= 1;
    result = capture(box);
    check(
      "partial single line excludes outside characters",
      result.text === "DEF",
      result,
    );
    el = fixture(
      '<p>VISIBLE <b hidden>HIDDEN</b><i style="opacity:0">INVISIBLE</i></p><input value="PRIVATE"><textarea>SECRET</textarea><script type="application/json">SCRIPT_TEXT</script>',
    );
    result = capture(bounds(el));
    check("hidden / form / script excluded", result.text === "VISIBLE", result);
    fixture(
      '<div style="height:30px;overflow:hidden"><p>CLIPPED-IN</p><p>CLIPPED-OUT</p></div><p style="visibility:hidden">HIDDEN</p>',
    );
    result = capture({ x: 60, y: 60, width: 750, height: 180 });
    check("overflow clipping", result.text === "CLIPPED-IN", result);
    el = fixture(
      '<p id="under">UNDER</p><div style="position:absolute;inset:0;background:white">OVER</div>',
    );
    result = capture(bounds(el));
    check("foreground occlusion", result.text === "OVER", result);
    el = fixture(
      '<div style="position:relative">PARENT<div style="position:absolute;inset:0;background:white">CHILD</div></div>',
    );
    result = capture(bounds(el));
    check(
      "descendant overlay hides parent text",
      result.text === "CHILD",
      result,
    );
    el = fixture(
      '<p style="transform:scale(.7);transform-origin:left top">SCALED 中文 😀 é</p>',
    );
    result = capture(bounds(el));
    check(
      "transform / grapheme",
      result.text.includes("SCALED 中文 😀 é"),
      result,
    );
    fixture('<p>TOP</p><div style="height:400px"></div><p>BOTTOM</p>');
    result = capture({ x: 60, y: 200, width: 700, height: 50 });
    check(
      "blank area never includes ancestor text",
      result.text === "",
      result,
    );
    el = fixture(
      `<p>${"a".repeat(250)}</p>`,
      "#fixture{width:600px;overflow-wrap:anywhere}",
    );
    const long = captureAppearance(bounds(el), surfaces, { pageId: "fixture" });
    check(
      "over 120 chars retained / preview labeled",
      long.context.regionText.text.replace(/\s/g, "").length === 250 &&
        long.context.textSnippet.endsWith("…"),
      long.context,
    );
    el = fixture(
      `<p>${"a".repeat(22000)}</p>`,
      "body{font:1px/1px monospace}#fixture{width:750px;overflow-wrap:anywhere}",
    );
    result = capture(bounds(el));
    check(
      "bounded capture explicitly truncated",
      result.truncated && result.text.length <= 20000,
      result.text.length,
    );
    return { checks, selection: selected };
  });
  for (const c of results.checks)
    assert.ok(c.valid, `${c.name}: ${JSON.stringify(c.actual)}`);
  const schema = await ssr.ssrLoadModule(
    "/src/lib/feedback/selectionSchema.ts",
  );
  schema.validateAppearanceSelection(results.selection, "region");
  for (const regionText of [
    { text: "", truncated: false },
    { text: "abc", truncated: true },
  ])
    schema.validateSelectionContext({ regionText }, "ctx");
  for (const regionText of [
    { text: "a".repeat(20001), truncated: false },
    { text: "x", truncated: "false" },
    { text: "x", truncated: false, unknown: 1 },
  ])
    assert.throws(() => schema.validateSelectionContext({ regionText }, "ctx"));
  const service = await startBrowserFeedbackService();
  try {
    const entry = {
      id: "region",
      category: "visual",
      suggestion: "area",
      createdAt: new Date().toISOString(),
      scope: { selection: results.selection },
    };
    const response = await fetch(`${service.baseUrl}/feedback/region/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    assert.equal(response.status, 200, await response.text());
    const stored = await service.read("region");
    assert.deepEqual(
      stored.entries[0].scope.selection.context.regionText,
      results.selection.context.regionText,
    );
    const appendedSelection = globalThis.structuredClone(results.selection);
    appendedSelection.context.regionText.text = "新增选区的完整文字";
    const append = (addSelection) =>
      fetch(`${service.baseUrl}/feedback/region/entries/region`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addSelection }),
      });
    for (let retry = 0; retry < 2; retry++) {
      const response = await append(appendedSelection);
      assert.equal(response.status, 200, await response.text());
      const afterAppend = await service.read("region");
      assert.equal(afterAppend.entries[0].scope.selections.length, 2);
      assert.deepEqual(
        afterAppend.entries[0].scope.selections[1].context.regionText,
        appendedSelection.context.regionText,
      );
    }
    const invalidAppend = globalThis.structuredClone(appendedSelection);
    invalidAppend.context.regionText.extra = true;
    const beforeReject = await service.read("region");
    assert.equal((await append(invalidAppend)).status, 422);
    assert.deepEqual(await service.read("region"), beforeReject);
    const malformed = globalThis.structuredClone(entry);
    malformed.id = "invalid";
    malformed.scope.selection.context.regionText.extra = true;
    const rejected = await fetch(`${service.baseUrl}/feedback/region/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: malformed }),
    });
    assert.equal(rejected.status, 422);
    assert.equal((await service.read("region")).entries.length, 1);
  } finally {
    await service.close();
  }
  console.log(
    `PASS ${results.checks.length} browser scenarios + schema + real service write/append/retry/read/reject cases`,
  );
} finally {
  await browser?.close();
  await server.close();
  await ssr.close();
}
