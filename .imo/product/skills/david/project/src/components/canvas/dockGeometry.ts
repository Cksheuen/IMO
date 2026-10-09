import { bindNativeClone } from "../../lib/nativeControls";
/**
 * Imperative geometry of the component dock preview.
 *
 * The dock keeps the legacy FLIP-driven layout models (transform / scrollable
 * viewport / 1:1 canvas / fullpage host). The DOM contract is unchanged by the
 * pan/zoom work:
 *
 *   transform / fullpage model:
 *     .component-dock            (fixed box; FLIP transform scale here)
 *       > clone                  (the cloned component root, direct child)
 *
 *   viewport (clamped) / canvas model:
 *     .component-dock            (fixed box, overflow:auto — scroll container)
 *       > .component-dock-scroll-content (in-flow placeholder, rect*scale)
 *           > clone
 *
 * The user pan/zoom transform is composed onto the clone itself (merged with
 * the legacy inner fit scale), so no extra React-owned wrapper element breaks
 * the `dock.firstElementChild` contract relied on by the drilldown tests.
 */
import {
  applyFlipPose,
  captureRect,
  flipPosition,
  type FlipPose,
} from "../../lib/flip";
import type { CanvasTransform } from "../../lib/canvasGeometry";
import { IDENTITY_CANVAS_TRANSFORM } from "../../lib/canvasGeometry";

/** dock 预览的基准宽度下限。实际宽度按可用空间自适应放大（见 dockWidthFor）。 */
const DOCK_WIDTH = 340;
/** dock 预览允许占用的最大可用宽度比例：留出 PRD 列的阅读宽度，不遮挡。 */
const DOCK_WIDTH_AVAILABLE_RATIO = 0.52;
/** dock 预览宽度上限：再宽也不挤压 PRD 列。 */
const DOCK_WIDTH_MAX = 560;
const DOCK_TOP = 22;
const DOCK_RIGHT = 22;
const DOCK_LEFT = 22;
const DOCK_RAIL_GAP = 12;
const DOCK_RAIL_COLLAPSED_GUTTER = 60;
/** dock 预览统一缩放下限。低于该值的宽内容不得再整体压小，改走可滚动视口，保持文字可读。 */
const MIN_DOCK_SCALE = 0.62;
/** 可滚动视口模型中承载缩放后占位尺寸的滚动内容层，使滚动范围按 rect * scale 计算。 */
export const SCROLL_WRAPPER_CLASS = "component-dock-scroll-content";

export const DOCK_SWITCH_EASING = "cubic-bezier(0.22, 0.8, 0.24, 1)";

export const cancelAnimation = (animation: Animation | undefined) => {
  if (!animation) return;
  animation.onfinish = null;
  try {
    animation.cancel();
  } catch {
    // The dock can be hidden or detached by an interrupted import/return.
  }
};

type AnimationSettlement = {
  finish: () => void;
  cancel: () => void;
};

/** flipPosition has already applied the final inline pose, so never commitStyles. */
export const settleAnimation = (
  animation: Animation | undefined,
  onDone: () => void,
): AnimationSettlement => {
  let settled = false;
  const settlement: AnimationSettlement = {
    finish: () => {
      if (settled) return;
      settled = true;
      cancelAnimation(animation);
      onDone();
    },
    cancel: () => {
      if (settled) return;
      settled = true;
      cancelAnimation(animation);
    },
  };

  if (animation) {
    animation.onfinish = () => settlement.finish();
  } else {
    settlement.finish();
  }
  return settlement;
};

export const clearHost = (host: HTMLElement | null) => host?.replaceChildren();

/**
 * 整页宿主判据（双重且）：
 * 1. 节点作者显式声明 interaction === "drilldown"（原始值，不含 plugin 推导）；
 * 2. 锚点元素带 data-review-host="fullpage"。
 * 缺一个即为普通 drilldown，走既有 dock 替换。不做子树宽度/子节点数等启发式推断。
 */
export const isFullpageHostNode = (
  anchor: string,
  anchorEl: HTMLElement | null | undefined,
  isExplicitDrilldown: ((anchor: string) => boolean) | undefined,
): boolean => {
  if (!isExplicitDrilldown?.(anchor)) return false;
  return anchorEl?.getAttribute("data-review-host") === "fullpage";
};

let cloneFragmentSequence = 0;

/** Keep an SVG clone's paint/clip references inside that clone. Hidden source
 * SVGs and repeated icons otherwise win document-wide fragment ID lookup. */
function scopeSvgFragments(root: HTMLElement) {
  const prefix = `david-svg-clone-${++cloneFragmentSequence}`;
  const svgs = [
    ...(root.matches("svg") ? [root] : []),
    ...root.querySelectorAll("svg"),
  ];
  svgs.forEach((svg, index) => {
    const elements = [svg, ...svg.querySelectorAll("*")];
    const definitions = new Map(
      [...svg.querySelectorAll("[id]")].map((element) => [element.id, element]),
    );
    const remapped = new Map<string, string>();
    const localId = (id: string) => {
      if (!definitions.has(id)) return id;
      if (!remapped.has(id)) remapped.set(id, `${prefix}-${index}-${id}`);
      return remapped.get(id)!;
    };
    for (const element of elements) {
      for (const attribute of [...element.attributes]) {
        let value = attribute.value.replace(
          /url\(\s*(["']?)#([^\s)'"]+)\1\s*\)/g,
          (_match, _quote: string, id: string) => `url(#${localId(id)})`,
        );
        if (
          ["href", "xlink:href"].includes(attribute.name) &&
          value.startsWith("#")
        ) {
          value = `#${localId(value.slice(1))}`;
        }
        if (value !== attribute.value)
          element.setAttribute(attribute.name, value);
      }
    }
    for (const [id, next] of remapped) definitions.get(id)!.id = next;
  });
}

export const mountComponentClone = (
  host: HTMLElement | null,
  source: HTMLElement | null,
): HTMLElement | null => {
  if (!host || !source) return null;
  const clone = source.cloneNode(true) as HTMLElement;
  bindNativeClone(source, clone);
  scopeSvgFragments(clone);
  host.replaceChildren();
  clone.classList.remove(
    "is-active",
    "is-selected",
    "is-hidden-component",
    // 补充板在主画板中被视觉隐藏（1×1 + clip-path），克隆到 dock 后必须还原，
    // 否则 dock 里显示的是一条没有宽度的内容。
    "is-supplementary-board",
    "david-overview-linked",
  );
  clone
    .querySelectorAll(".david-overview-linked")
    .forEach((el) => el.classList.remove("david-overview-linked"));
  if (clone instanceof HTMLDetailsElement) {
    clone.open = true;
    clone.setAttribute("data-david-drilldown-open", "");
  }
  host.appendChild(clone);
  return clone;
};

/**
 * dock 可用右边界（距视口右缘的内缩量）：
 * - 反馈栏展开且为 fixed 时，从 rail 左边界扣间隙，避免 dock 压在栏下；
 * - 反馈栏收起为折叠条（comment-rail-collapsed）时，保留至少 60px 右 gutter；
 * - 栏收起 / 窄屏流式（static）时不扣，保持 DOCK_RIGHT，不虚扣空间。
 * 判据只认 fixed 可见 rail 的真实左边界，不复制 CSS 宽度政策。
 */
export const dockRightInset = (): number => {
  if (typeof document === "undefined") return DOCK_RIGHT;

  const rail = document.querySelector<HTMLElement>(".comment-rail");
  if (!rail) return DOCK_RIGHT;
  if (getComputedStyle(rail).position !== "fixed") return DOCK_RIGHT;

  if (document.body.classList.contains("comment-rail-collapsed")) {
    return Math.max(DOCK_RIGHT, DOCK_RAIL_COLLAPSED_GUTTER);
  }
  if (!document.body.classList.contains("comment-rail-open")) return DOCK_RIGHT;

  const rect = rail.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return DOCK_RIGHT;
  return Math.max(DOCK_RIGHT, window.innerWidth - rect.left + DOCK_RAIL_GAP);
};

/** Dock 保留源组件的基础尺寸，视觉尺寸只通过统一 scale 缩放。 */
export const setDockBaseSize = (dock: HTMLElement, rect: DOMRect) => {
  dock.style.position = "fixed";
  dock.style.width = `${Math.round(rect.width)}px`;
  dock.style.height = `${Math.round(rect.height)}px`;
  dock.style.maxHeight = "none";
  // 可滚动视口模型下 offsetWidth/offsetHeight 为视口尺寸，须单独留底自然尺寸，
  // 供 resize 重算时还原源组件的基础 rect。
  dock.dataset.baseWidth = String(Math.round(rect.width));
  dock.dataset.baseHeight = String(Math.round(rect.height));
};

/**
 * 下钻尺寸修正：目标为 details，或源节点布局尺寸为 0 时，
 * captureRect 拿到的只是 summary 尺寸；以展开后 clone 的自然布局尺寸为准，
 * 避免展开界面沿用 summary 高度超出视口。普通根组件不受影响，沿用原 rect。
 */
export const drilldownRectFor = (
  clone: HTMLElement | null,
  rect: DOMRect,
): DOMRect => {
  if (!clone) return rect;
  if (clone instanceof HTMLDetailsElement) {
    return new DOMRect(
      rect.left,
      rect.top,
      clone.offsetWidth,
      clone.offsetHeight,
    );
  }
  if (rect.width !== 0 || rect.height !== 0) return rect;
  return new DOMRect(
    rect.left,
    rect.top,
    clone.offsetWidth,
    clone.offsetHeight,
  );
};

const readTransformScale = (transform: string): number => {
  if (!transform || transform === "none") return 1;
  const values = transform
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map((value) => Number(value));
  if (!values || values.length < 2) return 1;
  return Math.hypot(values[0], values[1]) || 1;
};

/**
 * Effective fit scale of the currently displayed clone, regardless of which
 * legacy dock model is active. Used to keep drilldown FLIP anchors correct.
 */
export const currentDockScale = (dock: HTMLElement): number => {
  if (
    dock.dataset.dockModel === "viewport" ||
    dock.dataset.dockModel === "canvas"
  ) {
    const stored = Number(dock.dataset.dockFitScale);
    if (Number.isFinite(stored) && stored > 0) return stored;
  }
  return readTransformScale(getComputedStyle(dock).transform);
};

export type DockMetrics = {
  stacked: boolean;
  rightInset: number;
  maxWidth: number;
  maxHeight: number;
  scale: number;
  clamped: boolean;
  visualWidth: number;
  visualHeight: number;
};

const dockToolGutter = () =>
  document.querySelector<HTMLElement>(".component-dock")?.dataset.gestures ===
  "canvas"
    ? 64
    : 0;

export const dockMetricsFor = (
  rect: DOMRect,
  fullpage = false,
  canvasView = false,
): DockMetrics => {
  if (fullpage) {
    // 整页宿主：跳过钳制，scale 固定 1，不 wrap、不 overflow:auto。
    return {
      stacked: false,
      rightInset: dockRightInset(),
      maxWidth: Math.max(rect.width, 1),
      maxHeight: Math.max(rect.height, 1),
      scale: 1,
      clamped: false,
      visualWidth: rect.width,
      visualHeight: rect.height,
    };
  }
  const rightInset = dockRightInset();
  const available = Math.max(
    1,
    window.innerWidth - rightInset - DOCK_RIGHT - dockToolGutter(),
  );
  const preferredWidth = Math.min(
    DOCK_WIDTH_MAX,
    Math.max(DOCK_WIDTH, available * DOCK_WIDTH_AVAILABLE_RATIO),
  );
  // rect.width 为 0（尚未布局 / 空 mapping 组件）时不能参与钳制。
  const contentCap = rect.width > 0 ? rect.width : Number.POSITIVE_INFINITY;
  const height = Math.max(1, window.innerHeight - DOCK_TOP * 2);
  const sideWidth = Math.min(preferredWidth, available, contentCap);
  const sideScale = canvasView
    ? 1
    : Math.max(
        MIN_DOCK_SCALE,
        Math.min(1, sideWidth / rect.width, height / rect.height),
      );
  const wideWidth = Math.min(available, contentCap);
  const wideScale = canvasView
    ? 1
    : Math.max(MIN_DOCK_SCALE, Math.min(1, wideWidth / rect.width));
  // Decide from natural content + available viewport, never an animated rect.
  // Landscape boards can grow without losing their stacked layout while the
  // complete widened preview still leaves a 20px gap and >= 320px for TRD.
  // Keep tall screens beside the inspector; small portrait widgets retain the
  // existing short-preview behavior. Tools occupy a separate right gutter.
  const stackedHeightBudget = height - 340;
  const prefersStack =
    rect.width >= rect.height || rect.height * sideScale <= height * 0.42;
  const stacked =
    rect.height > 0 &&
    prefersStack &&
    rect.height * wideScale <= stackedHeightBudget;
  const maxWidth = stacked ? wideWidth : sideWidth;
  const maxHeight = stacked ? Math.max(1, stackedHeightBudget) : height;
  if (canvasView) {
    // 等比放大（1:1）：深层画板不压缩内容，超出可用区走可滚动视口。
    return {
      stacked,
      rightInset,
      maxWidth,
      maxHeight,
      scale: 1,
      clamped: rect.width > maxWidth || rect.height > maxHeight,
      visualWidth: Math.min(rect.width, maxWidth),
      visualHeight: Math.min(rect.height, maxHeight),
    };
  }
  const fitScale = Math.min(1, maxWidth / rect.width, maxHeight / rect.height);
  const scale = Math.max(MIN_DOCK_SCALE, fitScale);
  return {
    stacked,
    rightInset,
    maxWidth,
    maxHeight,
    scale,
    clamped: scale > fitScale,
    visualWidth: rect.width * scale,
    visualHeight: rect.height * scale,
  };
};

const resetCloneInline = (clone: HTMLElement | null) => {
  if (!clone) return;
  clone.style.position = "";
  clone.style.top = "";
  clone.style.left = "";
  clone.style.width = "";
  clone.style.maxWidth = "";
  clone.style.transform = "";
  clone.style.transformOrigin = "";
  clone.style.transition = "";
};

/** Wrapper element for the clamped / canvas models (`dock.firstElementChild`). */
export const getScrollWrapper = (dock: HTMLElement): HTMLElement | null =>
  dock.querySelector<HTMLElement>(`:scope > .${SCROLL_WRAPPER_CLASS}`);

const ensureScrollWrapper = (dock: HTMLElement): HTMLElement => {
  const existing = getScrollWrapper(dock);
  if (existing) return existing;
  const wrapper = document.createElement("div");
  wrapper.className = SCROLL_WRAPPER_CLASS;
  dock.appendChild(wrapper);
  return wrapper;
};

const removeScrollWrapper = (dock: HTMLElement) => {
  getScrollWrapper(dock)?.remove();
};

/** Currently mounted clone (inside the wrapper, or the dock's direct child). */
export const currentDockClone = (dock: HTMLElement): HTMLElement | null => {
  const wrapper = getScrollWrapper(dock);
  const inWrapper = wrapper
    ? (wrapper.firstElementChild as HTMLElement | null)
    : null;
  const direct = dock.firstElementChild as HTMLElement | null;
  const candidate =
    inWrapper ??
    (direct && !direct.classList.contains(SCROLL_WRAPPER_CLASS)
      ? direct
      : null);
  return candidate instanceof HTMLElement ? candidate : null;
};

/**
 * User pan/zoom view composed onto the clone. In the viewport model the legacy
 * inner fit scale merges with the user scale; the transform / canvas models
 * have inner scale 1; the fullpage model stays untouched (gestures disabled).
 */
export interface DockUserView {
  transform: CanvasTransform;
  /** Button-driven zoom gets a short transition; wheel / drag never animates. */
  animated?: boolean;
}

const DOCK_USER_TRANSITION = "transform 180ms cubic-bezier(0.22, 0.8, 0.24, 1)";

export const applyDockUserView = (
  dock: HTMLElement,
  view: DockUserView,
): void => {
  const clone = currentDockClone(dock);
  if (!clone) return;
  if (dock.dataset.dockModel === "fullpage") {
    clone.style.transform = "";
    clone.style.transition = "";
    return;
  }
  const { scale, offsetX, offsetY } = view.transform;
  const model = dock.dataset.dockModel;
  let inner = 1;
  if (model === "viewport") {
    const fit = Number(dock.dataset.dockFitScale);
    if (Number.isFinite(fit) && fit > 0) inner = fit;
  }
  clone.style.transformOrigin = "0 0";
  clone.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale * inner})`;
  clone.style.transition = view.animated ? DOCK_USER_TRANSITION : "none";
};

const configureCloneBox = (
  clone: HTMLElement | null,
  model: "viewport" | "canvas" | "transform",
  rect: DOMRect,
) => {
  if (!clone) return;
  if (model === "transform") {
    // Natural model: the clone flows inside the dock box; the dock itself
    // carries the FLIP fit scale.
    resetCloneInline(clone);
    return;
  }
  // Clamped / canvas model: absolute inside the in-flow placeholder wrapper,
  // natural width, visual scale composed via applyDockUserView.
  clone.style.position = "absolute";
  clone.style.top = "0";
  clone.style.left = "0";
  clone.style.width = `${rect.width}px`;
  clone.style.maxWidth = "none";
};

/**
 * Configure the scroll placeholder for the clamped / canvas models. It is the
 * dock's in-flow first child with the scaled (or natural) content box, so the
 * dock's native scroll range equals the content extent; its overflow is hidden
 * so the absolutely-positioned, user-transformed clone never enlarges the
 * scroll range.
 */
const configureScrollWrapper = (
  dock: HTMLElement,
  rect: DOMRect,
  scale: number,
) => {
  const wrapper = ensureScrollWrapper(dock);
  wrapper.style.position = "relative";
  wrapper.style.width = `${Math.round(rect.width * scale)}px`;
  wrapper.style.height = `${Math.round(rect.height * scale)}px`;
  wrapper.style.minWidth = "0";
  wrapper.style.minHeight = "0";
  wrapper.style.resize = "none";
  wrapper.style.overflow = "hidden";
};

/**
 * Move the current clone between the dock (direct child) and the scroll
 * wrapper without rebuilding it, then configure its box / transform.
 */
const settleClonePlacement = (
  dock: HTMLElement,
  model: "transform" | "viewport" | "canvas" | "fullpage",
  rect: DOMRect,
  view: DockUserView,
) => {
  const needsWrapper = model === "viewport" || model === "canvas";
  const wrapper = getScrollWrapper(dock);
  if (needsWrapper) {
    const target = wrapper ?? ensureScrollWrapper(dock);
    const clone = currentDockClone(dock);
    if (clone && clone.parentElement !== target) target.appendChild(clone);
    configureCloneBox(clone, model, rect);
    applyDockUserView(dock, view);
  } else {
    const wrapped = currentDockClone(dock);
    if (wrapped && wrapper) dock.appendChild(wrapped);
    removeScrollWrapper(dock);
    const clone = currentDockClone(dock);
    resetCloneInline(clone);
    if (model === "transform") applyDockUserView(dock, view);
  }
};

const clearDockBoxStyles = (dock: HTMLElement) => {
  dock.style.position = "";
  dock.style.top = "";
  dock.style.left = "";
  dock.style.right = "";
  dock.style.width = "";
  dock.style.height = "";
  dock.style.transform = "";
  dock.style.transformOrigin = "";
  dock.style.overflow = "";
  dock.style.maxHeight = "";
};

/**
 * 落位 dock：
 * - 未被钳制（scale >= MIN_DOCK_SCALE）时沿用「自然尺寸 + transform scale」原模型，
 *   clone 是 dock 的直接子节点；
 * - 被钳制时切换为「受限可滚动视口」模型：dock 固定为视口尺寸并 overflow:auto，
 *   直接子节点是 .component-dock-scroll-content 占位层（rect*scale），clone 绝对
 *   定位其内、自然宽度；
 * - canvas 深层画板为 1:1 可滚动视口；fullpage 宿主交还 CSS grid。
 * 用户 pan/zoom view 复合在 clone 上（viewport 模型与 inner fit scale 相乘）。
 */
/** Publish the terminal preview boundary before paint; never measure a running FLIP. */
const publishDockBoundary = (
  dock: HTMLElement,
  right?: number,
  bottom?: number,
) => {
  const stage = dock.closest<HTMLElement>(".stage");
  if (bottom !== undefined) {
    dock.dataset.previewBottom = String(bottom);
    stage?.setAttribute("data-preview-layout", "stacked");
    const contentTop = bottom + 20;
    dock.dataset.previewContentTop = String(contentTop);
    stage?.style.setProperty("--david-preview-bottom", `${contentTop}px`);
  } else {
    delete dock.dataset.previewBottom;
    delete dock.dataset.previewContentTop;
    stage?.removeAttribute("data-preview-layout");
    stage?.style.removeProperty("--david-preview-bottom");
  }
  if (right !== undefined) {
    right += dock.dataset.gestures === "canvas" ? 64 : 0;
    dock.dataset.previewRight = String(right);
    stage?.style.setProperty("--david-preview-end", `${right + 16}px`);
  } else {
    delete dock.dataset.previewRight;
    stage?.style.removeProperty("--david-preview-end");
  }
};

export const settleDockPose = (
  dock: HTMLElement,
  rect: DOMRect,
  pose: FlipPose,
  fullpage = false,
  canvasView = false,
  view: DockUserView = { transform: IDENTITY_CANVAS_TRANSFORM },
) => {
  dock.dataset.baseWidth = String(Math.round(rect.width));
  dock.dataset.baseHeight = String(Math.round(rect.height));

  if (fullpage) {
    settleClonePlacement(dock, "fullpage", rect, view);
    dock.classList.remove("is-canvas-view");
    clearDockBoxStyles(dock);
    delete dock.dataset.dockFitScale;
    dock.dataset.dockModel = "fullpage";
    dock.closest(".stage")?.classList.add("is-fullpage-host");
    publishDockBoundary(dock);
    return;
  }

  dock.closest(".stage")?.classList.remove("is-fullpage-host");

  if (canvasView) {
    // 等比放大（1:1）深层画板：dock 落在可用区内并 overflow:auto，
    // 占位层承载自然尺寸，超出部分滚动可达（不压缩、不裁切预览）。
    configureScrollWrapper(dock, rect, 1);
    dock.classList.add("is-canvas-view");
    const m = dockMetricsFor(rect, false, true);
    const viewportWidth = m.visualWidth;
    const viewportHeight = m.visualHeight;
    const top = m.stacked
      ? DOCK_TOP
      : (window.innerHeight - viewportHeight) / 2;
    const left = DOCK_LEFT;
    dock.dataset.dockModel = "canvas";
    dock.dataset.dockFitScale = "1";
    dock.style.position = "fixed";
    dock.style.top = `${top}px`;
    dock.style.left = `${left}px`;
    dock.style.right = "auto";
    dock.style.transform = "none";
    dock.style.transformOrigin = "top left";
    dock.style.width = `${viewportWidth}px`;
    dock.style.height = `${viewportHeight}px`;
    dock.style.maxHeight = "none";
    dock.style.overflow = "auto";
    settleClonePlacement(dock, "canvas", rect, view);
    publishDockBoundary(
      dock,
      left + viewportWidth,
      m.stacked ? top + viewportHeight : undefined,
    );
    return;
  }

  const m = dockMetricsFor(rect);

  if (!m.clamped) {
    dock.classList.remove("is-canvas-view");
    setDockBaseSize(dock, rect);
    dock.style.overflow = "";
    applyFlipPose(dock, pose);
    dock.dataset.dockModel = "transform";
    dock.dataset.dockFitScale = String(m.scale);
    settleClonePlacement(dock, "transform", rect, view);
    publishDockBoundary(
      dock,
      pose.left + rect.width * pose.scale,
      m.stacked ? pose.top + rect.height * pose.scale : undefined,
    );
    return;
  }

  const viewportWidth = Math.min(m.maxWidth, m.visualWidth);
  const viewportHeight = Math.min(m.maxHeight, m.visualHeight);
  const top = m.stacked ? DOCK_TOP : (window.innerHeight - viewportHeight) / 2;
  const left = DOCK_LEFT;
  dock.dataset.dockModel = "viewport";
  dock.dataset.dockFitScale = String(m.scale);
  dock.classList.remove("is-canvas-view");
  dock.style.position = "fixed";
  dock.style.top = `${top}px`;
  dock.style.left = `${left}px`;
  dock.style.right = "auto";
  dock.style.transform = "none";
  dock.style.transformOrigin = "top left";
  dock.style.width = `${viewportWidth}px`;
  dock.style.height = `${viewportHeight}px`;
  dock.style.maxHeight = "none";
  dock.style.overflow = "auto";
  configureScrollWrapper(dock, rect, m.scale);
  settleClonePlacement(dock, "viewport", rect, view);
  publishDockBoundary(
    dock,
    left + viewportWidth,
    m.stacked ? top + viewportHeight : undefined,
  );
};

export const enterDockPose = (
  dock: HTMLElement,
  rect: DOMRect,
  from: FlipPose,
  to: FlipPose,
  view: DockUserView = { transform: IDENTITY_CANVAS_TRANSFORM },
): Animation | undefined => {
  settleDockPose(dock, rect, to, false, false, view);
  const viewport = dock.dataset.dockModel === "viewport";
  const fit = viewport ? Number(dock.dataset.dockFitScale) || 1 : 1;
  return flipPosition(
    dock,
    { ...from, scale: from.scale / fit },
    viewport
      ? {
          left: Number.parseFloat(dock.style.left),
          top: Number.parseFloat(dock.style.top),
          scale: 1,
        }
      : to,
    480,
  );
};

export const dockPoseFor = (
  rect: DOMRect,
  fullpage = false,
  canvasView = false,
): FlipPose => {
  const m = dockMetricsFor(rect, fullpage, canvasView);
  return {
    // 侧栏预览在预留列内垂直居中；内容过高时安全停在顶部留白内。
    top: m.stacked
      ? DOCK_TOP
      : Math.max(DOCK_TOP, (window.innerHeight - m.visualHeight) / 2),
    // 详情始终留在左侧画板区域；TRD 列表是唯一进入入口。
    left: DOCK_LEFT,
    scale: m.scale,
  };
};

/** 页面恢复后清除 FLIP 的几何内联样式，让 CSS 接管 dock 定位。 */
export const resetDockGeometry = (dock: HTMLElement) => {
  clearDockBoxStyles(dock);
  publishDockBoundary(dock);
  removeScrollWrapper(dock);
  resetCloneInline(currentDockClone(dock));
  dock.classList.remove("is-canvas-view");
  delete dock.dataset.baseWidth;
  delete dock.dataset.baseHeight;
  delete dock.dataset.dockModel;
  delete dock.dataset.dockFitScale;
  dock.closest(".stage")?.classList.remove("is-fullpage-host");
};

export { captureRect };
