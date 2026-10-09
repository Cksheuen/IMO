#!/usr/bin/env node
/**
 * design context 提取 CLI 测试（纯 node，不依赖构建产物）。
 *
 * 覆盖：
 * - 对 examples/ 下真实 review.json 提取成功，字段齐全、摘要有界
 * - 构造 spec：pages / 递归节点 / target 覆盖 / api 字段锚点 / 节点自带
 *   mapping / interactions 触点锚点 / changeBlockKind 全部进入摘要
 * - html 路径：内嵌 <script id="david-design-context"> 可提取且与 JSON 路径一致
 * - --pretty 缩进；错误输入退出码 2
 *
 * 退出码：0 全绿；1 有失败（与 project/scripts/test-*.mjs 风格一致）。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skillRoot = path.resolve(projectRoot, "..");
const cliPath = path.join(projectRoot, "scripts", "extract-design-context.mjs");
const examplePath = path.join(
  skillRoot,
  "examples",
  "video-conversion-shooting-guide.review.json",
);

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  FAIL - ${name}`);
    console.error(`        ${error.message.split("\n").join("\n        ")}`);
  }
};

const runCli = (args) =>
  spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "david-design-context-"));

const longText = "x".repeat(300);

const sampleSpec = {
  slug: "design-context-test",
  title: "Design context test",
  subtitle: "sub",
  pages: [
    {
      id: "p1",
      label: "Page one",
      kind: "screen",
      pageHtml: "<div>page</div>",
      interactions: [
        { source: "open-sheet", action: "toggle", label: "打开弹层" },
      ],
    },
    { id: "p2", label: "Canvas", kind: "canvas", pageHtml: "<div></div>" },
  ],
  components: [
    {
      id: "comp-a",
      label: "Component A",
      kind: "change",
      target: "comp-a-anchor",
      mapping: [
        {
          id: "row-1",
          requirement: longText,
          change: "改动一行",
          api: {
            summary: "接口摘要",
            fields: [
              { name: "field_a", target: "a-token", meaning: "字段 A" },
              { name: "field_b" },
            ],
          },
          changeBlock: { kind: "add", rationale: "新增" },
        },
      ],
      children: [
        {
          id: "node-root",
          label: "Root node",
          target: "node-root-anchor",
          mappingIds: ["row-1"],
          children: [
            { id: "node-leaf", label: "Leaf node" },
            {
              id: "node-own",
              label: "Own mapping node",
              mapping: [
                {
                  id: "nrow-1",
                  requirement: "节点自带行",
                  change: "c",
                  api: {
                    summary: "s",
                    fields: [{ name: "nf", target: "nf-token" }],
                  },
                  changeBlock: { kind: "remove" },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const sampleJsonPath = path.join(tempDir, "sample.review.json");
fs.writeFileSync(sampleJsonPath, JSON.stringify(sampleSpec), "utf8");

const htmlPath = path.join(tempDir, "page.html");

let sampleContext;

console.log("# examples 真实 spec");

const exampleRun = runCli([examplePath]);
check("examples review.json 提取退出码 0", () => {
  assert.strictEqual(exampleRun.status, 0, exampleRun.stderr);
});

let exampleContext;
check("examples 输出合法 JSON 且 schema 正确", () => {
  exampleContext = JSON.parse(exampleRun.stdout);
  assert.strictEqual(exampleContext.schema, "david-design-context/v1");
});

check("examples 摘要字段齐全（slug/title/pages/tree/anchors/mappings）", () => {
  assert.ok(exampleContext.slug);
  assert.ok(exampleContext.title);
  assert.ok(Array.isArray(exampleContext.pages) && exampleContext.pages.length);
  assert.strictEqual(exampleContext.tree[0].kind, "overview");
  assert.strictEqual(exampleContext.tree[0].children.length, 2);
  assert.ok(exampleContext.anchors.length >= 2);
  assert.strictEqual(exampleContext.mappings.length, 7);
  for (const row of exampleContext.mappings) {
    assert.ok(row.id.includes(":"));
  }
});

check("examples 单页 pageHtml 合成为 default 页", () => {
  assert.strictEqual(exampleContext.pages[0].id, "default");
});

check("examples 所有摘要长度 ≤ 120", () => {
  for (const row of exampleContext.mappings) {
    for (const key of ["requirement", "change", "apiSummary"]) {
      if (row[key]) assert.ok(row[key].length <= 120, `${row.id}.${key}`);
    }
  }
});

console.log("# 构造 spec 全字段");

const sampleRun = runCli([sampleJsonPath]);
check("构造 spec 退出码 0", () => {
  assert.strictEqual(sampleRun.status, 0, sampleRun.stderr);
});

check("pages 列表保留 id/label/kind", () => {
  sampleContext = JSON.parse(sampleRun.stdout);
  assert.deepStrictEqual(sampleContext.pages, [
    { id: "p1", label: "Page one", kind: "screen" },
    { id: "p2", label: "Canvas", kind: "canvas" },
  ]);
});

check("tree 为 overview -> component -> 递归 node，且只含摘要字段", () => {
  const root = sampleContext.tree[0];
  assert.strictEqual(root.kind, "overview");
  const comp = root.children[0];
  assert.strictEqual(comp.kind, "component");
  assert.strictEqual(comp.componentId, "comp-a");
  assert.strictEqual(comp.children.length, 1);
  const nodeRoot = comp.children[0];
  assert.strictEqual(nodeRoot.kind, "node");
  assert.strictEqual(nodeRoot.nodeId, "node-root");
  assert.strictEqual(nodeRoot.children.length, 2);
  assert.strictEqual(nodeRoot.children[0].id, "node-leaf");
  assert.ok(nodeRoot.children[0].children === undefined);
});

check("anchors：component target 覆盖、node target 覆盖去重", () => {
  const targets = sampleContext.anchors.map((a) => a.target);
  assert.ok(targets.includes("comp-a-anchor"));
  assert.ok(targets.includes("node-root-anchor"));
  const leaf = sampleContext.anchors.find((a) => a.target === "node-leaf");
  assert.ok(leaf);
  assert.strictEqual(leaf.componentId, "comp-a");
  assert.strictEqual(leaf.nodeId, "node-leaf");
  const compositeKeys = sampleContext.anchors.map(
    (a) => `${a.target}|${a.componentId ?? ""}|${a.nodeId ?? ""}`,
  );
  assert.strictEqual(compositeKeys.length, new Set(compositeKeys).size);
});

check("anchors：api 字段 token 挂 component / node 作用域", () => {
  const fieldA = sampleContext.anchors.find((a) => a.target === "a-token");
  assert.ok(fieldA);
  assert.strictEqual(fieldA.componentId, "comp-a");
  assert.strictEqual(fieldA.nodeId, undefined);
  assert.strictEqual(fieldA.label, "字段 A");
  const nodeField = sampleContext.anchors.find((a) => a.target === "nf-token");
  assert.strictEqual(nodeField.nodeId, "node-own");
});

check("anchors：interactions source 触点进入目录", () => {
  const trigger = sampleContext.anchors.find((a) => a.target === "open-sheet");
  assert.ok(trigger);
  assert.strictEqual(trigger.label, "打开弹层");
});

check("mappings：scoped id、摘要截断、changeBlockKind", () => {
  const row = sampleContext.mappings[0];
  assert.strictEqual(row.id, "comp-a:row-1");
  assert.strictEqual(row.requirement.length, 120);
  assert.ok(row.requirement.endsWith("…"));
  assert.strictEqual(row.changeBlockKind, "add");
  const nodeRow = sampleContext.mappings.find((r) => r.id === "comp-a:nrow-1");
  // 节点自带 mapping 不进 component.mapping 聚合，因此不存在 scoped 行
  assert.strictEqual(nodeRow, undefined);
});

check("mappings：非法 changeBlockKind 被忽略", () => {
  const spec2 = JSON.parse(JSON.stringify(sampleSpec));
  spec2.components[0].mapping[0].changeBlock = { kind: "bogus" };
  const p = path.join(tempDir, "bad-kind.json");
  fs.writeFileSync(p, JSON.stringify(spec2), "utf8");
  const run = runCli([p]);
  const ctx = JSON.parse(run.stdout);
  assert.strictEqual(ctx.mappings[0].changeBlockKind, undefined);
});

console.log("# html 提取路径");

const html =
  '<!doctype html><html><head><script id="other" type="application/json">{}</script>' +
  `<script type="application/json" id="david-design-context">${JSON.stringify(
    sampleContext,
  )}</script></head><body>page</body></html>`;
fs.writeFileSync(htmlPath, html, "utf8");

const htmlRun = runCli([htmlPath]);
check("html 提取退出码 0（属性顺序无关）", () => {
  assert.strictEqual(htmlRun.status, 0, htmlRun.stderr);
});

check("html 提取内容与 JSON 路径深度一致", () => {
  assert.deepStrictEqual(JSON.parse(htmlRun.stdout), sampleContext);
});

const prettyRun = runCli([sampleJsonPath, "--pretty"]);
check("--pretty 输出带缩进", () => {
  assert.strictEqual(prettyRun.status, 0, prettyRun.stderr);
  assert.ok(prettyRun.stdout.includes('\n  "schema"'));
  JSON.parse(prettyRun.stdout);
});

console.log("# 错误路径");

check("缺参数退出码 2", () => {
  const run = runCli([]);
  assert.strictEqual(run.status, 2);
});

check("文件不存在退出码 2", () => {
  const run = runCli([path.join(tempDir, "nope.json")]);
  assert.strictEqual(run.status, 2);
});

check("非法 JSON 退出码 2", () => {
  const p = path.join(tempDir, "broken.json");
  fs.writeFileSync(p, "{not json", "utf8");
  const run = runCli([p]);
  assert.strictEqual(run.status, 2);
});

check("HTML 缺少内嵌块退出码 2", () => {
  const p = path.join(tempDir, "empty.html");
  fs.writeFileSync(p, "<html><body>nothing</body></html>", "utf8");
  const run = runCli([p]);
  assert.strictEqual(run.status, 2);
});

check("不支持的扩展名退出码 2", () => {
  const p = path.join(tempDir, "x.txt");
  fs.writeFileSync(p, "x", "utf8");
  const run = runCli([p]);
  assert.strictEqual(run.status, 2);
});

check("真实两份 renderer 的磁盘 HTML 可提取且目录唯一、完整转义", () => {
  const spec = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  spec.title = '</script><script id="injected">&lt; &amp; $& " \u2028';
  const input = path.join(tempDir, "rendered.json");
  fs.writeFileSync(input, JSON.stringify(spec));
  const expected = JSON.parse(runCli([input]).stdout);
  for (const root of [projectRoot, skillRoot]) {
    const output = path.join(tempDir, path.basename(root) + ".html");
    const rendered = spawnSync(
      process.execPath,
      [path.join(root, "scripts/render-review.mjs"), input, output],
      { encoding: "utf8" },
    );
    assert.equal(rendered.status, 0, rendered.stderr);
    const disk = fs.readFileSync(output, "utf8");
    assert.equal(
      (disk.match(/<script id="david-design-context"/g) || []).length,
      1,
    );
    assert.deepStrictEqual(JSON.parse(runCli([output]).stdout), expected);
    assert.ok(!disk.includes('<script id="injected">'));
  }
});
check("重复 design context 拒绝", () => {
  const duplicate = path.join(tempDir, "duplicate.html");
  fs.writeFileSync(duplicate, html + html);
  assert.equal(runCli([duplicate]).status, 2);
});

fs.rmSync(tempDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} 个检查失败:`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log("\n全部通过");
