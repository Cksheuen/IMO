import type { PageSpec } from "../../types/review";
import type { ActiveNodeMode } from "./types";

/**
 * Canvas-page graph overlay: a non-interactive SVG layer with hover/click
 * reactive logical nodes. Lives inside the transformed world and stage gesture boundary.
 */
export const GraphOverlay = ({
  graph,
  onNodeActivate,
}: {
  graph: NonNullable<PageSpec["graph"]>;
  onNodeActivate?: (id: string, mode: ActiveNodeMode) => void;
}) => {
  const positions = new Map(
    graph.nodes.map((node, index) => [
      node.id,
      { x: 12 + (index % 3) * 34, y: 18 + Math.floor(index / 3) * 24 },
    ]),
  );
  return (
    <svg
      className="review-graph-overlay"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-label="逻辑关系图"
    >
      {graph.edges.map((edge, index) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.from}-${edge.to}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            data-edge-kind={edge.kind}
          />
        );
      })}
      {graph.nodes.map((node) => {
        const point = positions.get(node.id);
        if (!point) return null;
        return (
          <g
            key={node.id}
            className={`review-graph-node is-${node.status ?? "context"}`}
            transform={`translate(${point.x} ${point.y})`}
            role="button"
            tabIndex={0}
            aria-label={node.label}
            onClick={(event) => {
              event.stopPropagation();
              onNodeActivate?.(node.id, "canvas");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onNodeActivate?.(node.id, "canvas");
              }
            }}
          >
            <rect x={-12} y={-6} width={24} height={12} rx={2} />
            <text textAnchor="middle" dominantBaseline="middle">
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
