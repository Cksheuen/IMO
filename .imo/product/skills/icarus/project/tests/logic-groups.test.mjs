import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["packages/david-source/src/lib/logicGraph.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { isValidLogicGraph, layoutLogicGraph } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const graph = {
  nodes: [
    { id: "a", label: "caller", column: 0, row: 0 },
    { id: "b", label: "setter", column: 1, row: 0 },
    { id: "c", label: "getter", column: 1, row: 1 },
  ],
  edges: [{ from: "a", to: "b", kind: "control" }],
  groups: [
    { id: "file-a", label: "caller.go", nodeIds: ["a"] },
    { id: "file-b", label: "context.go", nodeIds: ["b", "c"] },
  ],
};
test("file shells contain all member functions and remain within canvas bounds", () => {
  assert.ok(isValidLogicGraph(graph));
  const l = layoutLogicGraph(graph);
  for (const g of l.groups) {
    assert.ok(
      g.x >= 0 &&
        g.y >= 0 &&
        g.x + g.width <= l.width &&
        g.y + g.height <= l.height,
    );
    for (const id of g.nodeIds) {
      const n = l.nodes.find((n) => n.id === id);
      assert.ok(
        n.x > g.x &&
          n.y >= g.y + 70 &&
          n.x + n.width < g.x + g.width &&
          n.y + n.height < g.y + g.height,
      );
    }
  }
});
test("unknown, duplicate and cross-file membership is rejected; old graphs retain positions", () => {
  for (const groups of [
    [{ id: "x", label: "x", nodeIds: ["missing"] }],
    [...graph.groups, { id: "x", label: "x", nodeIds: ["a"] }],
    [{ id: "x", label: "x", nodeIds: [] }],
    [{ id: "x", label: "x", nodeIds: ["a", "a"] }],
  ])
    assert.equal(isValidLogicGraph({ ...graph, groups }), false);
  const old = { nodes: graph.nodes, edges: graph.edges };
  assert.ok(isValidLogicGraph(old));
  assert.deepEqual(layoutLogicGraph(old).groups, []);
  assert.equal(layoutLogicGraph(old).nodes[0].y, 44);
});
