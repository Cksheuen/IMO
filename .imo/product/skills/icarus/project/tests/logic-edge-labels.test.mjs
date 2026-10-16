import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [
    new URL("../mods/logic-canvas/src/edgeLabels.ts", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { conciseEdgeLabels } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);

test("legacy labels lose only the repeated legend; arrow endpoints and semantics survive", () => {
  const graph = {
    nodes: [{ id: "load" }, { id: "pack" }],
    edges: [
      {
        from: "load",
        to: "pack",
        kind: "control",
        label: "执行顺序 · 读取候选",
      },
      { from: "pack", to: "load", kind: "control", label: "执行顺序·返回" },
      { from: "load", to: "pack", kind: "data", label: "1 · 输入后处理" },
      { from: "load", to: "pack", kind: "dependency" },
    ],
  };
  const before = structuredClone(graph),
    cleaned = conciseEdgeLabels(graph);
  assert.deepEqual(
    cleaned.edges.map((e) => e.label),
    ["读取候选", "返回", "1 · 输入后处理", undefined],
  );
  assert.deepEqual(
    cleaned.edges.map(({ label, ...edge }) => edge),
    graph.edges.map(({ label, ...edge }) => edge),
  );
  assert.deepEqual(
    graph,
    before,
    "do not mutate authored graphs or saved selection data",
  );
  assert.deepEqual(
    conciseEdgeLabels(cleaned),
    cleaned,
    "repeated composition is stable",
  );
});
