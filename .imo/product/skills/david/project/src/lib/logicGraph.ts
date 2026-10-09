import type { LogicGraph } from "../types/review";

const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && Boolean(v.trim());
export function isValidLogicGraph(value: unknown): value is LogicGraph {
  if (
    !record(value) ||
    Object.keys(value).some((k) => !["nodes", "edges", "groups"].includes(k)) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.length ||
    value.nodes.length > 60 ||
    !Array.isArray(value.edges)
  )
    return false;
  const ids = new Set<string>();
  for (const n of value.nodes) {
    if (
      !record(n) ||
      Object.keys(n).some(
        (k) =>
          !["id", "label", "description", "status", "column", "row"].includes(
            k,
          ),
      ) ||
      !text(n.id) ||
      !text(n.label) ||
      ids.has(n.id)
    )
      return false;
    if (
      n.description !== undefined &&
      (!Array.isArray(n.description) ||
        !n.description.length ||
        !n.description.every(text))
    )
      return false;
    if (
      n.status !== undefined &&
      !["context", "changed", "result"].includes(String(n.status))
    )
      return false;
    if ((n.column === undefined) !== (n.row === undefined)) return false;
    for (const key of ["column", "row"])
      if (
        n[key] !== undefined &&
        (!Number.isInteger(n[key]) || Number(n[key]) < 0 || Number(n[key]) > 30)
      )
        return false;
    ids.add(n.id);
  }
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups) || value.groups.length > 60) return false;
    const groupIds = new Set<string>(),
      grouped = new Set<string>();
    for (const group of value.groups) {
      if (
        !record(group) ||
        Object.keys(group).some(
          (k) => !["id", "label", "nodeIds"].includes(k),
        ) ||
        !text(group.id) ||
        groupIds.has(group.id) ||
        !text(group.label) ||
        !Array.isArray(group.nodeIds) ||
        !group.nodeIds.length
      )
        return false;
      groupIds.add(group.id);
      for (const id of group.nodeIds) {
        if (typeof id !== "string" || !ids.has(id) || grouped.has(id))
          return false;
        grouped.add(id);
      }
    }
  }
  return value.edges.every(
    (e) =>
      record(e) &&
      Object.keys(e).every((k) =>
        ["from", "to", "kind", "label"].includes(k),
      ) &&
      ids.has(String(e.from)) &&
      ids.has(String(e.to)) &&
      (e.label === undefined || text(e.label)) &&
      (e.kind === undefined ||
        ["data", "control", "dependency"].includes(String(e.kind))),
  );
}

// Label line-break normalization adapted from lavish-axi whiteboard-core.js.
// MIT, Copyright (c) 2026 Kun Chen. Full notice: THIRD-PARTY-NOTICES.md.
export function normalizeGraphLabel(text: string): string {
  return text
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n");
}

/** Conservative wrapping includes CJK width; boxes grow with all label lines. */
function wrapLabel(label: string): string[] {
  return normalizeGraphLabel(label)
    .split("\n")
    .flatMap((line) => {
      const lines: string[] = [];
      let part = "";
      let width = 0;
      for (const char of line) {
        const size = (char.codePointAt(0) ?? 0) > 255 ? 2 : 1;
        if (width + size > 22) {
          lines.push(part);
          part = "";
          width = 0;
        }
        part += char;
        width += size;
      }
      lines.push(part);
      return lines;
    });
}
export function layoutLogicGraph(
  graph: LogicGraph,
  nodeBadges: Readonly<Record<string, string | string[]>> = {},
) {
  const nodes = graph.nodes.map((node, i) => {
    const row = node.row ?? Math.floor(i / 3);
    const column = node.column ?? (row % 2 ? 2 - (i % 3) : i % 3);
    const lines = wrapLabel(node.label);
    return {
      ...node,
      row,
      column,
      lines,
      width: 228,
      height:
        Math.max(56, lines.length * 20 + 20) + (nodeBadges[node.id] ? 24 : 0),
    };
  });
  const heights = Array.from(
    { length: Math.max(...nodes.map((n) => n.row)) + 1 },
    (_, r) =>
      Math.max(56, ...nodes.filter((n) => n.row === r).map((n) => n.height)),
  );
  const positioned = nodes.map((n) => ({
    ...n,
    x: 32 + n.column * 300,
    y:
      (graph.groups?.length ? 100 : 44) +
      heights
        .slice(0, n.row)
        .reduce((a, b) => a + b + (graph.groups?.length ? 120 : 60), 0),
  }));
  const groups = (graph.groups ?? []).map((group) => {
    const members = positioned.filter((n) => group.nodeIds.includes(n.id));
    const x = Math.min(...members.map((n) => n.x)) - 16;
    const y = Math.min(...members.map((n) => n.y)) - 76;
    return {
      ...group,
      x,
      y,
      width: Math.max(...members.map((n) => n.x + n.width)) - x + 16,
      height: Math.max(...members.map((n) => n.y + n.height)) - y + 16,
    };
  });
  return {
    nodes: positioned,
    groups,
    width: Math.max(...positioned.map((n) => n.x + n.width)) + 32,
    height: Math.max(...positioned.map((n) => n.y + n.height)) + 32,
  };
}

/** All code entries remain reachable; authored edges, never inferred from titles. */
export function isValidCodeFlow(graph: unknown, points: unknown): boolean {
  if (!isValidLogicGraph(graph) || !Array.isArray(points)) return false;
  const code = points.filter(
    (p) => record(p) && (p.pseudoCode || p.changeBlock),
  );
  const ids = points
    .filter((p) => record(p) && p.id !== undefined)
    .map((p) => p.id);
  return (
    code.length >= 2 &&
    new Set(ids).size === ids.length &&
    code.every((p) => text(p.id)) &&
    code.every((p) => graph.nodes.some((n) => n.id === p.id)) &&
    graph.nodes.every(
      (n) => code.some((p) => p.id === n.id) || Boolean(n.description?.length),
    ) &&
    graph.edges.length > 0
  );
}
