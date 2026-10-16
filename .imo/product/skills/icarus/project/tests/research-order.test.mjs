import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
const bundled = await build({
  entryPoints: ["mods/logic-canvas/src/graphOrder.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@david": path.resolve("packages/david-source/src") },
});
const { graphReadingOrder } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
test("dependencies take precedence over declaration and click order", () => {
  const graph = {
    nodes: [
      { id: "sink", label: "sink", row: 0, column: 0 },
      { id: "b", label: "branch", row: 2, column: 0 },
      { id: "root", label: "root", row: 1, column: 0 },
      { id: "a", label: "branch", row: 1, column: 1 },
    ],
    edges: [
      { from: "root", to: "a" },
      { from: "root", to: "b" },
      { from: "a", to: "sink" },
      { from: "b", to: "sink" },
    ],
  };
  assert.deepEqual(graphReadingOrder(graph), ["root", "a", "b", "sink"]);
  for (const selected of [
    ["sink", "a"],
    ["a", "sink"],
  ])
    assert.deepEqual(
      graphReadingOrder(graph).filter((id) => selected.includes(id)),
      ["a", "sink"],
    );
});
test("disconnected branches and cycles are deterministic without dropping nodes", () => {
  const graph = {
    nodes: [
      { id: "a", label: "a", row: 0, column: 0 },
      { id: "b", label: "b", row: 0, column: 1 },
      { id: "c", label: "c", row: 1, column: 0 },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  };
  assert.deepEqual(graphReadingOrder(graph), ["c", "a", "b"]);
  assert.deepEqual(graphReadingOrder({ nodes: graph.nodes, edges: [] }), [
    "a",
    "b",
    "c",
  ]);
});
