import type { LogicGraph } from "@david/types/review";

/** Keep the relation itself; a repeated graph-wide legend is not an edge label. */
export function conciseEdgeLabels(graph: LogicGraph): LogicGraph {
  return {
    ...graph,
    edges: graph.edges.map((edge) => ({
      ...edge,
      label: edge.label?.replace(/^\s*执行顺序\s*[·•:：]\s*/, ""),
    })),
  };
}
