#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * David schema / 纯逻辑层独立测试（不依赖构建产物）。
 * - render-review.mjs 接受临时递归 spec、拒绝 duplicate id 与缺失 anchor
 * - 旧 spec（无 nodes）向后兼容
 * - 静态断言 reviewTree / davidFeedback / reviewSpec 关键 contract
 * 所有产物写入 mkdtemp 临时目录，绝不写 repo。
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const renderScript = path.join(projectRoot, "scripts", "render-review.mjs");

const failures = [];
const check = (name, condition) => {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL - ${name}`);
  }
};

const TEMPLATE =
  "<!doctype html><html><head><title>{{TITLE}}</title></head>" +
  '<body><h1>{{SUBTITLE}}</h1>{{PAGE_HTML}}<script type="application/json" data-review-data>{{REVIEW_DATA_JSON}}</script></body></html>';

const baseRow = (id) => ({
  id,
  requirement: `需求 ${id}`,
  change: `改动 ${id}`,
  api: { summary: "api" },
});

const recursiveSpec = () => ({
  slug: "david-model-test",
  title: "David model",
  subtitle: "递归节点模型",
  pageHtml:
    '<div class="page">' +
    '<div data-review-node-id="card-root">root</div>' +
    '<div data-review-node-id="card-child">child</div>' +
    "</div>",
  components: [
    {
      id: "card",
      label: "Card",
      interaction: "auto",
      mapping: [baseRow("m1")],
      children: [
        {
          id: "card-root",
          label: "Root node",
          interaction: "drilldown",
          mappingIds: ["m1"],
          deepDive: { summary: ["s"], logic: ["l"], tests: ["t"] },
          children: [
            { id: "card-child", label: "Leaf", interaction: "highlight" },
          ],
        },
      ],
    },
  ],
  overview: { title: "Overview", summary: "sum", mapping: [baseRow("o1")] },
});

const appendFieldAnchor = (spec, id) => {
  spec.pageHtml = spec.pageHtml.replace(
    /<\/div>$/,
    `<div data-api-field="${id}">${id}</div></div>`,
  );
  return spec;
};

const completeOverviewSpec = () => {
  const spec = appendFieldAnchor(recursiveSpec(), "overview-field");
  spec.overview = {
    title: "Complete overview",
    summary: "overview summary",
    mapping: [
      {
        ...baseRow("o1"),
        api: {
          summary: "overview api",
          fields: [{ name: "overview-field", target: "overview-field" }],
        },
        trd: {
          apiChange: {
            items: [
              {
                title: "Nested overview field",
                fields: [{ name: "overview-field", target: "overview-field" }],
              },
            ],
          },
        },
      },
    ],
  };
  return spec;
};

const invalidOverviewNestedAnchorSpec = () => {
  const spec = completeOverviewSpec();
  spec.overview.mapping[0].trd.apiChange.items[0].fields[0].target =
    "missing-overview-field";
  return spec;
};

const childMappingSpec = () => {
  const spec = appendFieldAnchor(recursiveSpec(), "child-field");
  const node = spec.components[0].children[0];
  delete node.mappingIds;
  node.mapping = [
    {
      ...baseRow("cm1"),
      api: {
        summary: "child api",
        fields: [{ name: "child-field", target: "child-field" }],
      },
      trd: {
        apiChange: {
          items: [
            {
              fields: [{ name: "child-field", target: "child-field" }],
            },
          ],
        },
      },
    },
  ];
  return spec;
};

const oldSpec = () => ({
  slug: "david-old-test",
  title: "Old model",
  subtitle: "无 nodes 的旧 spec",
  pageHtml:
    '<div data-component-id="legacy" data-review-target="legacy">legacy</div>',
  components: [
    { id: "legacy", label: "Legacy", mapping: [baseRow("legacy-m1")] },
  ],
});

const duplicateSpec = () => {
  const spec = recursiveSpec();
  spec.components[0].children[0].children.push({
    id: "card-child",
    label: "Dup",
    interaction: "highlight",
  });
  return spec;
};

const duplicateRootSpec = () => {
  const spec = recursiveSpec();
  spec.components.push({
    id: spec.components[0].children[0].id,
    label: "Later colliding root",
    mapping: [baseRow("m2")],
  });
  return spec;
};

const escapedScriptSpec = () => {
  const spec = recursiveSpec();
  spec.title = "</script><img src=x onerror=alert(1)>";
  spec.subtitle = "Tom & Jerry \"quote\" 'apos' \u2028 \u2029";
  spec.components[0].mapping[0].requirement =
    "payload </script> \u2028 \u2029 {{TITLE}}";
  return spec;
};

const missingAnchorSpec = () => {
  const spec = recursiveSpec();
  spec.pageHtml = '<div class="page"></div>';
  return spec;
};

const noInteractionSpec = () => {
  const spec = recursiveSpec();
  delete spec.components[0].interaction;
  delete spec.components[0].children[0].interaction;
  delete spec.components[0].children[0].children[0].interaction;
  return spec;
};

const leafMissingAnchorSpec = () => {
  const spec = recursiveSpec();
  spec.components[0].children[0].children.push({
    id: "card-orphan",
    label: "Orphan leaf",
    interaction: "highlight",
  });
  return spec;
};

const unknownMappingSpec = () => {
  const spec = recursiveSpec();
  spec.components[0].children[0].mappingIds = ["m1", "unknown-row"];
  return spec;
};

const invalidDeepDiveSpec = () => {
  const spec = recursiveSpec();
  spec.components[0].children[0].deepDive = { summary: "not-an-array" };
  return spec;
};

const deepSpec = () => {
  let node = { id: "n9", label: "L9", interaction: "highlight" };
  for (let depth = 8; depth >= 1; depth -= 1) {
    node = {
      id: `n${depth}`,
      label: `L${depth}`,
      interaction: "drilldown",
      children: [node],
    };
  }
  return {
    slug: "david-deep-test",
    title: "Deep model",
    subtitle: "深度超限",
    pageHtml:
      "<div>" +
      Array.from(
        { length: 9 },
        (_, i) => `<div data-review-node-id="n${i + 1}"></div>`,
      ).join("") +
      "</div>",
    components: [
      {
        id: "deep",
        label: "Deep",
        mapping: [baseRow("dm1")],
        children: [node],
      },
    ],
  };
};

const runRender = (workdir, templatePath, name, spec) => {
  const specPath = path.join(workdir, `${name}.json`);
  const outPath = path.join(workdir, `${name}.html`);
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const result = spawnSync(
    process.execPath,
    [renderScript, specPath, outPath],
    {
      encoding: "utf8",
      env: { ...process.env, DAVID_TEMPLATE_PATH: templatePath },
    },
  );
  return { result, outPath };
};

const extractReviewData = (html) => {
  const match = html.match(/data-review-data>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("rendered html 缺少 review data 脚本块");
  return JSON.parse(match[1]);
};

const main = async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "david-model-"));
  try {
    const templatePath = path.join(workdir, "template.html");
    fs.writeFileSync(templatePath, TEMPLATE);

    console.log("== render-review 递归 spec ==");
    const recursive = runRender(
      workdir,
      templatePath,
      "recursive",
      recursiveSpec(),
    );
    check("递归 spec 渲染成功", recursive.result.status === 0);
    if (recursive.result.status === 0) {
      const html = fs.readFileSync(recursive.outPath, "utf8");
      const data = extractReviewData(html);
      check(
        "overview 原样注入",
        data.overview && data.overview.title === "Overview",
      );
      check(
        "components 原样注入 children",
        Array.isArray(data.components[0].children),
      );
      check("node id 注入", JSON.stringify(data).includes("card-root"));
      check(
        "node interaction 注入",
        JSON.stringify(data).includes('"interaction":"drilldown"'),
      );
      check("deepDive 注入", JSON.stringify(data).includes('"deepDive"'));
    } else {
      console.error(recursive.result.stderr);
    }

    console.log("== overview / children mapping 完整校验 ==");
    const completeOverview = runRender(
      workdir,
      templatePath,
      "complete-overview",
      completeOverviewSpec(),
    );
    check(
      "完整 overview mapping 渲染成功",
      completeOverview.result.status === 0,
    );
    if (completeOverview.result.status === 0) {
      const data = extractReviewData(
        fs.readFileSync(completeOverview.outPath, "utf8"),
      );
      check(
        "overview nested field 原样注入",
        data.overview.mapping[0].trd.apiChange.items[0].fields[0].name ===
          "overview-field",
      );
    } else {
      console.error(completeOverview.result.stderr);
    }

    const childMapping = runRender(
      workdir,
      templatePath,
      "child-mapping",
      childMappingSpec(),
    );
    check("children mapping 渲染成功", childMapping.result.status === 0);
    if (childMapping.result.status === 0) {
      const data = extractReviewData(
        fs.readFileSync(childMapping.outPath, "utf8"),
      );
      check(
        "children mapping nested field 原样注入",
        data.components[0].children[0].mapping[0].trd.apiChange.items[0]
          .fields[0].name === "child-field",
      );
    } else {
      console.error(childMapping.result.stderr);
    }

    const invalidOverviewNestedAnchor = runRender(
      workdir,
      templatePath,
      "invalid-overview-nested-anchor",
      invalidOverviewNestedAnchorSpec(),
    );
    check(
      "overview nested field target 缺 anchor 被拒绝",
      invalidOverviewNestedAnchor.result.status !== 0 &&
        invalidOverviewNestedAnchor.result.stderr.includes(
          "无法在 pageHtml 命中",
        ),
    );

    console.log("== 旧 spec 向后兼容 ==");
    const oldResult = runRender(workdir, templatePath, "old", oldSpec());
    check("旧 spec 渲染成功", oldResult.result.status === 0);
    if (oldResult.result.status === 0) {
      const data = extractReviewData(
        fs.readFileSync(oldResult.outPath, "utf8"),
      );
      check("旧 spec 无 overview 字段", data.overview === undefined);
    } else {
      console.error(oldResult.result.stderr);
    }

    console.log("== interaction 缺省视为 auto ==");
    const noInteraction = runRender(
      workdir,
      templatePath,
      "no-interaction",
      noInteractionSpec(),
    );
    check(
      "interaction 缺省的 spec 渲染成功",
      noInteraction.result.status === 0,
    );
    if (noInteraction.result.status !== 0) {
      console.error(noInteraction.result.stderr);
    }

    console.log("== 拒绝非法 spec ==");
    const duplicate = runRender(
      workdir,
      templatePath,
      "duplicate",
      duplicateSpec(),
    );
    check(
      "duplicate node id 被拒绝",
      duplicate.result.status !== 0 && duplicate.result.stderr.includes("重复"),
    );

    const duplicateRoot = runRender(
      workdir,
      templatePath,
      "duplicate-root",
      duplicateRootSpec(),
    );
    check(
      "child id 与后续 root id 冲突被拒绝",
      duplicateRoot.result.status !== 0 &&
        duplicateRoot.result.stderr.includes("重复"),
    );

    const missingAnchor = runRender(
      workdir,
      templatePath,
      "missing-anchor",
      missingAnchorSpec(),
    );
    check(
      "缺失 data-review-node-id anchor 被拒绝",
      missingAnchor.result.status !== 0 &&
        missingAnchor.result.stderr.includes("data-review-node-id"),
    );

    const leafMissingAnchor = runRender(
      workdir,
      templatePath,
      "leaf-missing-anchor",
      leafMissingAnchorSpec(),
    );
    check(
      "叶子节点缺 anchor 被拒绝",
      leafMissingAnchor.result.status !== 0 &&
        leafMissingAnchor.result.stderr.includes("data-review-node-id"),
    );

    const unknownMapping = runRender(
      workdir,
      templatePath,
      "unknown-mapping",
      unknownMappingSpec(),
    );
    check(
      "mappingIds 引用未知 ID 被拒绝",
      unknownMapping.result.status !== 0 &&
        unknownMapping.result.stderr.includes("mappingIds"),
    );

    const invalidDeepDive = runRender(
      workdir,
      templatePath,
      "invalid-deep-dive",
      invalidDeepDiveSpec(),
    );
    check(
      "deepDive 非法被拒绝",
      invalidDeepDive.result.status !== 0 &&
        invalidDeepDive.result.stderr.includes("deepDive"),
    );

    const deep = runRender(workdir, templatePath, "deep", deepSpec());
    check(
      "深度 > 8 被拒绝",
      deep.result.status !== 0 && deep.result.stderr.includes("深度"),
    );

    console.log("== inline JSON / HTML 转义 roundtrip ==");
    const escapedScript = runRender(
      workdir,
      templatePath,
      "escaped-script",
      escapedScriptSpec(),
    );
    check("危险 payload 渲染成功", escapedScript.result.status === 0);
    if (escapedScript.result.status === 0) {
      const html = fs.readFileSync(escapedScript.outPath, "utf8");
      const data = extractReviewData(html);
      const expected = escapedScriptSpec();
      check(
        "script closing / U2028 / U2029 JSON roundtrip",
        data.title === expected.title &&
          data.subtitle === expected.subtitle &&
          data.components[0].mapping[0].requirement ===
            expected.components[0].mapping[0].requirement,
      );
      const scriptMatch = html.match(/data-review-data>([\s\S]*?)<\/script>/);
      check(
        "inline JSON 转义 script closing 与 U2028/U2029",
        Boolean(scriptMatch) &&
          !scriptMatch[1].includes("</script>") &&
          !scriptMatch[1].includes("\u2028") &&
          !scriptMatch[1].includes("\u2029") &&
          scriptMatch[1].includes("\\u003c/script\\u003e") &&
          scriptMatch[1].includes("\\u2028") &&
          scriptMatch[1].includes("\\u2029"),
      );
      check(
        "payload 中占位符不会二次替换",
        Boolean(scriptMatch) && scriptMatch[1].includes("{{TITLE}}"),
      );
      check(
        "title/subtitle HTML 转义",
        html.includes("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;") &&
          html.includes("Tom &amp; Jerry"),
      );
    } else {
      console.error(escapedScript.result.stderr);
    }

    console.log("== davidFeedback 运行断言 (plugin 安全收紧) ==");
    const feedbackModuleUrl = pathToFileURL(
      path.join(projectRoot, "src/lib/davidFeedback.ts"),
    ).href;
    const harnessSource = `
import { parsePluginDraft, pluginStorageKey, pluginMatchesSlug, pluginCssVariables, buildFeedbackIndex, createFeedbackDocument } from ${JSON.stringify(feedbackModuleUrl)};
import assert from "node:assert";
let failed = 0;
const ok = (name) => console.log("ok - " + name);
const fail = (name) => { failed += 1; console.error("FAIL - " + name); };
const base = { schema: "david-plugin/v1", schemaVersion: 1, id: "p1", name: "n", version: "1" };
const rejects = (name, patch) => {
  try { parsePluginDraft({ ...base, ...patch }); fail(name); } catch { ok(name); }
};
rejects("拒绝 url() 颜色", { theme: { paper: "url(https://x)" } });
rejects("拒绝 var() 颜色", { theme: { ink: "var(--x)" } });
rejects("拒绝 calc() 颜色", { theme: { accent: "calc(1px)" } });
rejects("拒绝 calc() radius", { theme: { radius: "calc(8px)" } });
rejects("拒绝越界 radius 33px", { theme: { radius: "33px" } });
rejects("拒绝非 px radius", { theme: { radius: "8em" } });
rejects("拒绝 calc() fontScale", { theme: { fontScale: "calc(1)" } });
rejects("拒绝越界 fontScale 1.5", { theme: { fontScale: "1.5" } });
rejects("拒绝越界 fontScale 0.7", { theme: { fontScale: "0.7" } });
rejects("拒绝超长 id", { id: "x".repeat(129) });
rejects("拒绝超量 slugs", { match: { slugs: Array.from({ length: 65 }, (_, i) => "s" + i) } });
const plugin = parsePluginDraft({ ...base, match: { slugs: ["a", "b"] }, theme: { paper: "#fff", ink: "#111111", accent: "#aabbccdd", gold: "#abc", muted: "#000000ff", radius: "8px", fontScale: "1.1" } });
try {
  assert.strictEqual(pluginStorageKey, "david:plugins");
  assert.deepStrictEqual(pluginCssVariables(plugin), { "--paper": "#fff", "--ink": "#111111", "--accent": "#aabbccdd", "--gold": "#abc", "--muted": "#000000ff", "--david-radius": "8px", "--david-font-scale": "1.1" });
  assert.strictEqual(pluginMatchesSlug(plugin, "a"), true);
  assert.strictEqual(pluginMatchesSlug(plugin, "z"), false);
  const doc = createFeedbackDocument("a", [{ id: "e1", category: "visual", suggestion: "s", createdAt: "t" }]);
  const idx = buildFeedbackIndex([doc]);
  assert.strictEqual(idx.items[0].entries.length, 1);
  assert.strictEqual(idx.items[0].entries[0].id, "e1");
  assert.strictEqual(idx.items[0].count, 1);
  ok("合法 hex 映射 / slug match / index entries");
} catch (e) { fail("合法 hex 映射 / slug match / index entries: " + e.message); }
process.exit(failed > 0 ? 1 : 0);
`;
    const harnessPath = path.join(workdir, "plugin-runtime.mjs");
    fs.writeFileSync(harnessPath, harnessSource);
    const runtime = spawnSync(process.execPath, [harnessPath], {
      encoding: "utf8",
    });
    check("plugin 运行断言全部通过", runtime.status === 0);
    if (runtime.status !== 0) {
      console.error(runtime.stdout);
      console.error(runtime.stderr);
    }

    console.log(
      "== reviewSpec 新契约校验（component.source / pages.kind / node.canvas / collaboration）==",
    );
    const reviewSpecUrl = pathToFileURL(
      path.join(projectRoot, "src/lib/reviewSpec.ts"),
    ).href;
    const { parseReviewSpec } = await import(reviewSpecUrl);
    const validSpec = (over = {}) => ({
      slug: "contract",
      title: "Contract",
      subtitle: "契约校验",
      pages: [
        {
          id: "p1",
          label: "P1",
          pageHtml:
            '<div class="page"><div data-review-node-id="n1">x</div></div>',
        },
      ],
      components: [
        {
          id: "c1",
          label: "C1",
          mapping: [baseRow("m1")],
          children: [
            {
              id: "n1",
              label: "N1",
              interaction: "highlight",
              mappingIds: ["m1"],
            },
          ],
        },
      ],
      ...over,
    });
    const specRejects = (name, buildSpec) => {
      try {
        parseReviewSpec(buildSpec());
        check(name, false);
      } catch {
        check(name, true);
      }
    };

    // A) component.source：合法 component 真渲染 + 复用证据通过
    try {
      const parsed = parseReviewSpec(
        validSpec({
          components: [
            {
              id: "c1",
              label: "C1",
              mapping: [baseRow("m1")],
              source: {
                kind: "component",
                codePaths: ["src/components/C1.tsx"],
                probe: "grep C1",
                fidelity: "pixel-vs-real",
                renderEvidence: {
                  recipe: "snapshot:c1",
                  viewport: "393x852",
                  screenshot: "evidence/c1.png",
                },
              },
              children: [
                {
                  id: "n1",
                  label: "N1",
                  interaction: "highlight",
                  mappingIds: ["m1"],
                },
              ],
            },
          ],
        }),
      );
      check(
        "A component.source（kind=component + codePaths + fidelity=pixel-vs-real）通过",
        parsed.data.components[0].source?.kind === "component",
      );
    } catch (e) {
      console.error(e);
      check(
        "A component.source（kind=component + codePaths + fidelity=pixel-vs-real）通过",
        false,
      );
    }
    specRejects("A-reject source.kind 非法", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            source: { kind: "hack" },
          },
        ],
      }),
    );
    specRejects("A-reject kind=component 无 codePaths（缺真实组件证据）", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            source: { kind: "component" },
          },
        ],
      }),
    );
    specRejects("A-reject css-art 声称 pixel-vs-real（无证据 1:1）", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            children: [],
            source: {
              kind: "css-art",
              codePaths: ["mock/c1.html"],
              fidelity: "pixel-vs-real",
            },
          },
        ],
      }),
    );
    specRejects("A-reject fidelity 取值非法", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            source: { kind: "component", codePaths: ["a"], fidelity: "exact" },
          },
        ],
      }),
    );
    specRejects("A-reject pixel-vs-real 缺 renderEvidence", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            children: [],
            source: {
              kind: "component",
              codePaths: ["a"],
              fidelity: "pixel-vs-real",
            },
          },
        ],
      }),
    );
    try {
      const parsed = parseReviewSpec(
        validSpec({
          components: [
            {
              id: "c1",
              label: "C1",
              mapping: [baseRow("m1")],
              children: [],
              source: {
                kind: "component",
                codePaths: ["src/C1.tsx"],
                renderRecipe: {
                  projectRoot: "../web-app",
                  startCommand: "pnpm dev --port 4317",
                  url: "http://127.0.0.1:4317",
                  selector: "[data-component-id=c1]",
                  viewport: "393x852",
                  readyTimeoutMs: 60000,
                },
              },
            },
          ],
        }),
      );
      check(
        "A renderRecipe 合法通过且保留",
        parsed.data.components[0].source?.renderRecipe?.url ===
          "http://127.0.0.1:4317",
      );
    } catch (e) {
      console.error(e);
      check("A renderRecipe 合法通过且保留", false);
    }
    specRejects("A-reject renderRecipe.readyTimeoutMs 越界", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            children: [],
            source: {
              kind: "component",
              codePaths: ["src/C1.tsx"],
              renderRecipe: {
                projectRoot: "../web-app",
                startCommand: "pnpm dev",
                url: "http://127.0.0.1:4317",
                readyTimeoutMs: 999,
              },
            },
          },
        ],
      }),
    );

    // B0) 结构化 scene 可独立生成画板，并归一化到 data.pages。
    try {
      const parsed = parseReviewSpec(
        validSpec({
          pages: [
            {
              id: "scene-only",
              label: "结构化画板",
              scene: {
                components: [
                  {
                    id: "card-1",
                    componentId: "c1",
                    role: "card",
                    mappingIds: ["m1"],
                    nodeId: "n1",
                    source: { file: "src/Card.tsx", selector: ".card" },
                    state: { loading: false },
                  },
                  { id: "modal-1", role: "modal" },
                ],
              },
              interactions: [
                {
                  source: "card-1",
                  action: "detail",
                  targetNodeId: "n1",
                },
              ],
            },
          ],
        }),
      );
      const page = parsed.data.pages?.[0];
      check(
        "B0 scene-only 自动生成 pageHtml 并保留 scene/interaction",
        Boolean(
          page?.pageHtml?.includes('data-scene-id="card-1"') &&
          page.pageHtml.includes('data-component-id="c1"') &&
          page.pageHtml.includes("data-review-overlay-close") &&
          page.pageHtml.includes("david-scene-modal") &&
          page.scene?.components[0]?.source?.selector === ".card" &&
          page.interactions?.[0]?.targetNodeId === "n1",
        ),
      );
    } catch (e) {
      console.error(e);
      check("B0 scene-only 自动生成 pageHtml 并保留 scene/interaction", false);
    }
    specRejects("B0-reject scene interaction source 未知", () =>
      validSpec({
        pages: [
          {
            id: "scene-only",
            label: "结构化画板",
            scene: { components: [{ id: "card-1", role: "card" }] },
            interactions: [
              { source: "missing", action: "highlight", targetNodeId: "n1" },
            ],
          },
        ],
      }),
    );
    try {
      const parsed = parseReviewSpec(
        validSpec({
          pages: [
            {
              id: "p1",
              label: "P1",
              pageHtml:
                '<div data-review-element-id="modal"></div><div data-review-node-id="n1"></div>',
              interactions: [
                {
                  source: "open",
                  trigger: "click",
                  action: "show",
                  targetElementId: "modal",
                },
                { source: "close", trigger: "click", action: "close" },
              ],
            },
          ],
        }),
      );
      check(
        "B0 overlay actions show/close 通过校验",
        parsed.pages[0].interactions?.[0]?.action === "show" &&
          parsed.pages[0].interactions?.[1]?.action === "close",
      );
    } catch (e) {
      console.error(e);
      check("B0 overlay actions show/close 通过校验", false);
    }
    specRejects("B0-reject show 缺少 targetElementId", () =>
      validSpec({
        pages: [
          {
            id: "p1",
            label: "P1",
            pageHtml: "<div></div>",
            interactions: [{ source: "open", action: "show" }],
          },
        ],
      }),
    );
    specRejects("B0-reject overlay targetElementId 未命中", () =>
      validSpec({
        pages: [
          {
            id: "p1",
            label: "P1",
            pageHtml: '<div data-review-node-id="n1"></div>',
            interactions: [
              {
                source: "open",
                action: "show",
                targetElementId: "missing-modal",
              },
            ],
          },
        ],
      }),
    );

    // B) 多页面：pages[].kind 与 node.canvas
    try {
      const parsed = parseReviewSpec(
        validSpec({
          pages: [
            {
              id: "board",
              label: "画板",
              kind: "canvas",
              pageHtml:
                '<svg xmlns="http://www.w3.org/2000/svg"><g data-review-node-id="n1"></g></svg>',
            },
          ],
          components: [
            {
              id: "c1",
              label: "C1",
              mapping: [baseRow("m1")],
              children: [
                { id: "n1", label: "N1", canvas: true, mappingIds: ["m1"] },
              ],
            },
          ],
        }),
      );
      const page = parsed.pages.find((p) => p.id === "board");
      check(
        "B pages[].kind=canvas 通过且保留；node.canvas=true 通过",
        page?.kind === "canvas" &&
          parsed.data.components[0].children?.[0].canvas === true,
      );
    } catch (e) {
      console.error(e);
      check("B pages[].kind=canvas 通过且保留；node.canvas=true 通过", false);
    }
    specRejects("B-reject pages.kind 非法", () =>
      validSpec({
        pages: [
          { id: "p1", label: "P1", kind: "tab", pageHtml: "<div></div>" },
        ],
      }),
    );
    specRejects("B-reject node.canvas 非布尔", () =>
      validSpec({
        components: [
          {
            id: "c1",
            label: "C1",
            mapping: [baseRow("m1")],
            children: [
              { id: "n1", label: "N1", canvas: "yes", mappingIds: ["m1"] },
            ],
          },
        ],
      }),
    );
    try {
      const parsed = parseReviewSpec(
        validSpec({
          pages: [
            {
              id: "board",
              label: "画板",
              kind: "canvas",
              graph: {
                nodes: [
                  { id: "a", label: "请求", status: "changed" },
                  { id: "b", label: "结果", status: "result" },
                ],
                edges: [{ from: "a", to: "b", kind: "data", label: "响应" }],
              },
              pageHtml: '<div data-review-node-id="n1"></div>',
            },
          ],
        }),
      );
      check(
        "B graph 节点/边语义通过且保留",
        parsed.pages[0].graph?.edges[0].from === "a",
      );
    } catch (e) {
      console.error(e);
      check("B graph 节点/边语义通过且保留", false);
    }
    specRejects("B-reject graph 边引用未知节点", () =>
      validSpec({
        pages: [
          {
            id: "board",
            label: "画板",
            graph: {
              nodes: [{ id: "a", label: "请求" }],
              edges: [{ from: "a", to: "ghost" }],
            },
            pageHtml: "<div></div>",
          },
        ],
      }),
    );

    // C) 多 agent 协作清单
    try {
      const parsed = parseReviewSpec(
        validSpec({
          collaboration: {
            schemaVersion: 1,
            patchOnly: true,
            pages: [{ pageId: "p1", owner: "agent-a", session: "s1" }],
            nodes: [{ ref: "n1", owner: "agent-b" }],
            lease: { holder: "agent-a", heartbeatAt: "2026-09-08T00:00:00Z" },
          },
        }),
      );
      check(
        "C collaboration 合法通过且保留",
        parsed.data.collaboration?.patchOnly === true &&
          parsed.data.collaboration?.pages?.[0]?.owner === "agent-a",
      );
    } catch (e) {
      console.error(e);
      check("C collaboration 合法通过且保留", false);
    }
    specRejects("C-reject collaboration pageId 未知", () =>
      validSpec({
        collaboration: {
          schemaVersion: 1,
          pages: [{ pageId: "ghost", owner: "a" }],
        },
      }),
    );
    specRejects("C-reject collaboration pageId 重复", () =>
      validSpec({
        collaboration: {
          schemaVersion: 1,
          pages: [
            { pageId: "p1", owner: "a" },
            { pageId: "p1", owner: "b" },
          ],
        },
      }),
    );
    specRejects("C-reject collaboration node ref 重复", () =>
      validSpec({
        collaboration: {
          schemaVersion: 1,
          nodes: [
            { ref: "n1", owner: "a" },
            { ref: "n1", owner: "b" },
          ],
        },
      }),
    );
    specRejects("C-reject collaboration schemaVersion 非 1", () =>
      validSpec({
        collaboration: {
          schemaVersion: 2,
          pages: [{ pageId: "p1", owner: "a" }],
        },
      }),
    );
    specRejects("C-reject collaboration 缺 owner", () =>
      validSpec({
        collaboration: {
          schemaVersion: 1,
          nodes: [{ ref: "n1" }],
        },
      }),
    );

    // 向后兼容：不带 source / collaboration / pages.kind 的旧 spec 照常通过
    try {
      parseReviewSpec(recursiveSpec());
      check("向后兼容：旧 spec（无 source/collaboration/kind）通过", true);
    } catch (e) {
      console.error(e);
      check("向后兼容：旧 spec（无 source/collaboration/kind）通过", false);
    }

    console.log("== davidFeedback 回复/状态 + davidBridge 剪贴板信封断言 ==");
    const ssrServer = await createSsrTestServer({
      server: { middlewareMode: true },
    });
    try {
      const {
        parseFeedback,
        appendFeedbackReply,
        setFeedbackEntryStatus,
        setFeedbackEntrySuggestion,
        mergeFeedbackDocuments,
        replyAuthor,
        DAVID_REPLY_MAX_LENGTH,
        DAVID_MAX_REPLIES_PER_ENTRY,
      } = await ssrServer.ssrLoadModule("/src/lib/davidFeedback.ts");
      const { reviewForPage } = await ssrServer.ssrLoadModule(
        "/src/lib/reviewTree.ts",
      );
      const { parseReviewSpec } = await ssrServer.ssrLoadModule(
        "/src/lib/reviewSpec.ts",
      );
      const { shouldInlineDisclosure } = await ssrServer.ssrLoadModule(
        "/src/lib/disclosureContent.ts",
      );
      const pageA = {
        id: "a",
        label: "页面 A",
        pageHtml: '<section data-component-id="a"></section>',
        overview: { summary: "创建于 apps/a" },
      };
      const pageB = {
        id: "b",
        label: "页面 B",
        pageHtml: '<section data-component-id="b"></section>',
        scene: {
          components: [{ id: "infra", componentId: "infra", role: "logic" }],
        },
      };
      const pageData = {
        title: "整体",
        subtitle: "全局描述",
        pages: [pageA, pageB],
        overview: {
          summary: "不应串页",
          mapping: [{ ...baseRow("a:r"), id: "a:r" }, baseRow("unknown")],
        },
        components: ["a", "b", "infra"].map((id) => ({
          id,
          label: id,
          mapping: [baseRow("r")],
        })),
      };
      const beforeScope = JSON.stringify(pageData);
      assert.deepStrictEqual(
        reviewForPage(pageData, pageA).components.map((c) => c.id),
        ["a"],
      );
      assert.deepStrictEqual(
        reviewForPage(pageData, pageB).components.map((c) => c.id),
        ["b", "infra"],
      );
      assert.equal(
        reviewForPage(pageData, pageA).overview.summary,
        "创建于 apps/a",
      );
      assert.equal(reviewForPage(pageData, pageB).overview.summary, "");
      assert.deepStrictEqual(
        reviewForPage(pageData, pageB).overview.mapping,
        [],
      );
      assert.equal(JSON.stringify(pageData), beforeScope);
      const legacy = { ...pageData, pages: undefined };
      assert.equal(
        reviewForPage(legacy, {
          id: "default",
          label: "页面",
          pageHtml: "<main>legacy</main>",
        }),
        legacy,
      );
      const source = recursiveSpec();
      const scoped = {
        ...source,
        pages: [
          {
            id: "main",
            label: "主页面",
            pageHtml: source.pageHtml,
            overview: { title: "工程落点", summary: "apps/main" },
          },
        ],
      };
      assert.equal(
        parseReviewSpec(scoped).pages[0].overview.summary,
        "apps/main",
      );
      const overviewRender = runRender(
        workdir,
        templatePath,
        "page-overview",
        scoped,
      );
      assert.equal(
        overviewRender.result.status,
        0,
        overviewRender.result.stderr,
      );
      assert.equal(
        extractReviewData(fs.readFileSync(overviewRender.outPath, "utf8"))
          .pages[0].overview.summary,
        "apps/main",
      );
      const badOverviewRender = runRender(
        workdir,
        templatePath,
        "page-overview-invalid",
        {
          ...scoped,
          pages: [{ ...scoped.pages[0], overview: { summary: 1 } }],
        },
      );
      assert.notEqual(badOverviewRender.result.status, 0);

      assert.throws(
        () =>
          parseReviewSpec({
            ...scoped,
            pages: [{ ...scoped.pages[0], overview: { summary: 1 } }],
          }),
        /overview/,
      );
      const prose = {
        ...baseRow("short-prose"),
        trd: { productDesign: { bullets: ["a".repeat(70), "b".repeat(70)] } },
      };
      assert.equal(
        shouldInlineDisclosure(prose, "requirement", "overview"),
        false,
      );
      assert.equal(shouldInlineDisclosure(prose, "requirement", "node"), true);
      check(
        "page-scoped overview preserves source, HTML/scene ownership and legacy single pages",
        true,
      );

      const {
        AGENT_CLIPBOARD_HEADER,
        buildAgentClipboardPayload,
        parseAgentClipboardPayload,
      } = await ssrServer.ssrLoadModule("/src/lib/davidBridge.ts");

      const ok = (name) => check(name, true);
      const fail = (name, extra) =>
        check(extra ? `${name}: ${extra}` : name, false);
      const rejects = (name, fn) => {
        try {
          fn();
          check(name, false);
        } catch {
          check(name, true);
        }
      };

      const baseEntry = {
        id: "e1",
        category: "visual",
        suggestion: "s",
        createdAt: "t1",
      };
      const baseDoc = {
        schema: "david-feedback/v1",
        schemaVersion: 1,
        slug: "a",
        updatedAt: "u",
        mode: "integrated",
        entries: [baseEntry],
      };

      try {
        const parsed = parseFeedback(baseDoc);
        assert.strictEqual(parsed.entries[0].status, "open");
        assert.ok(!("replies" in parsed.entries[0]));
        assert.strictEqual(parsed.entries[0].id, "e1");
        assert.strictEqual(parsed.entries[0].createdAt, "t1");
        ok("旧条目无 status/replies 仍可读且 status 归一化为 open");
      } catch (e) {
        fail(
          "旧条目无 status/replies 仍可读且 status 归一化为 open",
          e.message,
        );
      }

      try {
        const doc = {
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              status: "resolved",
              replies: [{ id: "r1", body: "b", createdAt: "t2" }],
            },
          ],
        };
        const parsed = parseFeedback(doc);
        assert.strictEqual(parsed.entries[0].status, "resolved");
        assert.strictEqual(parsed.entries[0].replies[0].id, "r1");
        ok("带 status/replies 的条目可解析");
      } catch (e) {
        fail("带 status/replies 的条目可解析", e.message);
      }

      rejects("拒绝重复 entry id", () =>
        parseFeedback({
          ...baseDoc,
          entries: [baseEntry, { ...baseEntry, id: "e1" }],
        }),
      );
      rejects("拒绝重复 reply id", () =>
        parseFeedback({
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              replies: [
                { id: "r1", body: "b", createdAt: "t" },
                { id: "r1", body: "c", createdAt: "t" },
              ],
            },
          ],
        }),
      );
      rejects("拒绝非法 status", () =>
        parseFeedback({
          ...baseDoc,
          entries: [{ ...baseEntry, status: "closed" }],
        }),
      );
      rejects("拒绝空 reply body", () =>
        parseFeedback({
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              replies: [{ id: "r1", body: "  ", createdAt: "t" }],
            },
          ],
        }),
      );
      rejects("拒绝超长 reply body", () =>
        parseFeedback({
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              replies: [
                {
                  id: "r1",
                  body: "x".repeat(DAVID_REPLY_MAX_LENGTH + 1),
                  createdAt: "t",
                },
              ],
            },
          ],
        }),
      );
      rejects("拒绝超量 replies", () =>
        parseFeedback({
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              replies: Array.from(
                { length: DAVID_MAX_REPLIES_PER_ENTRY + 1 },
                (_, i) => ({ id: "r" + i, body: "b", createdAt: "t" }),
              ),
            },
          ],
        }),
      );
      rejects("拒绝 reply 未知字段", () =>
        parseFeedback({
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              replies: [{ id: "r1", body: "b", createdAt: "t", evil: 1 }],
            },
          ],
        }),
      );
      rejects("拒绝非数组 replies", () =>
        parseFeedback({
          ...baseDoc,
          entries: [{ ...baseEntry, replies: "nope" }],
        }),
      );
      rejects("拒绝超长 reply id", () =>
        parseFeedback({
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              replies: [{ id: "x".repeat(129), body: "b", createdAt: "t" }],
            },
          ],
        }),
      );

      try {
        const parsed = parseFeedback(baseDoc);
        const next = appendFeedbackReply(parsed, "e1", {
          id: "r1",
          body: "reply",
          createdAt: "t2",
        });
        assert.strictEqual(next.entries[0].replies.length, 1);
        assert.strictEqual(next.entries[0].replies[0].id, "r1");
        assert.strictEqual(
          parsed.entries[0].replies,
          undefined,
          "输入文档不可变",
        );
        assert.strictEqual(parsed.entries[0].id, "e1");
        assert.strictEqual(parsed.entries[0].createdAt, "t1");
        assert.strictEqual(parsed.entries[0].suggestion, "s");
        assert.ok(
          typeof next.updatedAt === "string" && next.updatedAt.length > 0,
        );
        ok("appendFeedbackReply 追加且保留原字段/不可变");
      } catch (e) {
        fail("appendFeedbackReply 追加且保留原字段/不可变", e.message);
      }

      try {
        const scoped = {
          ...baseDoc,
          entries: [
            {
              ...baseEntry,
              scope: {
                pageId: "p1",
                nodePath: ["c1", "n1"],
                targetId: "t1",
              },
            },
          ],
        };
        const next = appendFeedbackReply(parseFeedback(scoped), "e1", {
          id: "r1",
          body: "b",
          createdAt: "t",
        });
        assert.deepStrictEqual(next.entries[0].scope, {
          pageId: "p1",
          nodePath: ["c1", "n1"],
          targetId: "t1",
        });
        ok("回复后 scope 全文保留");
      } catch (e) {
        fail("回复后 scope 全文保留", e.message);
      }

      rejects("appendFeedbackReply 拒绝重复 reply id", () =>
        appendFeedbackReply(
          parseFeedback({
            ...baseDoc,
            entries: [
              {
                ...baseEntry,
                replies: [{ id: "r1", body: "b", createdAt: "t" }],
              },
            ],
          }),
          "e1",
          { id: "r1", body: "c", createdAt: "t" },
        ),
      );
      rejects("appendFeedbackReply 拒绝未知 entry", () =>
        appendFeedbackReply(parseFeedback(baseDoc), "nope", {
          id: "r1",
          body: "b",
          createdAt: "t",
        }),
      );
      rejects("appendFeedbackReply 拒绝非法 reply", () =>
        appendFeedbackReply(parseFeedback(baseDoc), "e1", {
          id: "r1",
          body: "",
          createdAt: "t",
        }),
      );

      try {
        const parsed = parseFeedback(baseDoc);
        const next = setFeedbackEntryStatus(parsed, "e1", "resolved");
        assert.strictEqual(next.entries[0].status, "resolved");
        assert.strictEqual(parsed.entries[0].status, "open", "输入文档不可变");
        assert.strictEqual(next.entries[0].id, "e1");
        assert.strictEqual(next.entries[0].createdAt, "t1");
        ok("setFeedbackEntryStatus 设置状态且不可变/保留字段");
      } catch (e) {
        fail("setFeedbackEntryStatus 设置状态且不可变/保留字段", e.message);
      }

      rejects("setFeedbackEntryStatus 拒绝未知 entry", () =>
        setFeedbackEntryStatus(parseFeedback(baseDoc), "nope", "resolved"),
      );
      rejects("setFeedbackEntryStatus 拒绝非法状态", () =>
        setFeedbackEntryStatus(parseFeedback(baseDoc), "e1", "closed"),
      );

      try {
        const parsed = parseFeedback(baseDoc);
        const next = setFeedbackEntrySuggestion(parsed, "e1", " 新建议 ");
        assert.strictEqual(next.entries[0].suggestion, " 新建议 ");
        assert.strictEqual(parsed.entries[0].suggestion, "s", "输入文档不可变");
        assert.strictEqual(next.entries[0].id, "e1");
        assert.strictEqual(next.entries[0].createdAt, "t1");
        ok("setFeedbackEntrySuggestion 更新建议且不可变/保留字段");
      } catch (e) {
        fail("setFeedbackEntrySuggestion 更新建议且不可变/保留字段", e.message);
      }

      rejects("setFeedbackEntrySuggestion 拒绝空建议", () =>
        setFeedbackEntrySuggestion(parseFeedback(baseDoc), "e1", "   "),
      );
      rejects("setFeedbackEntrySuggestion 拒绝超长建议", () =>
        setFeedbackEntrySuggestion(
          parseFeedback(baseDoc),
          "e1",
          "x".repeat(2001),
        ),
      );
      rejects("setFeedbackEntrySuggestion 拒绝未知 entry", () =>
        setFeedbackEntrySuggestion(parseFeedback(baseDoc), "nope", "b"),
      );

      console.log("--- DavidFeedbackReply.author 字段与 merge 冲突判据 ---");
      const replyDoc = (replies) => ({
        ...baseDoc,
        entries: [{ ...baseEntry, replies }],
      });

      try {
        const parsed = parseFeedback(
          replyDoc([{ id: "r1", body: "b", createdAt: "t" }]),
        );
        const reply = parsed.entries[0].replies[0];
        assert.strictEqual(reply.author, undefined);
        assert.strictEqual(replyAuthor(reply), "user");
        ok("旧 reply 无 author 可解析，replyAuthor 返回 user");
      } catch (e) {
        fail("旧 reply 无 author 可解析，replyAuthor 返回 user", e.message);
      }

      try {
        const parsed = parseFeedback(
          replyDoc([{ id: "r1", body: "b", createdAt: "t", author: "user" }]),
        );
        const reply = parsed.entries[0].replies[0];
        assert.strictEqual(reply.author, undefined);
        assert.deepStrictEqual(Object.keys(reply).sort(), [
          "body",
          "createdAt",
          "id",
        ]);
        assert.strictEqual(
          JSON.stringify(reply),
          JSON.stringify({ id: "r1", body: "b", createdAt: "t" }),
        );
        ok('author:"user" 归一化后不含 author 键，序列化与旧版逐字节一致');
      } catch (e) {
        fail(
          'author:"user" 归一化后不含 author 键，序列化与旧版逐字节一致',
          e.message,
        );
      }

      try {
        const parsed = parseFeedback(
          replyDoc([{ id: "r1", body: "b", createdAt: "t", author: "agent" }]),
        );
        const reply = parsed.entries[0].replies[0];
        assert.strictEqual(reply.author, "agent");
        assert.strictEqual(replyAuthor(reply), "agent");
        ok('author:"agent" 保留');
      } catch (e) {
        fail('author:"agent" 保留', e.message);
      }

      rejects('拒绝 author:"bot"', () =>
        parseFeedback(
          replyDoc([{ id: "r1", body: "b", createdAt: "t", author: "bot" }]),
        ),
      );
      rejects("拒绝 author:123", () =>
        parseFeedback(
          replyDoc([{ id: "r1", body: "b", createdAt: "t", author: 123 }]),
        ),
      );

      try {
        // 关键回归：旧导出（无 author）与新导出（显式 author:"user"）的同一条用户回复 merge，不得假冲突。
        const current = replyDoc([{ id: "r1", body: "b", createdAt: "t" }]);
        const incoming = replyDoc([
          { id: "r1", body: "b", createdAt: "t", author: "user" },
        ]);
        const merged = mergeFeedbackDocuments(current, incoming);
        assert.strictEqual(merged.entries.length, 1);
        assert.strictEqual(merged.entries[0].replies.length, 1);
        assert.strictEqual(merged.entries[0].replies[0].author, undefined);
        ok("旧导出与新导出同一条用户回复 merge 不抛错（防假冲突）");
      } catch (e) {
        fail(
          "旧导出与新导出同一条用户回复 merge 不抛错（防假冲突）",
          e.message,
        );
      }

      rejects("同 reply id 一方 user 一方 agent 拒绝合并", () =>
        mergeFeedbackDocuments(
          replyDoc([{ id: "r1", body: "b", createdAt: "t" }]),
          replyDoc([{ id: "r1", body: "b", createdAt: "t", author: "agent" }]),
        ),
      );

      try {
        const agentReply = {
          id: "r1",
          body: "b",
          createdAt: "t",
          author: "agent",
        };
        const merged = mergeFeedbackDocuments(
          replyDoc([agentReply]),
          replyDoc([agentReply]),
        );
        assert.strictEqual(merged.entries.length, 1);
        assert.strictEqual(merged.entries[0].replies.length, 1);
        assert.strictEqual(merged.entries[0].replies[0].author, "agent");
        ok("agent 回复完全相同重放幂等，回复数不增");
      } catch (e) {
        fail("agent 回复完全相同重放幂等，回复数不增", e.message);
      }

      try {
        const merged = mergeFeedbackDocuments({ ...baseDoc }, { ...baseDoc });
        assert.strictEqual(merged.entries.length, 1);
        assert.strictEqual(merged.entries[0].id, "e1");
        assert.ok(!("replies" in merged.entries[0]));
        ok("同 entry 完全一致合并幂等");
      } catch (e) {
        fail("同 entry 完全一致合并幂等", e.message);
      }

      rejects("entry suggestion 冲突拒绝合并", () =>
        mergeFeedbackDocuments(
          { ...baseDoc },
          { ...baseDoc, entries: [{ ...baseEntry, suggestion: "other" }] },
        ),
      );
      rejects("merge 拒绝 slug 不一致", () =>
        mergeFeedbackDocuments({ ...baseDoc }, { ...baseDoc, slug: "b" }),
      );

      console.log("== davidBridge 剪贴板信封断言 ==");
      const bridgeDoc = {
        schema: "david-feedback/v1",
        schemaVersion: 1,
        slug: "clipboard-test",
        updatedAt: "u0",
        mode: "integrated",
        entries: [
          {
            id: "e1",
            category: "visual",
            suggestion: "s",
            createdAt: "t1",
            status: "open",
            origin: "user",
          },
        ],
      };

      try {
        const envelope = buildAgentClipboardPayload(bridgeDoc);
        assert.ok(envelope.startsWith(AGENT_CLIPBOARD_HEADER));
        const parsed = parseAgentClipboardPayload(envelope);
        assert.deepStrictEqual(parsed.doc, bridgeDoc);
        assert.deepStrictEqual(
          parseFeedback(JSON.parse(parsed.json)),
          bridgeDoc,
        );
        assert.strictEqual(parsed.json, JSON.stringify(bridgeDoc));
        ok(
          "剪贴板信封 round-trip：doc 深相等，原始 json 字符串原样返回且可再次 parseFeedback",
        );
      } catch (e) {
        fail(
          "剪贴板信封 round-trip：doc 深相等，原始 json 字符串原样返回且可再次 parseFeedback",
          e.message,
        );
      }

      try {
        const prefixed =
          "说明：以下为本机 david 反馈导出，请勿外发\\n" +
          buildAgentClipboardPayload(bridgeDoc);
        const parsed = parseAgentClipboardPayload(prefixed);
        assert.deepStrictEqual(parsed.doc, bridgeDoc);
        assert.strictEqual(parsed.json, JSON.stringify(bridgeDoc));
        ok("带前置说明行的容错解析");
      } catch (e) {
        fail("带前置说明行的容错解析", e.message);
      }

      rejects("剪贴板不含 JSON 的文本抛错", () =>
        parseAgentClipboardPayload("纯文本，没有任何 JSON 内容"),
      );
      rejects("剪贴板 JSON 缺 schema 必填字段抛错", () =>
        parseAgentClipboardPayload('{"schema":"david-feedback/v1","slug":"x"}'),
      );
    } finally {
      await ssrServer.close();
    }
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} 项失败`);
    process.exit(1);
  }
  console.log("\n全部通过");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
