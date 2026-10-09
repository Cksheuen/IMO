import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
import { createSsrTestServer } from "./ssr-test-server.mjs";
import { fixture } from "./review-fixes-fixture.mjs";
import { assertPreparation } from "../src/lib/preparationModel.ts";
import { validateChangeBlock } from "../src/lib/changeModel.ts";
import { auditReviewAuthoring } from "../src/lib/authoringAudit.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "david-review-quality-"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const preparation = {
  id: "app-setup",
  title: "工程准备",
  tasks: [{ id: "files", label: "创建目录" }],
  fields: [{ id: "resource", label: "资源链接", placeholder: "填写链接" }],
};
assertPreparation(preparation, "test");
for (const invalid of [
  { ...preparation, unknown: true },
  { ...preparation, fields: [{ id: "files", label: "重复" }] },
  { ...preparation, tasks: [], fields: [] },
])
  assert.throws(() => assertPreparation(invalid, "test"));
const annotations = (title) => [
  {
    startLine: 1,
    endLine: 2,
    title,
    bullets: ["该范围说明真实调用与状态变化。"],
  },
];
const changeBlock = {
  kind: "modify",
  rationale: "保留单选约束并改变状态入口",
  before: {
    code: `const oldValue = "${"old-value-".repeat(50)}";\nsetOldValue(oldValue);`,
    codeAnnotations: annotations("现有逻辑"),
  },
  after: {
    code: `const nextValue = "${"new-value-".repeat(50)}";\nsetNextValue(nextValue);`,
    codeAnnotations: annotations("改造逻辑"),
  },
};
const sharedTail = Array.from(
  { length: 40 },
  (_, i) => `commonLine${i}();`,
).join("\n");
changeBlock.before.code += "\n" + sharedTail;
changeBlock.after.code += "\n" + sharedTail;
assert.deepEqual(validateChangeBlock(changeBlock), []);
const invalidBlock = clone(changeBlock);
invalidBlock.after.codeAnnotations[0].endLine = 999;
assert.ok(validateChangeBlock(invalidBlock).length);
const invalidText = clone(changeBlock);
invalidText.after.text = invalidText.after.code;
delete invalidText.after.code;
assert.ok(validateChangeBlock(invalidText).length);
const spec = fixture({ title: "Review quality" });
spec.pages[0].kind = "screen";
const row = spec.components[0].mapping[0];
row.requirement = "展示简短需求";
row.trd = {
  productDesign: {
    summary: "展示简短需求",
    bullets: ["可读的说明", "完整显示，无需弹窗"],
  },
  technical: { summary: "准备工作与迁移实现" },
};
row.preparation = preparation;
row.changeBlock = changeBlock;
spec.components[1].mapping[0].preparation = preparation;
spec.components[1].mapping[0].trd = {
  technical: {
    techPoints: [
      {
        title: "普通代码行背景",
        pseudoCode: `const payload = "${"payload-".repeat(60)}";\n+ apply(payload);\n~ track(payload);`,
        codeAnnotations: [
          {
            startLine: 2,
            endLine: 3,
            title: "短行说明",
            bullets: ["改动行与埋点行都覆盖完整滚动内容宽度。"],
          },
        ],
      },
    ],
  },
};
const before = JSON.stringify(spec);
const bad = clone(spec);
bad.components[0].mapping[0].requirement = "☐ 尚未创建";
bad.components[0].mapping[0].change = "长".repeat(351);
bad.components[0].mapping[0].api.fields = [{ name: "items", type: "array" }];
bad.components[0].mapping[0].trd.technical = {
  techPoints: [{ pseudoCode: "const x = 1", bullets: ["duplicate"] }],
};
assert.deepEqual(
  new Set(auditReviewAuthoring(bad).map((f) => f.code)),
  new Set([
    "fake-control",
    "dense-summary",
    "vague-data-type",
    "duplicate-code-explanation",
  ]),
);
assert.equal(JSON.stringify(spec), before);
const ssr = await createSsrTestServer({ server: { middlewareMode: true } });
try {
  const { parseReviewSpec } = await ssr.ssrLoadModule("/src/lib/reviewSpec.ts");
  parseReviewSpec(spec);
  for (const mutate of [
    (s) => {
      s.components[0].mapping[0].preparation = {
        ...preparation,
        tasks: [],
        fields: [],
      };
    },
    (s) => {
      s.components[0].mapping[0].changeBlock = invalidBlock;
    },
    (s) => {
      s.components[0].mapping[0].changeBlock = invalidText;
    },
  ]) {
    const invalid = clone(spec);
    mutate(invalid);
    assert.throws(() => parseReviewSpec(invalid));
    const input = path.join(temp, "invalid.json");
    fs.writeFileSync(input, JSON.stringify(invalid));
    for (const renderer of [
      "scripts/render-review.mjs",
      "../scripts/render-review.mjs",
    ])
      assert.throws(() =>
        execFileSync(
          process.execPath,
          [renderer, input, path.join(temp, "invalid.html")],
          { cwd: project, stdio: "pipe" },
        ),
      );
  }
  const input = path.join(temp, "valid.json");
  fs.writeFileSync(input, JSON.stringify(spec));
  for (const renderer of [
    "scripts/render-review.mjs",
    "../scripts/render-review.mjs",
  ])
    execFileSync(
      process.execPath,
      [renderer, input, path.join(temp, "valid.html")],
      { cwd: project, stdio: "pipe" },
    );
} finally {
  await ssr.close();
}
const service = await startBrowserFeedbackService();
const otherService = await startBrowserFeedbackService();
spec.service = { baseUrl: service.baseUrl };
service.seed(spec.slug, {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: spec.slug,
  mode: "integrated",
  updatedAt: "2026-09-11T00:00:00Z",
  entries: [
    {
      id: "source-one",
      category: "visual",
      suggestion: "Only in the first service",
      createdAt: "2026-09-11T00:00:00Z",
    },
  ],
});
const vite = await startViteServer(project);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(10000);
await service.attach(page);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const importSpec = async () => {
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.locator("h1.title", { hasText: spec.title }).waitFor();
};
try {
  await page.goto(vite.baseUrl);
  await importSpec();
  const overviewRow = page.locator(
    '.david-overview tr[data-mapping-id="a:row-a"]',
  );
  const summary = overviewRow.locator('[data-preparation-id="app-setup"]');
  assert.equal(
    await summary.locator("details, input, summary").count(),
    0,
    "overview preparation cannot expand layout",
  );
  const rowHeight = (await overviewRow.boundingBox()).height;
  await summary.click();
  assert.equal((await overviewRow.boundingBox()).height, rowHeight);
  await overviewRow
    .getByRole("button", { name: "查看实现", exact: true })
    .click();
  const overviewForm = page.locator(
    '.rich-detail [data-preparation-id="app-setup"]',
  );
  await overviewForm
    .getByLabel("资源链接", { exact: true })
    .fill("https://example.test/from-overview");
  await page.locator(".rich-detail-close").click();
  assert.ok((await summary.innerText()).includes("已填写 1/1"));
  await page.getByTestId("overview-component-a").click();
  const requirement = page.locator(
    '.inspector [data-trd-row="row-a"] [data-disclosure-column="requirement"]',
  );
  assert.ok((await requirement.innerText()).includes("完整显示，无需弹窗"));
  assert.equal(
    await requirement
      .getByRole("button", { name: "查看设计", exact: true })
      .count(),
    0,
  );
  const panel = page.locator('.inspector [data-preparation-id="app-setup"]');
  await panel.getByLabel("创建目录", { exact: true }).check();
  await panel
    .getByLabel("资源链接", { exact: true })
    .fill("https://example.test/design");
  await page.reload();
  await importSpec();
  await page.getByTestId("overview-component-b").click();
  assert.equal(
    await panel.getByLabel("创建目录", { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await panel.getByLabel("资源链接", { exact: true }).inputValue(),
    "https://example.test/design",
  );
  await page
    .locator('.inspector [data-trd-row="row-b"]')
    .getByRole("button", { name: "查看实现", exact: true })
    .click();
  await page.locator(".rich-detail .trd-track-toggle").click();
  const normalCoverage = await page
    .locator(".rich-detail .trd-cb-body")
    .evaluate((body) => {
      body.scrollLeft = body.scrollWidth;
      return [...body.querySelectorAll(".is-highlight, .is-track")].map(
        (line) => ({
          width: line.getBoundingClientRect().width,
          scrollWidth: body.scrollWidth,
          background: getComputedStyle(line).backgroundColor,
        }),
      );
    });
  assert.equal(normalCoverage.length, 2);
  assert.ok(
    normalCoverage.every(
      (line) =>
        line.width >= line.scrollWidth - 1 &&
        line.background !== "rgba(0, 0, 0, 0)",
    ),
    JSON.stringify(normalCoverage),
  );
  await page.locator(".rich-detail-close").click();
  await page
    .getByTestId("david-breadcrumb")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.getByTestId("overview-component-a").click();
  await page
    .locator('.inspector [data-trd-row="row-a"]')
    .getByRole("button", { name: "查看实现", exact: true })
    .click();
  const blocks = page.locator(".rich-detail .trd-codeblk");
  assert.equal(await blocks.count(), 2);
  for (const [i, title] of ["现有逻辑", "改造逻辑"].entries()) {
    await page.mouse.move(5, 5);
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    await blocks.nth(i).locator('[data-line="1"]').hover();
    await page.getByRole("tooltip").filter({ hasText: title }).waitFor();
    assert.equal(
      await blocks.nth(i).locator(".is-annotation-active").count(),
      2,
    );
  }
  const alignment = await page
    .locator(".rich-detail .dv-diff")
    .evaluate((el) => {
      const panes = [...el.querySelectorAll(".dv-diff-pane")];
      return panes.map((pane) =>
        [...pane.querySelectorAll("[data-diff-row]")].map((line) => ({
          row: line.getAttribute("data-diff-row"),
          source: line.getAttribute("data-line"),
          kind: line.getAttribute("data-diff-kind"),
          top: line.getBoundingClientRect().top,
          height: line.getBoundingClientRect().height,
        })),
      );
    });
  assert.equal(alignment[0].length, 44);
  for (let i = 0; i < 44; i++) {
    assert.ok(Math.abs(alignment[0][i].top - alignment[1][i].top) < 1);
    assert.equal(alignment[0][i].height, alignment[1][i].height);
  }
  assert.equal(alignment[0][0].kind, "removed");
  assert.equal(alignment[1][0].source, null);
  assert.equal(alignment[0][2].source, null);
  assert.equal(alignment[1][2].kind, "added");
  for (const pane of await page.locator(".rich-detail .dv-diff-pane").all()) {
    const coverage = await pane.evaluate((el) => {
      const body = el.querySelector(".trd-cb-body");
      body.scrollLeft = body.scrollWidth;
      const viewport = body.getBoundingClientRect();
      return [...body.querySelectorAll(".trd-ln:not(.is-diff-same)")].map(
        (line) => ({
          kind: line.getAttribute("data-diff-kind"),
          width: line.getBoundingClientRect().width,
          scrollWidth: body.scrollWidth,
          right: line.getBoundingClientRect().right,
          visibleRight: viewport.right,
        }),
      );
    });
    assert.ok(
      coverage.every(
        (row) =>
          row.width >= row.scrollWidth - 1 && row.right >= row.visibleRight - 2,
      ),
      JSON.stringify(coverage),
    );
    await pane.locator(".trd-cb-body").evaluate((el) => {
      el.scrollLeft = 0;
    });
  }
  await page
    .locator(".rich-detail .dv-diff .trd-cb-body")
    .first()
    .evaluate((el) => {
      el.scrollTop = 200;
      el.dispatchEvent(new globalThis.Event("scroll", { bubbles: true }));
    });
  await page.waitForFunction(() => {
    const bodies = [
      ...document.querySelectorAll(".rich-detail .dv-diff .trd-cb-body"),
    ];
    return (
      bodies[0].scrollTop > 0 && bodies[0].scrollTop === bodies[1].scrollTop
    );
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await panel.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  assert.equal(overflow, false);
  assert.equal(
    await page.locator('[data-feedback-id="source-one"]').count(),
    1,
  );
  await otherService.attach(page);
  spec.service = { baseUrl: otherService.baseUrl };
  await importSpec();
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#david-agent-feedback").textContent)
        .entries.length === 0,
  );
  await page.getByTestId("overview-component-a").click();
  await page.evaluate(() => {
    globalThis.Storage.prototype.setItem = () => {
      throw new Error("disabled");
    };
  });
  await panel.getByLabel("资源链接", { exact: true }).fill("kept-in-memory");
  await panel
    .getByRole("status")
    .filter({ hasText: "浏览器存储不可用" })
    .waitFor();
  assert.equal(
    await panel.getByLabel("资源链接", { exact: true }).inputValue(),
    "kept-in-memory",
  );
  assert.deepEqual(errors, []);
  console.log(
    "[review-quality] typed controls/persistence, bounded inline prose, both diff sides hover, parser/renderer parity, authoring pattern audit passed",
  );
} finally {
  await browser.close();
  await vite.close();
  await service.close();
  await otherService.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
