import { layoutLogicGraph } from "@david/lib/logicGraph";
import type { LogicGraph } from "@david/types/review";
/** Follow authored edges; independent branches and cycles retain canvas reading order. */
export function graphReadingOrder(graph: LogicGraph): string[] {
  const visual = layoutLogicGraph(graph)
    .nodes.map((node, index) => ({ ...node, index }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
  const remaining = new Set(visual.map((n) => n.id));
  const incoming = new Map(visual.map((n) => [n.id, 0]));
  const outgoing = new Map(visual.map((n) => [n.id, [] as string[]]));
  for (const edge of graph.edges) {
    incoming.set(edge.to, incoming.get(edge.to)! + 1);
    outgoing.get(edge.from)!.push(edge.to);
  }
  const result: string[] = [];
  while (remaining.size) {
    const next =
      visual.find((n) => remaining.has(n.id) && incoming.get(n.id) === 0) ??
      visual.find((n) => remaining.has(n.id))!;
    result.push(next.id);
    remaining.delete(next.id);
    for (const id of outgoing.get(next.id)!)
      if (remaining.has(id)) incoming.set(id, incoming.get(id)! - 1);
  }
  return result;
}
