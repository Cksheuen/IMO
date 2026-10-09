import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReviewSpec } from "../src/lib/reviewSpec.ts";
import { trimContextFor } from "./collaborationProtocol.mjs";
import { embeddedJson, previewFragments } from "./review-context-html.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = path.dirname(project);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "david-context-"));
const run = (script, args, nodeArgs = []) =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [...nodeArgs, path.join(project, script), ...args],
      { cwd: project, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
const context = (...args) => run("scripts/review-context.mjs", args);
const read = async (...args) => {
  const result = await context(...args);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const spec = {
  slug: "scope-test",
  title: "Scope test",
  subtitle: "Shared review",
  sourcePath: "not-the-review-source.md",
  pages: [
    {
      id: "p",
      label: "Main",
      pageHtml:
        '<main data-component-id="a"><style>.card{color:red}</style><section data-review-node-id="n"><b data-api-field="amount">10</b><button data-review-page="other">next</button></section></main>',
    },
    {
      id: "other",
      label: "Other",
      pageHtml: '<main data-component-id="b">other</main>',
    },
  ],
  components: [
    {
      id: "a",
      label: "A",
      deepDive: { state: ["parent constraint"] },
      mapping: [
        {
          id: "root",
          requirement: "Compose A",
          change: "Compose",
          api: { changed: false },
        },
      ],
      children: [
        {
          id: "n",
          label: "N",
          mapping: [
            {
              id: "own-row",
              requirement: "show amount",
              change: "read openQuestions#q",
              api: { contractIds: ["c"] },
            },
          ],
        },
      ],
    },
    {
      id: "b",
      label: "B",
      mapping: [
        {
          id: "own-row",
          requirement: "Unrelated",
          change: "UNRELATED " + "x".repeat(80000),
          api: { contractIds: ["other-contract"] },
        },
      ],
    },
  ],
  apiContracts: [
    {
      id: "c",
      status: "proposed",
      response: [{ name: "amount", type: "string" }],
    },
    {
      id: "other-contract",
      status: "confirmed",
      response: [{ name: "unused", type: "string" }],
    },
  ],
  openQuestions: [
    {
      id: "q",
      topic: "Which amount?",
      conflict: "source pending",
      status: "open",
    },
  ],
  collaboration: {
    schemaVersion: 1,
    patchOnly: true,
    pages: [
      { pageId: "p", owner: "one" },
      { pageId: "other", owner: "two" },
    ],
    nodes: [{ ref: "n", owner: "one" }],
    lease: { holder: "one" },
  },
};
const input = path.join(temp, "review.json");
fs.writeFileSync(input, JSON.stringify(spec));
let server;
try {
  parseReviewSpec(spec);
  const catalog = await read(input, "--limit", "3");
  assert.equal(catalog.catalog.items.length, 3);
  assert.equal(catalog.catalog.nextOffset, 3);
  assert.ok(JSON.stringify(catalog).length < 5000);
  assert.ok(!JSON.stringify(catalog).includes("UNRELATED"));
  const rows = await read(input, "--kind", "row");
  assert.ok(
    rows.catalog.items.some(
      (entry) => entry.id === "own-row" && entry.selector.includes("children"),
    ),
  );
  const node = await read(input, "--select", "node:n");
  assert.equal(node.source.reviewPath, fs.realpathSync(input));
  assert.equal(node.source.evidencePath, "not-the-review-source.md");
  assert.deepEqual(
    node.context.contracts.map((c) => c.id),
    ["c"],
  );
  assert.equal(node.context.rows[0].id, "own-row");
  assert.equal(node.context.questions[0].id, "q");
  assert.deepEqual(node.context.ancestors[0].context.deepDive.state, [
    "parent constraint",
  ]);
  assert.equal(node.context.ownership.nodes[0].owner, "one");
  assert.equal(node.readOnly, true);
  assert.equal(node.context.declaredActions[0]["data-review-page"], "other");
  assert.ok(!JSON.stringify(node).includes("UNRELATED"));
  assert.ok(!("preview" in node.context));
  assert.equal((await context(input, "--select", "row:own-row")).code, 2);
  assert.equal((await context(input, "--select", "component:b")).code, 2);
  assert.equal((await context(input, "--select", "missing")).code, 2);
  assert.equal((await context(input, "--out", input)).code, 2);
  const preview = await read(input, "--select", "node:n", "--preview");
  assert.match(
    preview.context.preview[0].fragments[0],
    /data-api-field="amount"/,
  );
  assert.ok(preview.context.preview[0].styles.length);
  const contract = await read(input, "--select", "contract:c");
  assert.equal(contract.context.consumers[0].id, "own-row");
  const trimmed = trimContextFor(spec, "one");
  assert.deepEqual(
    trimmed.apiContracts.map((c) => c.id),
    ["c"],
  );
  assert.equal(trimmed.openQuestions[0].id, "q");
  parseReviewSpec(trimmed);

  for (const renderer of [
    "scripts/render-review.mjs",
    "../scripts/render-review.mjs",
  ]) {
    const output = path.join(
      temp,
      renderer.startsWith("../") ? "root.html" : "project.html",
    );
    const rendered = await run(renderer, [input, output]);
    assert.equal(rendered.code, 0, rendered.stderr);
    const fromHtml = await read(output, "--select", "node:n");
    assert.equal(fromHtml.source.status, "verified-source");
    assert.deepEqual(fromHtml.context.rows, node.context.rows);
    assert.deepEqual(fromHtml.context.ownership, spec.collaboration);
  }
  const html = fs.readFileSync(path.join(temp, "root.html"), "utf8");
  // Another writer replaces the source immediately after the renderer reads it.
  const raceInput = path.join(temp, "concurrent.json");
  const raceOutput = path.join(temp, "concurrent.html");
  const raceHook = path.join(temp, "concurrent-writer.mjs");
  fs.writeFileSync(raceInput, JSON.stringify(spec));
  fs.writeFileSync(
    raceHook,
    `import fs from 'node:fs';
const original = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  const result = original.call(this, file, ...args);
  if (String(file) === ${JSON.stringify(raceInput)}) {
    fs.readFileSync = original;
    fs.writeFileSync(file, ${JSON.stringify(JSON.stringify({ ...spec, title: "Concurrent version" }))});
  }
  return result;
};`,
  );
  const race = await run(
    "scripts/render-review.mjs",
    [raceInput, raceOutput],
    ["--import", raceHook],
  );
  assert.equal(race.code, 0, race.stderr);
  const concurrent = await read(raceOutput, "--select", "node:n");
  assert.equal(concurrent.source.status, "stale-snapshot");
  assert.equal(concurrent.review.title, spec.title);
  const receipt = embeddedJson(html, "david-review-source");
  assert.equal(receipt.relativePath, "review.json");
  const isolated = path.join(temp, "isolated");
  fs.mkdirSync(isolated);
  const standalone = path.join(isolated, "only.html");
  fs.writeFileSync(standalone, html);
  const copy = await read(standalone, "--select", "node:n");
  assert.equal(copy.source.status, "snapshot-only");
  assert.equal(copy.source.reviewPath, null);
  assert.equal(copy.context.rows[0].requirement, "show amount");
  assert.equal(
    copy.context.ownership,
    null,
    "shared HTML does not invent omitted ownership",
  );
  const changed = JSON.parse(JSON.stringify(spec));
  changed.components[0].label = "new version";
  fs.writeFileSync(input, JSON.stringify(changed));
  const stale = await read(path.join(temp, "root.html"));
  assert.equal(stale.source.status, "stale-snapshot");
  assert.equal(stale.source.reviewPath, null);
  const legacy = path.join(temp, "legacy.html");
  fs.writeFileSync(
    legacy,
    `<script type="application/json" id="review-data">${JSON.stringify(spec)}</script>`,
  );
  assert.equal(
    (await read(legacy, "--select", "node:n")).source.status,
    "snapshot-only",
  );
  assert.throws(() =>
    embeddedJson(
      '<script id="review-data" type="application/json">{}</script>'.repeat(2),
      "review-data",
    ),
  );
  assert.deepEqual(
    embeddedJson(
      '<!-- <script id="x" type="application/json">1</script> --><SCRIPT id="x" type="application/json">{"safe":true}</SCRIPT>',
      "x",
    ),
    { safe: true },
  );
  assert.equal(
    previewFragments(
      {
        id: "p",
        pageHtml:
          '<div data-review-node-id="n"><img src="no-fetch"><span>ok</span></div>',
      },
      [{ attribute: "data-review-node-id", token: "n" }],
    ).fragments[0],
    '<div data-review-node-id="n"><img src="no-fetch"><span>ok</span></div>',
  );
  const directory = await read(temp, "--limit", "1");
  assert.equal(directory.candidates.length, 1);
  assert.ok(directory.total > 1);

  server = http.createServer((req, res) => {
    if (req.url === "/feedback/scope-test") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          version: 7,
          doc: {
            slug: "scope-test",
            entries: [
              {
                id: "fb-n",
                suggestion: "Relevant comment",
                scope: { nodeId: "n" },
              },
              {
                id: "fb-other",
                suggestion: "Other comment",
                scope: { nodeId: "other-node" },
              },
            ],
          },
        }),
      );
    } else if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/review.html" });
      res.end();
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const remote = await read(`${base}/review.html`, "--select", "node:n");
  assert.equal(remote.source.status, "snapshot-only");
  assert.equal(remote.source.reviewPath, null);
  assert.equal((await context(`${base}/redirect`)).code, 2);
  assert.equal(fs.readFileSync(input, "utf8"), JSON.stringify(changed));
  const feedbackSpec = path.join(temp, "feedback-review.json");
  fs.writeFileSync(
    feedbackSpec,
    JSON.stringify({ ...spec, service: { baseUrl: base } }),
  );
  const withFeedback = await read(
    feedbackSpec,
    "--select",
    "node:n",
    "--feedback",
  );
  assert.equal(withFeedback.feedback.version, 7);
  assert.deepEqual(
    withFeedback.context.feedback.map((entry) => entry.id),
    ["fb-n"],
  );
  const feedbackCatalog = await read(
    feedbackSpec,
    "--kind",
    "feedback",
    "--feedback",
  );
  assert.equal(feedbackCatalog.catalog.total, 2);
  assert.equal(
    (await read(feedbackSpec, "--select", "feedback:fb-n", "--feedback"))
      .context.value.suggestion,
    "Relevant comment",
  );
  assert.ok(JSON.stringify(node).length < JSON.stringify(spec).length / 10);
  assert.ok(fs.statSync(path.join(root, "SKILL.md")).size < 7000);
  assert.ok(
    fs.statSync(path.join(root, "references/review-schema.md")).size < 3500,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "scripts/render-review.mjs"), "utf8"),
    fs.readFileSync(path.join(project, "scripts/render-review.mjs"), "utf8"),
  );
  console.log(
    "review context: paginated catalog, scoped dependency closure, preview fragments, source/staleness/standalone HTML, HTTP boundaries and legacy collaboration contracts passed",
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
