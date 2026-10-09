import { createSsrTestServer } from "./ssr-test-server.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const server = await createSsrTestServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const richContentModule = await server.ssrLoadModule(
    "/src/lib/richContent/index.ts",
  );
  const { renderOverviewCell, renderRowExtras } = richContentModule;
  assert.equal(typeof renderOverviewCell, "function");
  const render = (row, column) =>
    renderToStaticMarkup(renderOverviewCell(row, column));
  const sample = JSON.parse(
    readFileSync(
      new URL(
        "../src/samples/video-conversion-shooting-guide.review.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const rows = sample.components.flatMap((component) => component.mapping);
  const html = rows
    .flatMap((row) =>
      ["requirement", "change", "api"].map((column) => render(row, column)),
    )
    .join("\n");
  assert.ok((html.match(/class="trd-codeblk"/g) ?? []).length >= 6);
  for (const marker of [
    "ProductIdeationData.short_selling_points",
    "ProductIdeationData.video_tips",
    "示例",
  ]) {
    assert.ok(html.includes(marker), "missing full rich marker: " + marker);
  }
  const plain = {
    id: "plain",
    requirement: "FULL_REQUIREMENT",
    change: "FULL_CHANGE",
    api: { summary: "FULL_API" },
  };
  const headed = {
    ...plain,
    trd: {
      technical: { heading: "LEGACY_HEADING", bullets: ["UNIQUE_DETAIL"] },
    },
  };
  assert.match(render(headed, "change"), /LEGACY_HEADING/);
  const detailBody = renderToStaticMarkup(
    renderOverviewCell(headed, "change", undefined, false),
  );
  assert.doesNotMatch(detailBody, /LEGACY_HEADING/);
  assert.match(detailBody, /UNIQUE_DETAIL/);
  const { ComponentDetails } = await server.ssrLoadModule(
    "/src/components/details/ComponentDetails.tsx",
  );
  const props = {
    component: { id: "plain", label: "Unique component", mapping: [plain] },
    index: 0,
    total: 1,
    onFieldClick() {},
    onClose() {},
    onSwitch() {},
  };
  const componentHtml = renderToStaticMarkup(
    createElement(ComponentDetails, {
      ...props,
      breadcrumbs: [
        { kind: "component", id: "plain", label: "Unique component" },
      ],
    }),
  );
  assert.doesNotMatch(
    componentHtml,
    /trd-summary|<h2>|按功能点对照|TRD REVIEW/,
  );
  assert.match(componentHtml, /aria-current="page"/);
  assert.match(componentHtml, /FULL_REQUIREMENT/);
  assert.match(componentHtml, /FULL_CHANGE/);
  assert.match(componentHtml, /返回总览/);
  assert.match(
    renderToStaticMarkup(createElement(ComponentDetails, props)),
    /<h2>Unique component<\/h2>/,
  );
  for (const [column, value] of [
    ["requirement", "FULL_REQUIREMENT"],
    ["change", "FULL_CHANGE"],
    ["api", "FULL_API"],
  ]) {
    assert.ok(render(plain, column).includes(value));
    assert.ok(
      render(
        { ...plain, overviewSummary: { [column]: "SHORT_ONLY" } },
        column,
      ).includes(value),
    );
    assert.ok(
      !render(
        { ...plain, overviewSummary: { [column]: "SHORT_ONLY" } },
        column,
      ).includes("SHORT_ONLY"),
    );
  }
  const malicious = "<script>window.bad=1</script><img src=x onerror=alert(1)>";
  const escaped = render(
    {
      ...plain,
      trd: { technical: { pseudoCode: malicious, codeLabel: "示例" } },
    },
    "change",
  );
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.ok(escaped.includes("&lt;img"));
  assert.doesNotMatch(escaped, /<script[\s>]|<img[\s>]/i);
  const field = (name) => ({
    name,
    type: "string",
    meaning: name + " meaning",
  });
  const apiRow = {
    ...plain,
    api: { summary: "API", fields: [field("root.field"), field("item.field")] },
    trd: {
      apiChange: {
        fields: [field("col.field"), field("item.field")],
        items: [{ title: "Contract", fields: [field("item.field")] }],
      },
    },
  };
  const api = render(apiRow, "api");
  for (const name of ["root.field", "col.field", "item.field"]) {
    assert.equal(
      api.split("<code>" + name + "</code>").length - 1,
      1,
      "field container must be deduplicated",
    );
    assert.ok(api.includes(name + " meaning"));
  }
  const metaRow = {
    ...plain,
    codePaths: ["src/example.ts"],
    reviewBrief: { status: "提案", visibleChange: "可见变化" },
    cross: { note: "CROSS_NOTE", flow: ["CROSS_FLOW"], edge: ["CROSS_EDGE"] },
  };
  // 分层去重：列内容不再携带行级 meta（chips / codePaths / cross），
  // 行级 meta 由 renderRowExtras 统一渲染一次。
  const metadata = render(metaRow, "requirement");
  for (const value of [
    "src/example.ts",
    "提案",
    "可见变化",
    "CROSS_NOTE",
    "CROSS_FLOW",
    "CROSS_EDGE",
  ]) {
    assert.ok(!metadata.includes(value), "列内容不应重复行级 meta: " + value);
  }
  const extras = renderToStaticMarkup(renderRowExtras(metaRow));
  for (const value of [
    "src/example.ts",
    "CROSS_NOTE",
    "CROSS_FLOW",
    "CROSS_EDGE",
  ]) {
    assert.ok(extras.includes(value), "renderRowExtras 缺少: " + value);
  }
  const { createFeedbackDocument, parseFeedback, serializeFeedback } =
    await server.ssrLoadModule("/src/lib/davidFeedback.ts");
  const selection = {
    version: 1,
    kind: "appearance-selection",
    capturedAt: "2026-09-06T00:00:00Z",
    surface: "shell",
    scene: { pageId: "default" },
    viewport: { width: 1440, height: 1000 },
    windowScroll: { x: 0, y: 0 },
    rect: { nx: 0.1, ny: 0.1, nw: 0.2, nh: 0.2 },
    targets: [{ targetId: "shell:header", label: "页头", kind: "shell" }],
  };
  const feedback = createFeedbackDocument("schema-check");
  feedback.entries.push({
    id: "entry",
    category: "visual",
    suggestion: "外观建议",
    createdAt: selection.capturedAt,
    scope: { selection },
  });
  assert.deepEqual(
    JSON.parse(serializeFeedback(parseFeedback(feedback))).entries[0].scope
      .selection,
    selection,
  );
  for (const mutate of [
    (s) => {
      s.extra = true;
    },
    (s) => {
      s.scene.secret = "no";
    },
    (s) => {
      s.viewport.width = Infinity;
    },
    (s) => {
      s.rect.nx = 0.95;
    },
    (s) => {
      s.targets[0].label = null;
    },
    (s) => {
      s.targets[0].script = "no";
    },
  ]) {
    const invalid = JSON.parse(JSON.stringify(feedback));
    mutate(invalid.entries[0].scope.selection);
    assert.throws(() => parseFeedback(invalid));
  }
  assert.doesNotThrow(() => parseFeedback(createFeedbackDocument("legacy")));
  console.log(
    "test-rich-review: full renderer, fallback, escaping, metadata and selection schema passed",
  );
} finally {
  await server.close();
}
