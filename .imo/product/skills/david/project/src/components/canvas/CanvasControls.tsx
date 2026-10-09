import { IconButton } from "../ui/IconButton";
import type { CanvasTransformApi } from "../../hooks/useCanvasTransform";

interface CanvasControlsProps {
  api: Pick<
    CanvasTransformApi,
    "transform" | "zoomIn" | "zoomOut" | "reset" | "fit"
  >;
  /** Dock previews are already fit by the dock layout; hide the fit button. */
  showFit?: boolean;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

/**
 * Zoom toolbar for a canvas surface: zoom out / current ratio / zoom in,
 * fit-to-content and 100% reset. Built on the shared ui kit (IconButton,
 * contract 3); the pill wrapper keeps canvas-specific layout and positioning
 * via dv-canvas- classes.
 */
export function CanvasControls({
  api,
  showFit = true,
  className,
  orientation = "horizontal",
}: CanvasControlsProps) {
  const ratio = `${Math.round(api.transform.scale * 100)}%`;
  return (
    <div
      className={`dv-canvas-controls${className ? ` ${className}` : ""}`}
      role="toolbar"
      aria-orientation={orientation}
      data-orientation={orientation}
      aria-label="画板缩放"
      data-dv-canvas-control=""
      // Gesture handlers on the viewport must not start a pan from the toolbar.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <IconButton label="缩小" onClick={api.zoomOut}>
        <span aria-hidden="true">−</span>
      </IconButton>
      <span
        className="dv-canvas-zoom-ratio"
        aria-label={`当前缩放 ${ratio}，点击重置为 100%`}
        title="重置为 100%"
        role="button"
        tabIndex={0}
        onClick={api.reset}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            api.reset();
          }
        }}
      >
        {ratio}
      </span>
      <IconButton label="放大" onClick={api.zoomIn}>
        <span aria-hidden="true">+</span>
      </IconButton>
      {showFit && (
        <IconButton label="适应内容" onClick={() => api.fit("contain")}>
          <span className="dv-canvas-control-wide" aria-hidden="true">
            适应
          </span>
        </IconButton>
      )}
      <IconButton label="重置为 100%" onClick={api.reset}>
        <span className="dv-canvas-control-wide" aria-hidden="true">
          重置
        </span>
      </IconButton>
    </div>
  );
}
