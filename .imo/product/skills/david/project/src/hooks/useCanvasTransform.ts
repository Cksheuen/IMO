/**
 * Pan / zoom gesture controller for a canvas viewport.
 *
 * - wheel: zoom anchored at the cursor (non-passive native listener so the
 *   page never scrolls while zooming); scale clamped 0.25–3.
 * - left-button drag (or Space+drag): pan; movement beyond the 5px click
 *   threshold becomes a pan and the subsequent click is captured-and-stopped
 *   so node / component navigation never fires from a drag.
 * - prefers-reduced-motion: transform changes apply instantly.
 *
 * The hook is surface-agnostic: the overview frame uses it with the default
 * single-layer model; the dock preview passes live `layer` values (outer FLIP
 * scale / inner clone fit scale / scroll offsets) so anchored zoom composes
 * correctly through the dock's legacy scaling models.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { createContext } from "react";
import {
  CANVAS_CLICK_THRESHOLD_PX,
  IDENTITY_CANVAS_TRANSFORM,
  canvasTransformCss,
  exceedsClickThreshold,
  fitTransform,
  panBy,
  panWorldDelta,
  screenToCanvasPoint,
  screenToContentPoint,
  type Point,
  zoomAtClientWithLayer,
  type CanvasLayerContext,
  type CanvasTransform,
  type FitMode,
} from "../lib/canvasGeometry";

export interface CanvasTransformContextValue {
  resolvePoint: (client: Point) => Point | undefined;
}

/**
 * Current canvas transform for the active preview surface. Consumed by the
 * global region-selection capture (A4) to back-compute logical canvas points;
 * `null` means no canvas is mounted and the consumer must omit canvasPoint.
 */
export const CanvasTransformContext =
  createContext<CanvasTransformContextValue | null>(null);

export const useCanvasTransformContext =
  (): CanvasTransformContextValue | null => useContext(CanvasTransformContext);

type TransformPatch = CanvasTransform;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  panning: boolean;
  space: boolean;
}

interface PendingClickSuppression {
  x: number;
  y: number;
  at: number;
}

export interface UseCanvasTransformOptions {
  /** Gate all gestures (e.g. dock gestures only while docked). */
  enabled?: () => boolean;
  /** Live dock layer composition; omitted for the single-layer frame. */
  layer?: () => Partial<CanvasLayerContext>;
  /** Content element used by fit(). */
  contentRef?: RefObject<HTMLElement | null>;
  /** Notified on every committed transform change (for context bridging). */
  onTransformChange?: (transform: CanvasTransform) => void;
}

export interface CanvasTransformApi {
  transform: CanvasTransform;
  resolvePoint: (client: Point) => Point | undefined;
  /** CSS transform string for the world element. */
  transformCss: string;
  /** Whether an animated (button-driven) transition should be applied. */
  animated: boolean;
  /** Whether a pan gesture is live (drives the grabbing cursor). */
  isPanning: boolean;
  /** True while the current pointer interaction moved past the click limit. */
  didDrag: MutableRefObject<boolean>;
  zoomAt: (clientX: number, clientY: number, factor: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  panBy: (dx: number, dy: number) => void;
  reset: () => void;
  fit: (mode?: FitMode, animate?: boolean) => void;
  setTransform: (next: TransformPatch, animated?: boolean) => void;
  bind: {
    onWheel: (event: React.WheelEvent<HTMLElement>) => void;
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
}

const CLICK_SUPPRESSION_MS = 500;
const CLICK_SUPPRESSION_TOLERANCE_PX = 6;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const BUTTON_ZOOM_FACTOR = 1.25;

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable) return true;
  return false;
};

/**
 * Space arms pan only over non-interactive content: pressing Space while a
 * button/link/summary is focused must keep its native activation behaviour.
 */
const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  const element = target as HTMLElement;
  if (isEditableTarget(target)) return true;
  const tag = element.tagName;
  if (
    tag === "BUTTON" ||
    tag === "A" ||
    tag === "SUMMARY" ||
    tag === "OPTION" ||
    tag === "LABEL"
  ) {
    return true;
  }
  if (element.closest("button, a, summary, [role='button'], [tabindex]")) {
    return true;
  }
  return false;
};

const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/**
 * Global appearance-capture mode (owned by GlobalRegionSelection, A4): it
 * toggles `body.david-gc-mode` and captures pointer events at document level.
 * While active every canvas gesture (wheel zoom included — the capture layer
 * does not listen for wheel, so without this gate the non-passive wheel
 * listener would block page scrolling while a selection rectangle is being
 * placed) yields to the selection overlay.
 */
const isRegionCaptureActive = (): boolean => {
  if (typeof document === "undefined" || !document.body) return false;
  return document.body.classList.contains("david-gc-mode");
};

export function useCanvasTransform(
  containerRef: RefObject<HTMLElement | null>,
  options: UseCanvasTransformOptions = {},
): CanvasTransformApi {
  const [transform, setTransformState] = useState<CanvasTransform>(
    IDENTITY_CANVAS_TRANSFORM,
  );
  const [animated, setAnimated] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const transformRef = useRef(transform);
  const dragRef = useRef<DragState | null>(null);
  const didDrag = useRef(false);
  const pendingClickRef = useRef<PendingClickSuppression | null>(null);
  const spaceDownRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const animateResetTimerRef = useRef<number | undefined>(undefined);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const isEnabled = useCallback(() => {
    if (isRegionCaptureActive()) return false;
    const gate = optionsRef.current.enabled;
    return gate ? gate() : true;
  }, []);

  const commit = useCallback((next: CanvasTransform, animate: boolean) => {
    transformRef.current = next;
    setTransformState(next);
    const canAnimate = animate && !prefersReducedMotion();
    if (canAnimate) {
      setAnimated(true);
      window.clearTimeout(animateResetTimerRef.current);
      animateResetTimerRef.current = window.setTimeout(() => {
        setAnimated(false);
      }, 200);
    } else {
      setAnimated(false);
    }
  }, []);

  const setTransform = useCallback(
    (next: CanvasTransform, animate = false) => {
      commit(next, animate);
    },
    [commit],
  );

  const contentOrigin = useCallback(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    const layer = optionsRef.current.layer?.() ?? {};
    const outer = layer.outerScale ?? 1;
    return {
      element,
      rect,
      layer,
      origin: {
        left: rect.left + element.clientLeft * outer,
        top: rect.top + element.clientTop * outer,
      },
    };
  }, [containerRef]);
  const resolvePoint = useCallback(
    (client: Point): Point | undefined => {
      const current = contentOrigin();
      if (!current || current.element.closest("[inert]")) return undefined;
      const { rect, layer, origin } = current;
      if (
        client.x < rect.left ||
        client.x > rect.right ||
        client.y < rect.top ||
        client.y > rect.bottom
      )
        return undefined;
      return screenToContentPoint(client, origin, transformRef.current, layer);
    },
    [contentOrigin],
  );

  const applyZoomAt = useCallback(
    (clientX: number, clientY: number, factor: number, animate: boolean) => {
      if (!isEnabled()) return;
      const current = contentOrigin();
      if (!current) return;
      const { origin: rect, layer } = current;
      const next = zoomAtClientWithLayer(
        transformRef.current,
        { x: clientX, y: clientY },
        rect,
        layer,
        factor,
      );
      if (next === transformRef.current) return;
      commit(next, animate);
    },
    [commit, contentOrigin, isEnabled],
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      applyZoomAt(clientX, clientY, factor, false);
    },
    [applyZoomAt],
  );

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      applyZoomAt(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        factor,
        true,
      );
    },
    [applyZoomAt, containerRef],
  );

  const zoomIn = useCallback(
    () => zoomAtCenter(BUTTON_ZOOM_FACTOR),
    [zoomAtCenter],
  );
  const zoomOut = useCallback(
    () => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR),
    [zoomAtCenter],
  );

  const panByScreen = useCallback(
    (dx: number, dy: number) => {
      if (!isEnabled()) return;
      const layer = optionsRef.current.layer?.() ?? {};
      const delta = panWorldDelta(dx, dy, layer);
      commit(panBy(transformRef.current, delta.x, delta.y), false);
    },
    [commit, isEnabled],
  );

  const panByApi = useCallback(
    (dx: number, dy: number) => panByScreen(dx, dy),
    [panByScreen],
  );

  const reset = useCallback(() => {
    commit(IDENTITY_CANVAS_TRANSFORM, !prefersReducedMotion());
  }, [commit]);

  const fit = useCallback(
    (mode: FitMode = "contain", animate = true) => {
      const container = containerRef.current;
      const content = optionsRef.current.contentRef?.current;
      if (!container) return;
      const viewport = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      const contentSize = content
        ? { width: content.offsetWidth, height: content.offsetHeight }
        : viewport;
      commit(
        fitTransform(contentSize, viewport, { mode }),
        animate && !prefersReducedMotion(),
      );
    },
    [commit, containerRef],
  );

  // Native non-passive wheel: React's delegated onWheel is passive at the
  // root, so preventDefault there cannot stop page/container scrolling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!isEnabled()) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      applyZoomAt(event.clientX, event.clientY, factor, false);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerRef, applyZoomAt, isEnabled]);

  // Capture-phase click suppression: after a pan, the browser still dispatches
  // a click on the common ancestor of the down/up targets. Stop it before it
  // reaches React's delegated listeners (node navigation lives there).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClickCapture = (event: MouseEvent) => {
      const pending = pendingClickRef.current;
      if (!pending) return;
      pendingClickRef.current = null;
      if (Date.now() - pending.at > CLICK_SUPPRESSION_MS) return;
      if (
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >
        CLICK_SUPPRESSION_TOLERANCE_PX
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    container.addEventListener("click", onClickCapture, true);
    return () => container.removeEventListener("click", onClickCapture, true);
  }, [containerRef]);

  // Space-drag panning: only arm while the pointer is over the container and
  // the focused element is not editable, so Space still activates buttons and
  // types in inputs elsewhere on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (isInteractiveTarget(event.target)) return;
      if (!pointerInsideRef.current || !isEnabled()) return;
      spaceDownRef.current = true;
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceDownRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isEnabled]);

  useEffect(
    () => () => {
      window.clearTimeout(animateResetTimerRef.current);
    },
    [],
  );

  const endDrag = useCallback(
    (
      event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">,
      cancelled: boolean,
    ) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;
      try {
        containerRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released.
      }
      if (drag.panning && !cancelled) {
        pendingClickRef.current = {
          x: event.clientX,
          y: event.clientY,
          at: Date.now(),
        };
      }
      dragRef.current = null;
      setIsPanning(false);
    },
    [containerRef],
  );

  // Below the threshold no capture is held, so release may occur off-stage.
  useEffect(() => {
    const up = (event: PointerEvent) => endDrag(event, false);
    const cancel = (event: PointerEvent) => endDrag(event, true);
    const blur = () => {
      dragRef.current = null;
      spaceDownRef.current = false;
      setIsPanning(false);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
    };
  }, [endDrag]);

  const bind = useMemo<CanvasTransformApi["bind"]>(
    () => ({
      onWheel: (event) => {
        // The native non-passive listener on the container already handled
        // (and preventDefaulted) this event; skip the React delegate to avoid
        // applying the zoom twice.
        if (event.nativeEvent.defaultPrevented) return;
        if (!isEnabled()) return;
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
        applyZoomAt(event.clientX, event.clientY, factor, false);
      },
      onPointerDown: (event) => {
        if (!isEnabled()) return;
        if (!event.isPrimary || event.button !== 0) return;
        const space = spaceDownRef.current;
        // Plain left-drag starts over anything (clicks survive inside the 5px
        // threshold); space-drag never starts on interactive targets.
        if (space && isInteractiveTarget(event.target)) return;
        if (!space && isEditableTarget(event.target)) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          panning: false,
          space,
        };
        didDrag.current = false;
        pendingClickRef.current = null;
        // Pointer capture is deferred until the gesture is confirmed as a pan
        // (beyond the click threshold). Inside the threshold native text
        // selection and click handling stay completely untouched.
      },
      onPointerMove: (event) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        if ((event.buttons & 1) === 0 || !isEnabled()) {
          endDrag(event, true);
          return;
        }
        if (!drag.panning) {
          if (
            !exceedsClickThreshold(
              event.clientX - drag.startX,
              event.clientY - drag.startY,
              CANVAS_CLICK_THRESHOLD_PX,
            )
          ) {
            return;
          }
          drag.panning = true;
          didDrag.current = true;
          setIsPanning(true);
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // The container may lose the pointer mid-gesture.
          }
          // Panning wins over the in-flight native text selection: drop it so
          // it does not linger as a visible selection after the drag.
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            // Selection can be unavailable in some embed contexts.
          }
        }
        event.preventDefault();
        panByScreen(event.clientX - drag.lastX, event.clientY - drag.lastY);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
      },
      onPointerUp: (event) => endDrag(event, false),
      onPointerCancel: (event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          spaceDownRef.current = false;
        }
        endDrag(event, true);
      },
      onPointerEnter: () => {
        pointerInsideRef.current = true;
      },
      onPointerLeave: () => {
        pointerInsideRef.current = false;
      },
    }),
    [applyZoomAt, endDrag, isEnabled, panByScreen],
  );

  const onTransformChange = options.onTransformChange;
  useEffect(() => {
    onTransformChange?.(transform);
  }, [transform, onTransformChange]);

  return {
    transform,
    resolvePoint,
    transformCss: canvasTransformCss(transform),
    animated,
    isPanning,
    didDrag,
    zoomAt,
    zoomIn,
    zoomOut,
    panBy: panByApi,
    reset,
    fit,
    setTransform,
    bind,
  };
}

/** Convenience for consumers that need to back-compute logical points. */
export const screenPointToCanvas = (
  client: { x: number; y: number },
  rect: Pick<DOMRect, "left" | "top">,
  transform: CanvasTransform,
): { x: number; y: number } =>
  screenToCanvasPoint(
    { x: client.x - rect.left, y: client.y - rect.top },
    transform,
  );

export type { CanvasTransform };
