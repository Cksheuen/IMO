import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import { research } from "./fixtures/research.mjs";
const result = await build({
  entryPoints: ["mods/research-workbench/src/dataFlow.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  loader: { ".css": "empty" },
  alias: { "@david": path.resolve("packages/david-source/src") },
});
const { explanationFlow, selectedFlowCodes } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);
test("data nodes select their contracts while function nodes select source", () => {
  const q = structuredClone(research.pages[0].questions[0]),
    e = q.explanations["entry:input"];
  const ids = e.functionGraph.nodes.map((n) => n.id);
  e.entryFunction = ids[0];
  e.transformations = [
    {
      input: "query",
      operation: "normalize in function",
      output: "config",
      functionIds: [ids[0]],
    },
  ];
  const original = JSON.stringify(e.functionGraph),
    flow = explanationFlow("entry:input", e, q);
  assert.equal(JSON.stringify(e.functionGraph), original, "pure composition");
  assert.equal(flow.badges[ids[0]], "主函数");
  assert.deepEqual(flow.graph.nodes.find(n => n.id === ids[0]).description,
    e.functionGraph.nodes[0].description, "Function hover preserves its purpose instead of repeating transformations");
  assert.ok(
    flow.graph.edges.some(
      (x) =>
        x.from.endsWith(":input") &&
        x.to === ids[0] &&
        x.kind === "control" &&
        x.label.includes("输入后处理"),
    ),
  );
  assert.ok(
    flow.graph.edges.some((x) => x.from === ids[0] && x.to.endsWith(":output")),
  );
  assert.deepEqual(selectedFlowCodes(flow, ["flow:entry:input:0:input"], e), []);
  assert.deepEqual(selectedFlowCodes(flow, ["flow:entry:input:0:output"], e), []);
  assert.equal(flow.contractDirections["flow:entry:input:0:input"], "inputs");
  assert.equal(flow.contractDirections["flow:entry:input:0:output"], "outputs");
  assert.ok(selectedFlowCodes(flow, [ids[0]], e).includes(ids[0]));
  assert.equal(
    new Set(flow.graph.nodes.map((n) => n.id)).size,
    flow.graph.nodes.length,
  );
  assert.equal(
    new Set(flow.graph.nodes.map((n) => `${n.column}:${n.row}`)).size,
    flow.graph.nodes.length,
  );
});
test("legacy transformations without functions are drawn without pretending to name a function", () => {
  const q = structuredClone(research.pages[0].questions[0]),
    e = q.explanations["entry:output"];
  delete e.functionGraph;
  e.transformations = [
    { input: "record", operation: "project fields", output: "view" },
  ];
  q.handoffs = [
    {
      from: "entry:input",
      to: "entry:output",
      mapping: "prompt only",
      extraInputs: "identity",
      kind: "data",
    },
  ];
  const flow = explanationFlow("entry:output", e, q);
  assert.equal(flow.graph.nodes.length, 4);
  assert.ok(
    flow.graph.nodes.some((n) => n.description.includes("prompt only")),
  );
  assert.ok(!Object.values(flow.badges).includes("主函数"));
  assert.deepEqual(selectedFlowCodes(flow, flow.initial, e), e.codeIds);
});
