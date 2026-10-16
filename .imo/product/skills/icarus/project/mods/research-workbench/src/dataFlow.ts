import type { LogicGraph } from "../../logic-canvas/src/public";
import { graphReadingOrder } from "../../logic-canvas/src/public";
import type { ResearchExplanation, ResearchQuestion } from "./schema";

export type ExplanationFlow = {
  graph: LogicGraph;
  badges: Record<string, string>;
  bindings: Record<string, string[]>;
  contractDirections: Record<string, "inputs" | "outputs">;
  initial: string[];
  codeOrder: string[];
};
const short = (text: string) =>
  text.length > 72 ? text.slice(0, 69) + "…" : text;
/** Compose data edges with the original function/file graph, without inventing calls. */
export function explanationFlow(
  nodeId: string,
  e: ResearchExplanation,
  q: ResearchQuestion,
): ExplanationFlow | undefined {
  const incoming = q.handoffs?.filter((h) => h.to === nodeId) ?? [];
  const steps = e.transformations ?? [];
  if (!e.functionGraph && !incoming.length && !steps.length) return undefined;
  const base = e.functionGraph;
  const graph: LogicGraph = {
    nodes:
      base?.nodes.map((n) => ({
        ...n,
        column: (n.column ?? 0) + 1,
        description: [...(n.description ?? [])],
      })) ?? [],
    edges: base?.edges.map((edge) => ({ ...edge })) ?? [],
    ...(base?.groups
      ? { groups: base.groups.map((g) => ({ ...g, nodeIds: [...g.nodeIds] })) }
      : {}),
  };
  const badges: Record<string, string> = {},
    bindings: Record<string, string[]> = {},
    contractDirections: Record<string, "inputs" | "outputs"> = {};
  const entry = e.entryFunction ?? base?.nodes[0]?.id;
  if (e.entryFunction) badges[e.entryFunction] = "主函数";
  for (const n of base?.nodes ?? []) bindings[n.id] = [n.id];
  const codeOrder = [
    ...(base ? graphReadingOrder(base) : []),
    ...e.codeIds.filter((id) => !base?.nodes.some((n) => n.id === id)),
  ];
  const right = Math.max(1, ...graph.nodes.map((n) => n.column ?? 0)) + 1;
  let firstOperation = entry;
  for (const [i, t] of steps.entries()) {
    const prefix = `flow:${nodeId}:${i}`,
      input = prefix + ":input",
      output = prefix + ":output";
    const functions = t.functionIds?.length
      ? t.functionIds
      : entry
        ? [entry]
        : [];
    const row = incoming.length + i;
    const operation = functions[0] ?? prefix + ":operation";
    firstOperation ??= operation;
    if (!functions.length) {
      graph.nodes.push({
        id: operation,
        label: short(t.operation),
        column: 1,
        row,
        description: [t.operation, `输入：${t.input}`, `输出：${t.output}`],
      });
      bindings[operation] = [...e.codeIds];
      badges[operation] = "处理";
    }
    graph.nodes.push(
      {
        id: input,
        label: short(t.input),
        column: 0,
        row,
        description: [`输入：${t.input}`, t.operation],
      },
      {
        id: output,
        label: short(t.output),
        column: right,
        row,
        description: [`输出：${t.output}`, t.operation],
      },
    );
    badges[input] = "入参";
    badges[output] = "出参";
    bindings[input] = [];
    bindings[output] = [];
    contractDirections[input] = "inputs";
    contractDirections[output] = "outputs";
    graph.edges.push(
      {
        from: input,
        to: operation,
        kind: "control",
        label: `${i + 1} · 输入后处理`,
      },
      {
        from: functions.at(-1) ?? operation,
        to: output,
        kind: "control",
        label: `${i + 1} · 处理后输出`,
      },
    );
  }
  if (!firstOperation) {
    firstOperation = `flow:${nodeId}:operation`;
    graph.nodes.push({
      id: firstOperation,
      label: e.title,
      column: 1,
      row: 0,
      description: [e.summary],
    });
    bindings[firstOperation] = [...e.codeIds];
  }
  for (const [i, h] of incoming.entries()) {
    const id = `flow:${nodeId}:source:${i}`;
    const from = [...q.graph.nodes, ...(q.dependencyGraph?.nodes ?? [])].find(
      (n) => n.id === h.from,
    );
    graph.nodes.push({
      id,
      label: from?.label ?? h.from,
      column: 0,
      row: i,
      description: [
        h.mapping,
        ...(h.extraInputs ? [`另需：${h.extraInputs}`] : []),
      ],
    });
    badges[id] = "上游";
    bindings[id] = entry ? [entry] : [...e.codeIds];
    graph.edges.push({
      from: id,
      to: firstOperation,
      kind: "control",
      label: `${
        h.kind === "control"
          ? "触发后进入"
          : h.kind === "dependency"
            ? "依赖准备后进入"
            : "字段准备后进入"
      }`,
    });
  }
  return {
    graph,
    badges,
    bindings,
    contractDirections,
    initial: [entry ?? firstOperation],
    codeOrder,
  };
}
export function selectedFlowCodes(
  flow: ExplanationFlow,
  selected: string[],
  e: ResearchExplanation,
): string[] {
  const set = new Set(selected.flatMap((id) => flow.bindings[id] ?? []));
  if (selected.length && selected.every((id) => flow.contractDirections[id]))
    return [];
  // Supplementary snippets outside the function graph remain visible as before.
  for (const id of e.codeIds)
    if (!e.functionGraph?.nodes.some((n) => n.id === id)) set.add(id);
  return flow.codeOrder.filter((id) => set.has(id));
}
