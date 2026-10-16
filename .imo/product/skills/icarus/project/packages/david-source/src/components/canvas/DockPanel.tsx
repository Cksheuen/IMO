import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CanvasTransformApi } from "../../hooks/useCanvasTransform";
import { CanvasControls } from "./CanvasControls";

interface DockPanelProps {
  /** The .component-dock element itself (App-owned ref; FLIP target and
   *  imperative clone host — clones are mounted directly into this element,
   *  or into its .component-dock-scroll-content child in the clamped model). */
  previewRef: RefObject<HTMLDivElement | null>;
  api: CanvasTransformApi;
  gestures?: boolean;
  visible: boolean;
  morph: boolean;
  onMouseOver?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Component dock preview with an independent pan/zoom transform. The dock box
 * keeps the legacy FLIP geometry (fixed positioning + fit scale) and the
 * legacy DOM contract (clone is the dock's direct child, or inside the
 * scroll-content wrapper when clamped); the user transform composes onto the
 * clone itself (see dockGeometry.applyDockUserView). The zoom toolbar floats
 * as a fixed sibling so it never scrolls or clips inside the dock viewport.
 */
export function DockPanel({
  previewRef,
  api,
  gestures = true,
  visible,
  morph,
  onMouseOver,
  onMouseLeave,
  onKeyDown,
  onClick,
}: DockPanelProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controlsStyle, setControlsStyle] = useState<React.CSSProperties>({});
  const [controlsVisible, setControlsVisible] = useState(false);

  useLayoutEffect(() => {
    if (!visible) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const dock = previewRef.current;
      if (!dock) return;
      const model = dock.dataset.dockModel;
      const show = !morph && model !== "fullpage";
      setControlsVisible(show);
      if (show) {
        const rect = dock.getBoundingClientRect();
        const left = rect.right + 8;
        const height = controlsRef.current?.offsetHeight ?? 144;
        const top = Math.max(
          8,
          Math.min(
            rect.top + (rect.height - height) / 2,
            window.innerHeight - height - 8,
          ),
        );
        setControlsStyle((current) =>
          current.left === left && current.top === top
            ? current
            : { left, top },
        );
      }
      if (
        dock
          .getAnimations()
          .some((animation) => animation.playState === "running")
      )
        raf = requestAnimationFrame(sync);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    const dock = previewRef.current;
    const observer = new MutationObserver(schedule);
    const resize = new ResizeObserver(schedule);
    if (dock) {
      observer.observe(dock, { attributes: true });
      resize.observe(dock);
    }
    if (controlsRef.current) resize.observe(controlsRef.current);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [visible, morph, previewRef, api.transform, controlsVisible]);

  return (
    <>
      <div
        ref={previewRef}
        data-testid="component-dock"
        className={`component-dock ${visible ? "is-visible" : ""} ${
          morph ? "flip-morph" : ""
        }`}
        role="region"
        aria-label="组件预览"
        data-gestures={gestures ? "canvas" : "native"}
        data-panning={api.isPanning ? "true" : undefined}
        onMouseOver={onMouseOver}
        onMouseLeave={onMouseLeave}
        onKeyDown={onKeyDown}
        onClick={onClick}
        {...api.bind}
      />
      {visible && gestures && controlsVisible && (
        <div
          ref={controlsRef}
          className="dv-canvas-dock-controls-anchor"
          style={controlsStyle}
        >
          <CanvasControls api={api} showFit={false} orientation="vertical" />
        </div>
      )}
    </>
  );
}
