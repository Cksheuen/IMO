import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const result = await build({
  entryPoints: ["mods/research-workbench/src/flowCoverage.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { auditFunctionFlows } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);
const question = () => ({
  id: "q",
  graph: { nodes: [{ id: "run" }], edges: [] },
  codes: [{ id: "fn", source: "src/run.ts:10" }],
  explanations: {
    run: {
      codeIds: ["fn"],
      entryFunction: "fn",
      functionGraph: {
        nodes: [{ id: "fn" }],
        groups: [{ id: "f", nodeIds: ["fn"] }],
      },
      transformations: [
        {
          input: "x",
          operation: "normalize",
          output: "y",
          functionIds: ["fn"],
        },
      ],
    },
  },
});
test("global audit catches omissions on a different page, not just the feedback target", () => {
  const first = question(),
    second = question();
  delete second.explanations.run.functionGraph;
  const rows = auditFunctionFlows({
    pages: [
      { id: "target", questions: [first] },
      { id: "other", questions: [second] },
    ],
  });
  assert.equal(rows[0].status, "covered");
  assert.equal(rows[1].status, "gap");
  assert.ok(rows[1].gaps.includes("缺少函数图"));
});
test("a graph alone cannot hide missing source, file groups, or unbound conversions", () => {
  const q = question();
  delete q.codes[0].source;
  q.explanations.run.functionGraph.groups = [];
  delete q.explanations.run.transformations[0].functionIds;
  const [row] = auditFunctionFlows({ pages: [{ id: "p", questions: [q] }] });
  assert.equal(row.gaps.length, 3);
});
test("non-executable inventory nodes require an explicit exclusion; dependency nodes are audited", () => {
  const q = question();
  q.dependencyGraph = { nodes: [{ id: "resource" }], edges: [] };
  q.explanations.resource = { codeIds: [] };
  let rows = auditFunctionFlows({ pages: [{ id: "p", questions: [q] }] });
  assert.equal(rows[1].status, "gap");
  q.explanations.resource.flowExclusion =
    "Deployment inventory, no execution path";
  rows = auditFunctionFlows({ pages: [{ id: "p", questions: [q] }] });
  assert.equal(rows[1].status, "excluded");
});
