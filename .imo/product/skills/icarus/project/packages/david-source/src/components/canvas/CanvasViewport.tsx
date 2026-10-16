import type { ReactNode, RefObject } from "react";
import type { CanvasTransformApi } from "../../hooks/useCanvasTransform";
import { CanvasControls } from "./CanvasControls";

interface CanvasViewportProps {
  /** Outer frame element (App-owned; FLIP source queries and scene roots). */
  frameRef: RefObject<HTMLDivElement | null>;
  /** Clipping stage that owns the pan/zoom gesture bindings. */
  stageRef: RefObject<HTMLDivElement | null>;
  api: CanvasTransformApi;
  gestures?: boolean;
  className: string;
  html?: { __html: string };
  contentRef?: RefObject<HTMLDivElement | null>;
  label?: string;
  controlOrientation?: "horizontal" | "vertical";
  children?: ReactNode;
  onMouseOver?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Overview canvas frame: a clipping stage containing a transformed world with
 * the injected page HTML. The outer frame keeps its legacy role (card surface,
 * hover/click delegation, FLIP source root); the stage is in flow so at scale
 * 1 the frame keeps its natural content height exactly like before.
 */
export function CanvasViewport({
  frameRef,
  stageRef,
  api,
  gestures = true,
  className,
  html,
  contentRef,
  label,
  controlOrientation,
  children,
  onMouseOver,
  onMouseLeave,
  onKeyDown,
  onClick,
}: CanvasViewportProps) {
  return (
    <div
      ref={frameRef}
      className={className}
      onMouseOver={onMouseOver}
      onMouseLeave={onMouseLeave}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <div
        ref={stageRef}
        className="dv-canvas-stage"
        aria-label={label}
        data-gestures={gestures ? "canvas" : "native"}
        data-panning={api.isPanning ? "true" : undefined}
        {...api.bind}
      >
        <div
          ref={contentRef}
          className="dv-canvas-world"
          data-animated={api.animated ? "true" : undefined}
          data-panning={api.isPanning ? "true" : undefined}
          style={{ transform: api.transformCss }}
        >
          {html && (
            <div className="dv-canvas-host" dangerouslySetInnerHTML={html} />
          )}
          {children}
        </div>
      </div>
      {gestures && (
        <CanvasControls
          api={api}
          orientation={controlOrientation}
          showFit
          className="dv-canvas-frame-controls"
        />
      )}
    </div>
  );
}
