import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { captureAppearance } from "../../lib/globalSelection";
import type {
  AppearanceSelection,
  GlobalSelectionScene,
  GlobalSurfaces,
} from "../../lib/globalSelection";
// Canvas transform (A2 contract): back-compute logical canvas coordinates for
// the capture rect center. When no canvas is mounted the context is null and
// canvasPoint is omitted entirely.
import { CanvasTransformContext } from "../../hooks/useCanvasTransform";
import "../../styles/global-selection.css";

export type { AppearanceSelection };
export const REQUEST_CAPTURE_EVENT = "david-request-capture";

export interface GlobalRegionSelectionProps {
  surfaces: GlobalSurfaces;
  scene: GlobalSelectionScene;
  onAppearance: (selection: AppearanceSelection) => void;
  onCancel?: () => void;
}

type DragState = {
  surfaces: GlobalSurfaces;
  scene: GlobalSelectionScene;
  startedAt: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  pointerId: number;
  moved: boolean;
};

type PendingClickSuppression = {
  x: number;
  y: number;
  at: number;
};

const MIN_CAPTURE_SIZE_PX = 8;
const CLICK_SUPPRESSION_MS = 500;
const CLICK_SUPPRESSION_TOLERANCE_PX = 4;

function getSceneKey(scene: GlobalSelectionScene): string {
  return JSON.stringify([
    scene.pageId,
    scene.componentId,
    scene.nodeId,
    scene.displayNodeId,
  ]);
}

function clipRectToViewport(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(window.innerWidth, rect.x + rect.width);
  const bottom = Math.min(window.innerHeight, rect.y + rect.height);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return null;

  return { x: left, y: top, width, height };
}

/**
 * Back-compute the capture rect center into canvas logical coordinates.
 * Returns undefined when no canvas stage is mounted or the transform context
 * is absent (non-canvas surfaces).
 */

export function GlobalRegionSelection({
  surfaces,
  scene,
  onAppearance,
  onCancel,
}: GlobalRegionSelectionProps) {
  const [active, setActive] = useState(false);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLButtonElement | null>(null);

  const activeRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef(0);
  const pendingClickRef = useRef<PendingClickSuppression | null>(null);
  const cancelledPointerIdRef = useRef<number | null>(null);

  const surfacesRef = useRef(surfaces);
  const sceneRef = useRef(scene);
  const sceneKeyRef = useRef(getSceneKey(scene));
  const onAppearanceRef = useRef(onAppearance);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const request = () => {
      activeRef.current = true;
      setActive(true);
    };
    window.addEventListener(REQUEST_CAPTURE_EVENT, request);
    return () => window.removeEventListener(REQUEST_CAPTURE_EVENT, request);
  }, []);
  const canvasContext = useContext(CanvasTransformContext);
  const canvasContextRef = useRef(canvasContext);

  const hideRect = useCallback(() => {
    const box = rectRef.current;
    if (!box) return;
    box.style.display = "none";
    box.removeAttribute("data-positioned");
  }, []);

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    dragRef.current = null;
    cancelledPointerIdRef.current = drag.pointerId;

    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    const overlay = overlayRef.current;
    if (overlay) {
      try {
        overlay.releasePointerCapture(drag.pointerId);
      } catch {
        // Pointer capture may already be released.
      }
    }

    hideRect();
  }, [hideRect]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== 0) return;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;

      const drag = dragRef.current;
      const box = rectRef.current;
      if (!drag || !box) return;

      const left = Math.max(0, Math.min(drag.startX, drag.currentX));
      const top = Math.max(0, Math.min(drag.startY, drag.currentY));
      const right = Math.min(
        window.innerWidth,
        Math.max(drag.startX, drag.currentX),
      );
      const bottom = Math.min(
        window.innerHeight,
        Math.max(drag.startY, drag.currentY),
      );

      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);

      if (width === 0 || height === 0) {
        hideRect();
        return;
      }

      box.style.display = "block";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.setAttribute("data-positioned", "true");
    });
  }, [hideRect]);

  const deactivateMode = useCallback(() => {
    activeRef.current = false;
    setActive(false);
  }, []);

  const toggleMode = useCallback(() => {
    const next = !activeRef.current;
    if (!next) {
      cancelDrag();
      onCancelRef.current?.();
    }
    activeRef.current = next;
    setActive(next);
  }, [cancelDrag]);

  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (event.isPrimary) {
      cancelledPointerIdRef.current = null;
      pendingClickRef.current = null;
    }

    if (!activeRef.current) return;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.altKey) return;

    const target = event.target;
    if (target instanceof Node && toolbarRef.current?.contains(target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const overlay = overlayRef.current;
    if (!overlay) return;

    dragRef.current = {
      surfaces: surfacesRef.current,
      scene: Object.freeze({ ...sceneRef.current }),
      startedAt: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      pointerId: event.pointerId,
      moved: false,
    };

    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      // The browser may reject capture if the pointer is no longer active.
    }
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      drag.currentX = event.clientX;
      drag.currentY = event.clientY;
      drag.moved = true;
      scheduleDraw();
    },
    [scheduleDraw],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        if (
          cancelledPointerIdRef.current !== null &&
          event.pointerId === cancelledPointerIdRef.current
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          pendingClickRef.current = {
            x: event.clientX,
            y: event.clientY,
            at: Date.now(),
          };
          cancelledPointerIdRef.current = null;
        }

        return;
      }

      if (event.pointerId !== drag.pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      dragRef.current = null;

      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }

      const overlay = overlayRef.current;
      if (overlay) {
        try {
          overlay.releasePointerCapture(drag.pointerId);
        } catch {
          // Pointer capture may already be released.
        }
      }

      hideRect();

      if (!drag.moved) return;

      pendingClickRef.current = {
        x: event.clientX,
        y: event.clientY,
        at: Date.now(),
      };

      const rect = clipRectToViewport({
        x: Math.min(drag.startX, event.clientX),
        y: Math.min(drag.startY, event.clientY),
        width: Math.abs(event.clientX - drag.startX),
        height: Math.abs(event.clientY - drag.startY),
      });

      if (
        !rect ||
        rect.width < MIN_CAPTURE_SIZE_PX ||
        rect.height < MIN_CAPTURE_SIZE_PX
      ) {
        return;
      }

      deactivateMode();

      try {
        const canvasPoint = canvasContextRef.current?.resolvePoint({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
        const selection = captureAppearance(
          rect,
          drag.surfaces,
          drag.scene,
          new Date(drag.startedAt).toISOString(),
          canvasPoint,
        );
        onAppearanceRef.current(selection);
      } catch (error) {
        console.error("Failed to capture appearance selection", error);
      }
    },
    [deactivateMode, hideRect],
  );

  const handlePointerCancel = useCallback(() => {
    cancelDrag();
  }, [cancelDrag]);

  useLayoutEffect(() => {
    onAppearanceRef.current = onAppearance;
    surfacesRef.current = surfaces;
    canvasContextRef.current = canvasContext;

    const previousSceneKey = sceneKeyRef.current;
    sceneRef.current = scene;
    sceneKeyRef.current = getSceneKey(scene);

    if (previousSceneKey !== sceneKeyRef.current) {
      cancelDrag();
    }
  }, [surfaces, scene, onAppearance, canvasContext, cancelDrag]);

  useEffect(() => {
    document.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
    };
  }, [handlePointerDown]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
    });
    window.addEventListener("pointerup", handlePointerUp, {
      capture: true,
    });
    window.addEventListener("pointercancel", handlePointerCancel, {
      capture: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, {
        capture: true,
      });
      window.removeEventListener("pointerup", handlePointerUp, {
        capture: true,
      });
      window.removeEventListener("pointercancel", handlePointerCancel, {
        capture: true,
      });
    };
  }, [handlePointerMove, handlePointerUp, handlePointerCancel]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (activeRef.current) {
        if (event.altKey) return;

        const target = event.target;
        if (target instanceof Node && toolbarRef.current?.contains(target)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (event.detail === 0) return;

      const pending = pendingClickRef.current;
      if (!pending) return;

      const target = event.target;
      if (target instanceof Node && toolbarRef.current?.contains(target)) {
        return;
      }

      pendingClickRef.current = null;

      if (Date.now() - pending.at > CLICK_SUPPRESSION_MS) return;
      if (
        Math.abs(event.clientX - pending.x) > CLICK_SUPPRESSION_TOLERANCE_PX ||
        Math.abs(event.clientY - pending.y) > CLICK_SUPPRESSION_TOLERANCE_PX
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener("click", handleClick, { capture: true });

    return () => {
      window.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancelDrag();
      deactivateMode();
      onCancelRef.current?.();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [cancelDrag, deactivateMode]);

  useEffect(() => {
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("resize", cancelDrag);
    window.addEventListener("scroll", cancelDrag, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("resize", cancelDrag);
      window.removeEventListener("scroll", cancelDrag, { capture: true });
    };
  }, [cancelDrag]);

  useEffect(() => {
    document.body.classList.toggle("david-gc-mode", active);

    return () => {
      document.body.classList.remove("david-gc-mode");
    };
  }, [active]);

  useEffect(() => {
    return () => {
      cancelDrag();
    };
  }, [cancelDrag]);

  return createPortal(
    <div
      className="david-global-capture"
      data-david-global-capture=""
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        pointerEvents: "none",
      }}
    >
      <div
        ref={overlayRef}
        className="david-gc-overlay"
        data-david-global-capture="overlay"
        style={{ pointerEvents: "none" }}
        aria-hidden="true"
      />
      <div
        ref={rectRef}
        className="david-gc-rect"
        data-david-global-capture="rect"
        style={{ display: "none", pointerEvents: "none" }}
        aria-hidden="true"
      />
      <button
        ref={toolbarRef}
        type="button"
        className={
          active
            ? "david-gc-toolbar david-gc-toolbar--active"
            : "david-gc-toolbar"
        }
        data-david-global-capture="toolbar"
        style={{ zIndex: 10001, pointerEvents: "auto" }}
        aria-pressed={active}
        aria-label={active ? "退出框选评价模式" : "进入框选评价模式"}
        onClick={toggleMode}
      >
        {active ? "拖动框选 · Esc取消" : "框选评价"}
      </button>
    </div>,
    document.body,
  );
}
