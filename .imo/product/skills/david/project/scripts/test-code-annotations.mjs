import { createSsrTestServer } from "./ssr-test-server.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const review = JSON.parse(
  fs.readFileSync(
    new URL(
      "../src/samples/video-conversion-shooting-guide.review.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const component = review.components[0];
const row = component.mapping[0];
const code =
  "function accept(value) {\n  if (!value) return false;\n  const ready = value.ready;\n  if (!ready) return false;\n  return true;\n}";
const annotations = [
  {
    startLine: 1,
    endLine: 2,
    title: "输入检查",
    bullets: ["拒绝缺少输入的调用，避免继续读取字段。"],
  },
  {
    startLine: 3,
    endLine: 6,
    title: "就绪检查",
    bullets: ["只有数据就绪才能接受结果。"],
  },
];
row.trd = {
  technical: {
    techPoints: [
      { title: "注释测试", pseudoCode: code, codeAnnotations: annotations },
    ],
  },
};
const server = await createSsrTestServer({ server: { middlewareMode: true } });
try {
  const { parseReviewSpec } = await server.ssrLoadModule(
    "/src/lib/reviewSpec.ts",
  );
  parseReviewSpec(review);
  for (const mutation of [
    (a) => {
      a[0].startLine = 0;
    },
    (a) => {
      a[1].startLine = a[0].endLine;
    },
    (a) => {
      a[1].endLine = code.split("\n").length + 1;
    },
    (a) => {
      a[0].bullets = [];
    },
  ]) {
    const invalid = globalThis.structuredClone(review);
    mutation(
      invalid.components[0].mapping[0].trd.technical.techPoints[0]
        .codeAnnotations,
    );
    assert.throws(() => parseReviewSpec(invalid));
  }

  // apiChange.items[].code 与 techPoints.pseudoCode 共用同一校验口径
  const structCode =
    "struct ProductIdeationData {\n  1: string id;\n+ 2: string short_selling_points;\n}";
  const structAnnotations = [
    {
      startLine: 1,
      endLine: 2,
      title: "既有字段",
      bullets: ["本轮未改动，仅作上下文。"],
    },
    {
      startLine: 3,
      endLine: 4,
      title: "新增字段",
      bullets: ["卖点 JSON，行首 + 标记为改动行。"],
    },
  ];
  const withApiCode = globalThis.structuredClone(review);
  withApiCode.components[0].mapping[0].trd.apiChange = {
    items: [
      {
        beId: "BE-F1-001",
        codeLabel: "Thrift",
        code: structCode,
        codeAnnotations: structAnnotations,
      },
    ],
  };
  parseReviewSpec(withApiCode);
  for (const mutation of [
    (a) => {
      a[0].startLine = 0;
    },
    (a) => {
      a[1].startLine = a[0].endLine;
    },
    (a) => {
      a[1].endLine = structCode.split("\n").length + 1;
    },
    (a) => {
      a[0].bullets = [];
    },
    (a) => {
      a[0].title = "  ";
    },
  ]) {
    const invalid = globalThis.structuredClone(withApiCode);
    mutation(
      invalid.components[0].mapping[0].trd.apiChange.items[0].codeAnnotations,
    );
    assert.throws(
      () => parseReviewSpec(invalid),
      "apiChange.items[].codeAnnotations 必须与 techPoints 同口径校验",
    );
  }
} finally {
  await server.close();
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1239, height: 756 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) =>
    console.error("annotation page error:", error.message),
  );
  page.setDefaultTimeout(8000);
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:5197/");
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input[type=file]")
    .setInputFiles({
      name: "annotations.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(review)),
    });
  await page.getByTestId(`overview-component-${component.id}`).click();
  await page
    .locator(".inspector")
    .getByRole("button", { name: "查看实现", exact: true })
    .first()
    .click();
  const dialog = page.locator(".rich-detail");
  const block = dialog.locator(".trd-codeblk");
  assert.equal(await block.count(), 1, "源码仍是单一代码块");
  assert.equal(
    (await block.locator(".trd-ln-text").allTextContents()).join("\n"),
    code,
  );
  assert.deepEqual(
    await block.locator(".trd-ln-no").allTextContents(),
    code.split("\n").map((_, i) => String(i + 1)),
  );
  const before = await block.boundingBox();
  const first = block.locator('[data-line="1"]');
  await first.hover();
  const popup = page.getByRole("tooltip");
  await popup.waitFor({ state: "visible" });
  assert.equal(await block.locator(".is-annotation-active").count(), 2);
  assert.equal(await block.locator(".trd-code-selection-range").count(), 1);
  assert.ok(
    (await block.locator(".trd-code-selection-range").boundingBox()).height >=
      2 * 18,
  );
  assert.deepEqual(
    await block
      .locator(".is-annotation-active")
      .evaluateAll((lines) =>
        lines.map((line) => getComputedStyle(line).outlineStyle),
      ),
    ["none", "none"],
  );

  assert.ok((await popup.textContent()).includes(annotations[0].title));
  assert.deepEqual(await block.boundingBox(), before, "浮层不挤压代码布局");
  assert.equal(
    await popup.evaluate((e) => getComputedStyle(e).position),
    "fixed",
  );
  await popup.hover();
  await popup.waitFor({ state: "visible" });
  await page.waitForTimeout(200); // Longer than the pointer-gap close delay.
  assert.equal(await popup.isVisible(), true, "跨越间隙进入浮层后保持可读");
  await block.locator('[data-line="3"]').focus();
  await popup.waitFor({ state: "visible" });
  assert.equal(await block.locator(".is-annotation-active").count(), 4);
  // A continuous scroll burst cannot reopen from moving code lines, including
  // another pane/ancestor; scrolling the tooltip's content remains readable.
  await popup.evaluate((el) =>
    el.firstElementChild.dispatchEvent(
      new el.ownerDocument.defaultView.Event("scroll", { bubbles: false }),
    ),
  );
  assert.equal(await popup.isVisible(), true);
  for (let i = 0; i < 5; i++) {
    await dialog.locator(".rich-detail-body").dispatchEvent("scroll");
    await first.dispatchEvent("mouseover");
    await first.dispatchEvent("mousemove");
    assert.equal(await popup.count(), 0, "no tooltip during scroll burst");
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(210);
  await first.hover();
  await popup.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true, "Escape只关闭注释，不关闭详情");
  await first.focus();
  await popup.waitFor({ state: "visible" });
  await page.setViewportSize({ width: 700, height: 600 });
  await popup.waitFor({ state: "detached" });
  await first.hover();
  await popup.waitFor({ state: "visible" });
  const box = await popup.boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 700 &&
      box.y + box.height <= 600,
  );
  console.log(
    "code annotations: schema, intact source, scoped highlight, floating card, keyboard and narrow viewport passed",
  );
} finally {
  await browser.close();
}
