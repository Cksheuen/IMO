import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LogicGraph } from "../../types/review";
import { layoutLogicGraph } from "../../lib/logicGraph";
import { useCanvasTransform } from "../../hooks/useCanvasTransform";
import { CanvasViewport } from "./CanvasViewport";
import { HoverPopover, type HoverPopoverHandle } from "../HoverPopover";
import { Chip } from "../ui/Chip";
import "../../styles/canvas.css";
import "../../styles/logic-canvas.css";

/** Bounded, read-only graph surface; gestures and controls share the page canvas. */
export function LogicCanvas({
  graph,
  label = "逻辑画板",
  nodeBadges,
  selectedNodeId,
  selectedNodeIds,
  selectableNodeIds,
  onSelectNode,
}: {
  graph: LogicGraph;
  label?: string;
  nodeBadges?: Readonly<Record<string, string | string[]>>;
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  selectableNodeIds?: string[];
  onSelectNode?: (id: string) => void;
}) {
  const badges = (id: string): string[] => {
    const value = nodeBadges?.[id];
    return (Array.isArray(value) ? value : value ? [value] : []).filter(
      Boolean,
    );
  };
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const popover = useRef<HoverPopoverHandle>(null);
  const [hover, setHover] = useState<{
    id: string;
    anchor: HTMLElement;
  } | null>(null);
  const layout = useMemo(
    () => layoutLogicGraph(graph, nodeBadges),
    [graph, nodeBadges],
  );
  const closeHover = useCallback(() => setHover(null), []);
  const api = useCanvasTransform(stage, {
    contentRef: world,
    onTransformChange: closeHover,
  });
  const { fit } = api;
  const marker = useId().replace(/:/g, "");
  const tooltip = `${marker}-explanation`;
  useLayoutEffect(() => {
    let disposed = false;
    const resize = () => {
      if (!disposed) fit("contain", false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (stage.current) observer.observe(stage.current);
    // Lavish's font-ready fitting principle: measure after actual fonts settle.
    void document.fonts?.ready.then(resize);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [fit, layout]);
  const active = graph.nodes.find((n) => n.id === hover?.id);
  return (
    <>
      <CanvasViewport
        frameRef={frame}
        stageRef={stage}
        contentRef={world}
        api={api}
        className="dv-logic-canvas"
        label={label}
        controlOrientation="vertical"
      >
        <div
          className="dv-logic-content"
          style={{ width: layout.width, height: layout.height }}
        >
          {layout.groups.map((group) => (
            <div
              key={group.id}
              className="dv-logic-group"
              data-logic-group-id={group.id}
              style={{
                left: group.x,
                top: group.y,
                width: group.width,
                height: group.height,
              }}
            >
              <span>{group.label}</span>
            </div>
          ))}
          <svg
            className="dv-logic-edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={marker}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0 0L8 4L0 8z" fill="currentColor" />
              </marker>
            </defs>
            {graph.edges.map((edge, i) => {
              const from = layout.nodes.find((n) => n.id === edge.from)!;
              const to = layout.nodes.find((n) => n.id === edge.to)!;
              const horizontal = from.row === to.row;
              const forward = horizontal ? to.x > from.x : to.y > from.y;
              const x1 =
                from.x +
                (horizontal ? (forward ? from.width : 0) : from.width / 2);
              const y1 =
                from.y +
                (horizontal ? from.height / 2 : forward ? from.height : 0);
              const x2 =
                to.x + (horizontal ? (forward ? 0 : to.width) : to.width / 2);
              const y2 =
                to.y + (horizontal ? to.height / 2 : forward ? 0 : to.height);
              const mx = (x1 + x2) / 2,
                my = (y1 + y2) / 2;
              const detour =
                horizontal &&
                (Math.abs(from.column - to.column) > 1 ||
                  from.id === to.id ||
                  (!forward &&
                    graph.edges.some(
                      (e) => e.from === to.id && e.to === from.id,
                    )));
              const laneY = Math.min(from.y, to.y) - 28;
              const direction = forward ? 1 : -1;
              const d = detour
                ? `M${x1},${y1} H${x1 + direction * 18} V${laneY} H${x2 - direction * 18} V${y2} H${x2}`
                : horizontal
                  ? `M${x1},${y1} H${mx} V${y2} H${x2}`
                  : `M${x1},${y1} V${my} H${x2} V${y2}`;
              return (
                <g key={i} data-edge-kind={edge.kind}>
                  <path d={d} markerEnd={`url(#${marker})`} />
                  {edge.label && (
                    <text
                      x={mx}
                      y={(detour ? laneY : my) - 9}
                      textAnchor="middle"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {layout.nodes.map((node) => (
            <button
              type="button"
              key={node.id}
              className={`dv-logic-node is-${node.status ?? "context"}`}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
              }}
              data-logic-node-id={node.id}
              data-node-badge={badges(node.id).join(" · ") || undefined}
              data-review-target={`logic:${node.id}`}
              data-review-label={node.label}
              aria-label={
                nodeBadges?.[node.id]
                  ? `${node.label} · ${badges(node.id).join(" · ")}`
                  : node.label
              }
              aria-pressed={
                onSelectNode &&
                (!selectableNodeIds || selectableNodeIds.includes(node.id))
                  ? (selectedNodeIds ?? [selectedNodeId]).includes(node.id)
                  : undefined
              }
              aria-describedby={hover?.id === node.id ? tooltip : undefined}
              onMouseEnter={(e) => {
                popover.current?.clearCloseTimer();
                setHover({ id: node.id, anchor: e.currentTarget });
              }}
              onMouseLeave={() => popover.current?.scheduleClose()}
              onPointerDown={(e) => {
                // Native focus scrolling must not move a clicked node between
                // pointerdown and pointerup; canvas gestures own its position.
                e.currentTarget.focus({ preventScroll: true });
              }}
              onFocus={(e) => {
                const bounds = stage.current?.getBoundingClientRect();
                const box = e.currentTarget.getBoundingClientRect();
                if (
                  e.currentTarget.matches(":focus-visible") &&
                  bounds &&
                  (box.left < bounds.left ||
                    box.right > bounds.right ||
                    box.top < bounds.top ||
                    box.bottom > bounds.bottom)
                )
                  api.panBy(
                    (bounds.left + bounds.right - box.left - box.right) / 2,
                    (bounds.top + bounds.bottom - box.top - box.bottom) / 2,
                  );
                setHover({ id: node.id, anchor: e.currentTarget });
              }}
              onBlur={() => popover.current?.scheduleClose()}
              onClick={(e) => {
                e.stopPropagation();
                if (!selectableNodeIds || selectableNodeIds.includes(node.id))
                  onSelectNode?.(node.id);
                setHover({ id: node.id, anchor: e.currentTarget });
              }}
            >
              {!!badges(node.id).length && (
                <span className="dv-logic-node-badges">
                  {badges(node.id).map((label) => (
                    <Chip key={label} tone="accent">
                      {label}
                    </Chip>
                  ))}
                </span>
              )}
              <span>{node.lines.join("\n")}</span>
            </button>
          ))}
        </div>
      </CanvasViewport>
      {hover && active?.description?.length ? (
        <HoverPopover
          ref={popover}
          open
          anchor={hover.anchor}
          id={tooltip}
          onClose={() => setHover(null)}
          className="dv-logic-explanation trd-code-annotation-popup"
        >
          <strong>{active.label}</strong>
          <ul>
            {active.description.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </HoverPopover>
      ) : null}
    </>
  );
}
