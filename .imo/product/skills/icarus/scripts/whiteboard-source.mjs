import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "parse5";

export const sourceHash = (value) =>
  createHash("sha256").update(value).digest("hex");

function readPayload(file) {
  const text = fs.readFileSync(file, "utf8");
  if (/\.json$/i.test(file))
    return { spec: JSON.parse(text), sourceText: text };
  const payloads = [];
  function visit(node) {
    if (
      node.attrs?.some((a) => a.name === "id" && a.value === "icarus-bootstrap")
    )
      throw Error(
        "whiteboard source must be the original source.html, not review.html",
      );
    if (
      node.tagName === "script" &&
      node.attrs?.some((a) => a.name === "data-icarus-props")
    ) {
      const value = JSON.parse(
        node.childNodes.map((n) => n.value ?? "").join(""),
      );
      const spec = value.spec ?? value;
      if (spec.schema === "icarus-research/v1") payloads.push(spec);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(text));
  if (payloads.length !== 1)
    throw Error("source must contain exactly one icarus-research/v1 payload");
  return { spec: payloads[0], sourceText: text };
}

export function readResearchSource(file) {
  const absolute = path.resolve(file);
  const { spec: value, sourceText } = readPayload(absolute);
  const spec = value?.spec ?? value;
  if (
    spec?.schema !== "icarus-research/v1" ||
    !Array.isArray(spec.pages) ||
    !spec.pages.length
  )
    throw Error("research source must contain icarus-research/v1 pages");
  return { spec, sourcePath: absolute, sha256: sourceHash(sourceText) };
}

export function graphViews(question) {
  return [
    {
      id: "logic",
      label: question.graphViews?.length ? "总链路" : "逻辑关系",
      graph: question.graph,
    },
    ...(question.graphViews ?? []),
    ...(question.dependencyGraph
      ? [
          {
            id: "dependencies",
            label: "文件引用",
            graph: question.dependencyGraph,
          },
        ]
      : []),
  ];
}

export function selectGraphs(
  spec,
  { pageId, questionId, viewId, all = false } = {},
) {
  const pages = pageId
    ? spec.pages.filter((page) => page.id === pageId)
    : all
      ? spec.pages
      : [spec.pages[0]];
  if (!pages.length) throw Error(`Unknown research page: ${pageId}`);
  const selected = [];
  for (const page of pages) {
    for (const question of page.questions ?? []) {
      if (questionId && question.id !== questionId) continue;
      const views = graphViews(question);
      if (new Set(views.map((v) => v.id)).size !== views.length)
        throw Error(
          `Duplicate graph view id on page ${page.id}/${question.id}`,
        );
      const chosen = viewId
        ? views.filter((view) => view.id === viewId)
        : all
          ? views
          : [views[0]];
      for (const view of chosen) selected.push({ page, question, view });
    }
  }
  if (!selected.length)
    throw Error("No matching research question or graph view");
  return selected;
}

function text(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "#124;")
    .replaceAll("\r", "")
    .replaceAll("\n", "<br/>");
}

function safeId(value, index) {
  const id = String(value ?? "node").replace(/[^a-zA-Z0-9_]/g, "_");
  return `node_${index}_${id}`;
}

export function graphToMermaid({ page, question, view }) {
  const graph = view.graph;
  if (
    !Array.isArray(graph?.nodes) ||
    !graph.nodes.length ||
    !Array.isArray(graph.edges)
  )
    throw Error("Graph requires nodes and edges arrays");
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (
      typeof node.id !== "string" ||
      !node.id ||
      typeof node.label !== "string" ||
      !node.label ||
      nodes.has(node.id)
    )
      throw Error("Graph node ids must be unique and labels nonempty");
    nodes.set(node.id, node);
  }
  const ids = new Map(
    graph.nodes.map((node, index) => [node.id, safeId(node.id, index)]),
  );
  const comment = (value) => String(value ?? "").replace(/[\r\n]/g, " ");
  const lines = [
    "flowchart LR",
    `  %% Icarus ${comment(page.id)}/${comment(question.id)}/${comment(view.id)}`,
    `  %% ${comment(page.label)} · ${comment(view.label)}`,
  ];
  const classes = new Map();
  const nodeLine = (node) => {
    const explanation = question.explanations?.[node.id];
    const layer = [
      "frontend",
      "backend",
      "infrastructure",
      "contract",
    ].includes(explanation?.layer)
      ? explanation.layer
      : undefined;
    const services = explanation?.serviceTags?.length
      ? ` · ${explanation.serviceTags.join(" / ")}`
      : "";
    if (layer)
      classes.set(layer, [...(classes.get(layer) ?? []), ids.get(node.id)]);
    return `${ids.get(node.id)}["${text(node.label + (layer ? " · " + layer : "") + services)}"]`;
  };
  const grouped = new Set(),
    groupIds = new Set();
  for (const [index, group] of (graph.groups ?? []).entries()) {
    if (
      !group.id ||
      groupIds.has(group.id) ||
      !group.label ||
      !Array.isArray(group.nodeIds) ||
      !group.nodeIds.length
    )
      throw Error("Invalid graph group");
    groupIds.add(group.id);
    lines.push(`  subgraph group_${index}["${text(group.label)}"]`);
    for (const id of group.nodeIds) {
      if (!nodes.has(id) || grouped.has(id))
        throw Error(`Invalid or repeated group member: ${id}`);
      grouped.add(id);
      lines.push(`    ${nodeLine(nodes.get(id))}`);
    }
    lines.push("  end");
  }
  for (const node of graph.nodes)
    if (!grouped.has(node.id)) lines.push(`  ${nodeLine(node)}`);
  for (const edge of graph.edges ?? []) {
    const from = ids.get(edge.from),
      to = ids.get(edge.to);
    if (!from || !to)
      throw Error(`Dangling graph edge: ${edge.from} -> ${edge.to}`);
    const label = edge.label
      ? `${edge.kind ?? "data"}: ${edge.label}`
      : (edge.kind ?? "data");
    const arrow =
      edge.kind === "dependency"
        ? "-.->"
        : edge.kind === "control"
          ? "==>"
          : "-->";
    lines.push(`  ${from} ${arrow}|"${text(label)}"| ${to}`);
  }
  lines.push(
    "  classDef frontend fill:#E8F2FF,stroke:#3B82F6,color:#123B70;",
    "  classDef backend fill:#FFF0E8,stroke:#E8793A,color:#6B2E0C;",
    "  classDef infrastructure fill:#F0E8FF,stroke:#8B5CF6,color:#3B1D74;",
    "  classDef contract fill:#ECFDF3,stroke:#22A06B,color:#14532D;",
  );
  for (const [layer, nodeIds] of classes)
    lines.push(`  class ${nodeIds.join(",")} ${layer};`);
  return lines.join("\n") + "\n";
}

export function fileStem({ page, question, view }) {
  return [page.id, question.id, view.id]
    .join("--")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function exportGraphs(sourceFile, outputDir, selection = {}) {
  const { spec, sourcePath, sha256 } = readResearchSource(sourceFile);
  const graphs = selectGraphs(spec, selection);
  const prepared = graphs.map((item) => ({
    item,
    stem: fileStem(item),
    mermaid: graphToMermaid(item),
  }));
  if (new Set(prepared.map((p) => p.stem)).size !== prepared.length)
    throw Error("Graph identifiers produce colliding export filenames");
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = {
    schema: "icarus-whiteboard-export/v1",
    source: { path: sourcePath, sha256 },
    graphs: [],
  };
  for (const { item, stem, mermaid } of prepared) {
    const mermaidPath = path.join(outputDir, `${stem}.mmd`);
    const jsonPath = path.join(outputDir, `${stem}.graph.json`);
    fs.writeFileSync(mermaidPath, mermaid);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          page: item.page.id,
          question: item.question.id,
          view: item.view.id,
          label: `${item.page.label} · ${item.view.label}`,
          graph: item.view.graph,
        },
        null,
        2,
      ),
    );
    manifest.graphs.push({
      page: item.page.id,
      question: item.question.id,
      view: item.view.id,
      label: `${item.page.label} · ${item.view.label}`,
      mermaid: path.resolve(mermaidPath),
      graph: path.resolve(jsonPath),
      nodeCount: item.view.graph.nodes.length,
      edgeCount: item.view.graph.edges?.length ?? 0,
      groupCount: item.view.graph.groups?.length ?? 0,
    });
  }
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, manifest: path.resolve(manifestPath) };
}
