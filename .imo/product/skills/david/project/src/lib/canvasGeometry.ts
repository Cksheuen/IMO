/**
 * Pure geometry for the pannable / zoomable review canvas.
 *
 * Coordinate convention: the canvas world is laid out in "content pixels"
 * (natural, unscaled). The viewport paints it with
 *
 *   screenPoint = contentPoint * scale + offset
 *
 * where `offset` is the translation of the world's top-left corner relative to
 * the viewport's content box. All helpers here are side-effect free so they can
 * be unit-tested in plain node and reused by both the overview frame and the
 * dock preview (which adds an outer/inner scale composition, see
 * {@link screenToContentPoint}).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Zoom limits shared by every canvas surface (HARD-GATE 19 keeps text readable). */
export const MIN_CANVAS_SCALE = 0.25;
export const MAX_CANVAS_SCALE = 3;

/**
 * Pointer movement (in CSS px) at or below this threshold is treated as a
 * click; beyond it the gesture becomes a pan and the resulting click must be
 * suppressed so node/component navigation never fires from a drag.
 */
export const CANVAS_CLICK_THRESHOLD_PX = 5;

/** Padding kept around fitted content (CSS px). */
export const CANVAS_FIT_PADDING = 24;

export const IDENTITY_CANVAS_TRANSFORM: CanvasTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clampScale = (
  scale: number,
  min: number = MIN_CANVAS_SCALE,
  max: number = MAX_CANVAS_SCALE,
): number => {
  if (!Number.isFinite(scale)) return 1;
  return clamp(scale, min, max);
};

/** Logical content point under a viewport (screen) point. */
export const screenToCanvasPoint = (p: Point, t: CanvasTransform): Point => ({
  x: (p.x - t.offsetX) / t.scale,
  y: (p.y - t.offsetY) / t.scale,
});

/** Viewport (screen) point for a logical content point. */
export const canvasToScreenPoint = (p: Point, t: CanvasTransform): Point => ({
  x: p.x * t.scale + t.offsetX,
  y: p.y * t.scale + t.offsetY,
});

/** Translate the world by CSS px; scale is untouched. */
export const panBy = (
  t: CanvasTransform,
  dx: number,
  dy: number,
): CanvasTransform => ({
  scale: t.scale,
  offsetX: t.offsetX + dx,
  offsetY: t.offsetY + dy,
});

/**
 * Zoom while keeping the content point under `anchor` (viewport-relative CSS
 * px) fixed. The new scale is clamped; when the scale is already at a limit the
 * transform is returned unchanged (no anchor drift at the bounds).
 */
export const zoomAtPoint = (
  t: CanvasTransform,
  anchor: Point,
  factor: number,
): CanvasTransform => {
  if (!Number.isFinite(factor) || factor <= 0) return t;
  const nextScale = clampScale(t.scale * factor);
  if (nextScale === t.scale) return t;
  const contentPoint = screenToCanvasPoint(anchor, t);
  return {
    scale: nextScale,
    offsetX: anchor.x - contentPoint.x * nextScale,
    offsetY: anchor.y - contentPoint.y * nextScale,
  };
};

export type FitMode = "contain" | "width";

export interface FitOptions {
  mode?: FitMode;
  /** Never auto-enlarge past this (default 1: natural size stays the ceiling). */
  maxScale?: number;
  minScale?: number;
  padding?: number;
}

/**
 * Compute a transform that fits `content` inside `viewport`.
 * - "contain": whole content visible (may shrink below natural size).
 * - "width": match content width (capped at maxScale); tall content stays
 *   pannable instead of being crushed into unreadable text.
 */
export const fitTransform = (
  content: Size,
  viewport: Size,
  options: FitOptions = {},
): CanvasTransform => {
  const {
    mode = "contain",
    maxScale = 1,
    minScale = MIN_CANVAS_SCALE,
    padding = 0,
  } = options;
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return IDENTITY_CANVAS_TRANSFORM;
  }
  const availableW = Math.max(1, viewport.width - padding * 2);
  const availableH = Math.max(1, viewport.height - padding * 2);
  const widthScale = availableW / content.width;
  const scale =
    mode === "width"
      ? clamp(Math.min(maxScale, widthScale), minScale, maxScale)
      : clamp(
          Math.min(maxScale, widthScale, availableH / content.height),
          minScale,
          maxScale,
        );
  return {
    scale,
    offsetX: (viewport.width - content.width * scale) / 2,
    offsetY:
      mode === "width"
        ? padding
        : (viewport.height - content.height * scale) / 2,
  };
};

/**
 * Click / drag classification. Movement at or below the threshold is a click,
 * anything strictly beyond it is a drag (pan).
 */
export const exceedsClickThreshold = (
  dx: number,
  dy: number,
  threshold: number = CANVAS_CLICK_THRESHOLD_PX,
): boolean => Math.hypot(dx, dy) > threshold;

export const isClickGesture = (
  dx: number,
  dy: number,
  threshold: number = CANVAS_CLICK_THRESHOLD_PX,
): boolean => !exceedsClickThreshold(dx, dy, threshold);

export const canvasTransformCss = (t: CanvasTransform): string =>
  `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`;

/**
 * Dock-specific composition.
 *
 * The dock preview can have scales on three nested layers:
 * - `outerScale`: scale on the dock box itself (the legacy FLIP "transform"
 *   model, where the whole dock carries the fit scale).
 * - user transform: translate + scale on the world layer (this module).
 * - `innerScale`: scale on the clone itself (the legacy scrollable "viewport"
 *   model, where the clone is shrunk inside a fixed dock box).
 *
 * The "canvas"/1:1 model and the overview frame have all three at 1 (the frame
 * only uses the user transform). Scroll offsets apply in the viewport model.
 *
 *   screen (viewport-content-box relative) =
 *     outerScale * (-scroll + offset + userScale * innerScale * content)
 */
export interface CanvasLayerContext {
  outerScale: number;
  innerScale: number;
  scrollLeft: number;
  scrollTop: number;
}

export const DEFAULT_CANVAS_LAYER: CanvasLayerContext = {
  outerScale: 1,
  innerScale: 1,
  scrollLeft: 0,
  scrollTop: 0,
};

/** Convert a client point to natural content pixels through all dock layers. */
export const screenToContentPoint = (
  client: Point,
  viewportRect: Pick<DOMRect, "left" | "top">,
  t: CanvasTransform,
  layer: Partial<CanvasLayerContext> = {},
): Point => {
  const ctx = { ...DEFAULT_CANVAS_LAYER, ...layer };
  const outer = ctx.outerScale > 0 ? ctx.outerScale : 1;
  const inner = ctx.innerScale > 0 ? ctx.innerScale : 1;
  const effective = outer * t.scale * inner;
  return {
    x:
      (client.x - viewportRect.left + outer * (ctx.scrollLeft - t.offsetX)) /
      effective,
    y:
      (client.y - viewportRect.top + outer * (ctx.scrollTop - t.offsetY)) /
      effective,
  };
};

/**
 * Anchor-zoom for the layered dock model. Keeps the content point under
 * `client` fixed and returns the next user transform.
 */
export const zoomAtClientWithLayer = (
  t: CanvasTransform,
  client: Point,
  viewportRect: Pick<DOMRect, "left" | "top">,
  layer: Partial<CanvasLayerContext> = {},
  factor: number,
): CanvasTransform => {
  if (!Number.isFinite(factor) || factor <= 0) return t;
  const ctx = { ...DEFAULT_CANVAS_LAYER, ...layer };
  const outer = ctx.outerScale > 0 ? ctx.outerScale : 1;
  const inner = ctx.innerScale > 0 ? ctx.innerScale : 1;
  const nextScale = clampScale(t.scale * factor);
  if (nextScale === t.scale) return t;
  const contentPoint = screenToContentPoint(client, viewportRect, t, ctx);
  return {
    scale: nextScale,
    offsetX:
      (client.x - viewportRect.left) / outer +
      ctx.scrollLeft -
      contentPoint.x * nextScale * inner,
    offsetY:
      (client.y - viewportRect.top) / outer +
      ctx.scrollTop -
      contentPoint.y * nextScale * inner,
  };
};

/**
 * Pan distance in world (user-transform) pixels for a screen-space pointer
 * delta. In the dock transform model the world itself is scaled by the outer
 * layer, so the translation divides by it.
 */
export const panWorldDelta = (
  dxScreen: number,
  dyScreen: number,
  layer: Partial<Pick<CanvasLayerContext, "outerScale">> = {},
): Point => {
  const outer = layer.outerScale && layer.outerScale > 0 ? layer.outerScale : 1;
  return { x: dxScreen / outer, y: dyScreen / outer };
};
