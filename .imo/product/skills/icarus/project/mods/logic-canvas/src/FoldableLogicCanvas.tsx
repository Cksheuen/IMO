import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { LogicCanvas } from "./LogicCanvas";
import { IconButton } from "@david/components/ui/IconButton";
import { motionDuration } from "@david/lib/flip";
import type { LogicGraph } from "@david/types/review";
import "./foldable.css";
import { createPortal } from "react-dom";
import { graphReadingOrder } from "./graphOrder";

/** A compact graph has only the selected nodes and their surviving edges. */
export function selectedGraph(
  graph: LogicGraph,
  ids: readonly string[],
): LogicGraph {
  const nodes = graphReadingOrder(graph)
    .filter((id) => ids.includes(id))
    .map((id) => graph.nodes.find((n) => n.id === id)!);
  const selected = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n, i) => ({ ...n, column: 0, row: i })),
    edges: graph.edges.filter(
      (e) => selected.has(e.from) && selected.has(e.to),
    ),
  };
}
/** Reuses the original canvas, gestures and fitting in either presentation. */
export function FoldableLogicCanvas({
  compactAvoid,
  active = true,
  ...props
}: ComponentProps<typeof LogicCanvas> & {
  /** Host-provided control to keep reachable when the canvas docks to the viewport. */
  compactAvoid?: () => DOMRect | undefined;
  active?: boolean;
}) {
  const [compact, setCompact] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const before = useRef<DOMRect | null>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const id = useId();
  const ids =
    props.selectedNodeIds ??
    (props.selectedNodeId ? [props.selectedNodeId] : []);
  const selectionKey = JSON.stringify(ids);
  const graph = useMemo(
    () =>
      compact
        ? selectedGraph(props.graph, JSON.parse(selectionKey))
        : props.graph,
    [compact, props.graph, selectionKey],
  );
  useLayoutEffect(() => {
    const el = panel.current;
    if (!compact || !el) return;
    const position = () => {
      const obstacle = compactAvoid?.();
      const width = el.offsetWidth,
        height = el.offsetHeight;
      let left = 16,
        top = 16;
      const overlaps = () =>
        obstacle &&
        obstacle.width > 0 &&
        obstacle.height > 0 &&
        left < obstacle.right + 8 &&
        left + width > obstacle.left - 8 &&
        top < obstacle.bottom + 8 &&
        top + height > obstacle.top - 8;
      if (overlaps()) {
        left = Math.min(obstacle!.right + 12, window.innerWidth - width - 16);
        if (overlaps()) {
          left = 16;
          top = obstacle!.bottom + 12;
        }
      }
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [compact, compactAvoid]);
  useLayoutEffect(() => {
    const el = panel.current,
      from = before.current;
    before.current = null;
    if (!el || !from) return;
    el.querySelector<HTMLButtonElement>(
      ".icarus-foldable-toolbar button",
    )?.focus({ preventScroll: true });
    const to = el.getBoundingClientRect();
    const duration = motionDuration(360);
    if (!duration || !to.width) return;
    // Uniform scale preserves node proportions throughout the FLIP.
    animation.current = el.animate(
      [
        {
          transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width})`,
        },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration, easing: "cubic-bezier(.22,.8,.24,1)" },
    );
    return () => animation.current?.cancel();
  }, [compact]);
  const surface = (
    <div
      ref={panel}
      className="icarus-foldable-panel"
      id={id}
      data-compact={compact}
      data-canvas-owner={id}
      hidden={compact && !active}
      inert={!active}
    >
      <div className="icarus-foldable-toolbar">
        <IconButton
          label={compact ? "展开函数画板" : "收起函数画板到左上角"}
          expanded={!compact}
          controls={id}
          onClick={() => {
            if (panel.current)
              before.current = panel.current.getBoundingClientRect();
            animation.current?.cancel();
            setCompact((value) => !value);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {compact ? (
              <path d="M3 6V3h3M10 13h3v-3M3 3l4 4m6 6-4-4" />
            ) : (
              <path d="M6 3v3H3m10 4h-3v3M6 6 2 2m8 8 4 4" />
            )}
          </svg>
        </IconButton>
      </div>
      {graph.nodes.length ? (
        <LogicCanvas {...props} graph={graph} />
      ) : (
        <div className="icarus-foldable-empty">未选择节点</div>
      )}
    </div>
  );
  return (
    <div
      className="icarus-foldable-graph"
      data-compact={compact}
      data-panel-id={id}
    >
      {compact ? createPortal(surface, document.body) : surface}
    </div>
  );
}
