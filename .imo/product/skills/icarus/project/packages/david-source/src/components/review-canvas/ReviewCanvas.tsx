import {
  DETAIL_PREVIEW_START,
  DETAIL_PREVIEW_END,
  type DetailPreview,
} from "../../lib/detailPreview";
import {
  isNativeActivation,
  syncNativeControls,
} from "../../lib/nativeControls";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { scrollAndPulse } from "../../lib/pulseHighlight";
import { prepareReviewTargets } from "../../lib/domTargets";
import {
  applyFlipPose,
  captureRect,
  flipPosition,
  motionDuration,
  supportsReducedMotion,
  type FlipPose,
} from "../../lib/flip";
import {
  type CanvasTransformContextValue,
  useCanvasTransform,
} from "../../hooks/useCanvasTransform";
import type { HoverPopoverHandle } from "../HoverPopover";
import { NodeHoverPopover } from "./NodeHoverPopover";
import type { PageSpec } from "../../types/review";
import {
  isOverlayAction,
  nextOverlayId,
  renderSceneHtml,
  sceneComponentForElement,
  sceneInteractionForElement,
} from "../../lib/sceneRuntime";
import {
  CanvasViewport,
  DockPanel,
  GraphOverlay,
  PageStack,
  type ActiveNodeMode,
  type Phase,
} from "../canvas";
import {
  cancelAnimation,
  clearHost,
  currentDockScale,
  dockPoseFor,
  drilldownRectFor,
  DOCK_SWITCH_EASING,
  isFullpageHostNode,
  mountComponentClone,
  resetDockGeometry,
  settleAnimation,
  settleDockPose,
  enterDockPose,
  setDockBaseSize,
  applyDockUserView,
} from "../canvas/dockGeometry";
import "../../styles/canvas.css";

type Props = {
  pages: PageSpec[];
  activePageId: string;
  phase: Phase;
  instantNavigation?: boolean;
  activeComponentId?: string;
  nativeComponent?: boolean;
  activeNodeAnchor?: string;
  displayNodeAnchor?: string;
  activeNodeMode?: ActiveNodeMode;
  resolveNodeMode?: (anchor: string) => ActiveNodeMode | undefined;
  /** 整页宿主判据的一半：节点作者显式声明 interaction === "drilldown"
   * （原始值，不包含 plugin defaultInteraction 推导结果）。由 App 基于节点数据提供。 */
  isExplicitDrilldown?: (anchor: string) => boolean;
  /** canvas 深层画板判据：节点声明 canvas:true（纯节点数据，稳定回调）。 */
  isCanvasNode?: (anchor: string) => boolean;
  onNodeActivate?: (anchor: string, mode: ActiveNodeMode) => void;
  onSelect: (componentId?: string) => void;
  onPageChange: (pageId: string, nodeAnchor?: string) => void;
  /** 左侧叠层页：已访问页集合（分类 visited/adjacent）、翻页可用性与回调。 */
  visitedPages?: ReadonlySet<string>;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** canvas 页逻辑节点 hover 浮层的节点标签解析。 */
  resolveNodeLabel?: (anchor: string) => string | undefined;
  onEntered: () => void;
  onRestored: () => void;
  /** 补充板 component id：这些板在主画板中视觉隐藏，入口由 header 提供。 */
  supplementaryBoardIds?: string[];
  /** 当前活跃画板的 pan/zoom transform，上报给 App 桥接 CanvasTransformContext。 */
  onCanvasTransform?: (transform: CanvasTransformContextValue | null) => void;
  frameRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
};

/**
 * 页内 overlay 声明式交互（作者零 JS）：
 * - 触点元素带 data-review-overlay="<id>"
 * - 目标弹层带 data-review-overlay-id="<id>"
 * david 只负责在 frame/dock 范围内维护 is-overlay-show class；弹层的显隐、
 * 定位、动画全部由作者 CSS 控制。同一时刻只允许一个 overlay 打开。
 */
const OVERLAY_SHOW_CLASS = "is-overlay-show";
const overlayTargetSelector = (overlayId: string): string =>
  `[data-review-overlay-id="${CSS.escape(overlayId)}"], [data-review-element-id="${CSS.escape(overlayId)}"], [data-scene-id="${CSS.escape(overlayId)}"], [id="${CSS.escape(overlayId)}"]`;

export function ReviewCanvas({
  pages,
  activePageId,
  phase,
  instantNavigation = false,
  activeComponentId,
  nativeComponent = false,
  activeNodeAnchor,
  displayNodeAnchor,
  activeNodeMode,
  resolveNodeMode,
  isExplicitDrilldown,
  isCanvasNode,
  onNodeActivate,
  onSelect,
  onPageChange,
  visitedPages,
  canPrev,
  canNext,
  onPrev,
  onNext,
  resolveNodeLabel,
  onEntered,
  onRestored,
  supplementaryBoardIds,
  onCanvasTransform,
  frameRef,
  previewRef,
}: Props) {
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];
  const frameStageRef = useRef<HTMLDivElement>(null);
  const frameWorldRef = useRef<HTMLDivElement>(null);

  const lastPageRef = useRef(activePage);
  const [previousPage, setPreviousPage] = useState<PageSpec | undefined>();
  const [overlayState, setOverlayState] = useState<{
    pageId?: string;
    id: string | null;
  }>({ pageId: activePage?.id, id: null });
  const activeOverlayId =
    overlayState.pageId === activePage?.id ? overlayState.id : null;
  const overlayAriaStateRef = useRef(new Map<HTMLElement, string | null>());
  // 触点可能是内联 SVG 的 <path>/<svg>（TUX 图标均为 SVG），它们是 Element 而非
  // HTMLElement；这里放宽到 Element，focus 调用前再按能力探测。
  const overlayFocusOriginRef = useRef<Element | null>(null);
  const previousOverlayIdRef = useRef<string | null>(null);
  const setActiveOverlayId = useCallback(
    (next: string | null | ((current: string | null) => string | null)) => {
      setOverlayState((currentState) => {
        const current =
          currentState.pageId === activePage?.id ? currentState.id : null;
        const id = typeof next === "function" ? next(current) : next;
        return { pageId: activePage?.id, id };
      });
    },
    [activePage?.id],
  );

  const frameGestures =
    activePage?.kind === "canvas" || Boolean(activePage?.graph);
  const dockGestures =
    (frameGestures && !nativeComponent) ||
    Boolean(
      activeComponentId && supplementaryBoardIds?.includes(activeComponentId),
    ) ||
    Boolean(isCanvasNode?.(displayNodeAnchor ?? activeNodeAnchor ?? ""));

  const detailPreviewRef = useRef<{
    token: string;
    pageId?: string;
    previous: string | null;
  } | null>(null);
  useEffect(() => {
    const start = (event: Event) => {
      const detail = (event as CustomEvent<DetailPreview>).detail;
      const selector = overlayTargetSelector(detail.overlayId);
      if (
        !frameRef.current?.querySelector(selector) &&
        !previewRef.current?.querySelector(selector)
      )
        return;
      detailPreviewRef.current = {
        token: detail.token,
        pageId: activePage?.id,
        previous: activeOverlayId,
      };
      setActiveOverlayId(detail.overlayId);
    };
    const end = (event: Event) => {
      const previous = detailPreviewRef.current;
      if (
        previous?.token !==
        (event as CustomEvent<{ token: string }>).detail.token
      )
        return;
      detailPreviewRef.current = null;
      if (previous.pageId === activePage?.id)
        setActiveOverlayId(previous.previous);
    };
    window.addEventListener(DETAIL_PREVIEW_START, start);
    window.addEventListener(DETAIL_PREVIEW_END, end);
    return () => {
      window.removeEventListener(DETAIL_PREVIEW_START, start);
      window.removeEventListener(DETAIL_PREVIEW_END, end);
    };
  }, [
    activePage?.id,
    activeOverlayId,
    frameRef,
    previewRef,
    setActiveOverlayId,
  ]);

  // ---- pan / zoom controllers ---------------------------------------------
  // Overview frame: gestures only while the page phase owns the canvas.
  const frameCanvas = useCanvasTransform(frameStageRef, {
    contentRef: frameWorldRef,
    enabled: () => phase === "page" && frameGestures,
  });
  // Dock preview: gestures while docked; the fullpage host is CSS-grid owned
  // and must stay static. The layer callback reports the legacy dock scaling
  // model so anchored zoom composes through outer (FLIP) / inner (fit) scales.
  const dockCanvas = useCanvasTransform(previewRef, {
    enabled: () =>
      phase === "docked" &&
      dockGestures &&
      previewRef.current?.dataset.dockModel !== "fullpage",
    layer: () => {
      const dock = previewRef.current;
      if (!dock) return {};
      const model = dock.dataset.dockModel;
      if (model === "viewport") {
        const fit = Number(dock.dataset.dockFitScale);
        return {
          outerScale: 1,
          innerScale: Number.isFinite(fit) ? fit : 0.62,
          // The dock is the native scroll container in this model; anchor
          // math must add the live scroll offsets.
          scrollLeft: dock.scrollLeft,
          scrollTop: dock.scrollTop,
        };
      }
      if (model === "canvas")
        return {
          outerScale: 1,
          innerScale: 1,
          scrollLeft: dock.scrollLeft,
          scrollTop: dock.scrollTop,
        };
      // transform model (and entering morph): the dock box carries the scale.
      return { outerScale: currentDockScale(dock), innerScale: 1 };
    },
  });

  // Stable reset handles (the hook memoizes them); destructuring keeps the
  // reset effects' dependency arrays free of the per-render api objects.
  const { reset: resetFrameTransform } = frameCanvas;
  const { reset: resetDockTransform } = dockCanvas;

  // Transform reset policy: page switches reset the overview transform;
  // entering a detail / switching component / drilling to a node resets the
  // dock transform; returning to the overview restores the overview's own
  // transform because the frame controller state is never torn down.
  useLayoutEffect(() => {
    if (lastPageRef.current?.id === activePage?.id) return;
    setPreviousPage(instantNavigation ? undefined : lastPageRef.current);
    lastPageRef.current = activePage;
    resetFrameTransform();
    if (!instantNavigation && !supportsReducedMotion()) {
      const animation = frameRef.current?.animate(
        frameGestures
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "translateX(-48px) rotate(-1deg)" },
              { opacity: 1, transform: "translateX(0) rotate(0deg)" },
            ],
        { duration: motionDuration(320), easing: DOCK_SWITCH_EASING },
      );
      return () => animation?.cancel();
    }
  }, [
    activePage,
    frameRef,
    frameGestures,
    resetFrameTransform,
    instantNavigation,
  ]);

  useEffect(() => {
    resetDockTransform();
  }, [activeComponentId, resetDockTransform]);

  useEffect(() => {
    resetDockTransform();
  }, [displayNodeAnchor, resetDockTransform]);

  // Compose the user pan/zoom onto the imperative dock clone. The dock keeps
  // its legacy DOM (clone is the dock's direct child or inside the clamped
  // scroll wrapper), so the view is applied as inline transform on the clone
  // rather than a React-owned world layer.
  const dockViewRef = useRef({
    transform: dockCanvas.transform,
    animated: false,
  });
  useEffect(() => {
    dockViewRef.current = {
      transform: dockCanvas.transform,
      animated: dockCanvas.animated,
    };
  });
  useEffect(() => {
    const dock = previewRef.current;
    if (!dock || phase === "page") return;
    applyDockUserView(dock, dockViewRef.current);
  }, [
    dockCanvas.transform,
    dockCanvas.animated,
    phase,
    activeComponentId,
    displayNodeAnchor,
    previewRef,
  ]);

  // Bridge the active surface transform to App (CanvasTransformContext, A4).
  useEffect(() => {
    onCanvasTransform?.({
      resolvePoint:
        phase === "page" ? frameCanvas.resolvePoint : dockCanvas.resolvePoint,
    });
  }, [
    phase,
    frameCanvas.resolvePoint,
    dockCanvas.resolvePoint,
    onCanvasTransform,
  ]);

  // overlay 是 React 持有的页面状态：切页、替换 dock 或显式关闭后统一清理。
  useEffect(() => {
    const ariaState = overlayAriaStateRef.current;
    const roots = [frameRef.current, previewRef.current].filter(
      (root): root is HTMLDivElement => Boolean(root),
    );
    roots.forEach((root) => {
      root
        .querySelectorAll<HTMLElement>(`.${OVERLAY_SHOW_CLASS}`)
        .forEach((element) => {
          element.classList.remove(OVERLAY_SHOW_CLASS);
          if (!ariaState.has(element)) return;
          const original = ariaState.get(element);
          if (original === null || original === undefined) {
            element.removeAttribute("aria-hidden");
          } else {
            element.setAttribute("aria-hidden", original);
          }
          ariaState.delete(element);
        });
      if (!activeOverlayId) return;
      root
        .querySelectorAll<HTMLElement>(overlayTargetSelector(activeOverlayId))
        .forEach((element) => {
          if (!ariaState.has(element)) {
            ariaState.set(element, element.getAttribute("aria-hidden"));
          }
          element.classList.add(OVERLAY_SHOW_CLASS);
          element.setAttribute("aria-hidden", "false");
        });
    });
    const previousOverlayId = previousOverlayIdRef.current;
    if (activeOverlayId && previousOverlayId !== activeOverlayId) {
      const focusTarget = roots
        .flatMap((root) =>
          Array.from(
            root.querySelectorAll<HTMLElement>(
              overlayTargetSelector(activeOverlayId),
            ),
          ),
        )
        .find((element) => element.classList.contains(OVERLAY_SHOW_CLASS));
      const closeButton = focusTarget?.querySelector<HTMLElement>(
        "[data-review-overlay-close], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      if (closeButton) requestAnimationFrame(() => closeButton.focus());
    } else if (!activeOverlayId && previousOverlayId) {
      const origin = overlayFocusOriginRef.current;
      if (origin)
        requestAnimationFrame(() => {
          const focusable = origin as HTMLElement;
          if (typeof focusable.focus === "function") focusable.focus();
        });
      overlayFocusOriginRef.current = null;
    }
    previousOverlayIdRef.current = activeOverlayId;
    return () => {
      ariaState.forEach((original, element) => {
        element.classList.remove(OVERLAY_SHOW_CLASS);
        if (original === null) element.removeAttribute("aria-hidden");
        else if (original !== undefined)
          element.setAttribute("aria-hidden", original);
      });
      ariaState.clear();
    };
  }, [
    activeOverlayId,
    activePage?.id,
    displayNodeAnchor,
    phase,
    frameRef,
    previewRef,
  ]);
  const applyOverlayAction = useCallback(
    (
      interaction: NonNullable<ReturnType<typeof sceneInteractionForElement>>,
      origin?: Element,
    ) => {
      if (!isOverlayAction(interaction.action)) return false;
      if (
        origin &&
        (interaction.action === "show" || interaction.action === "toggle")
      ) {
        overlayFocusOriginRef.current = origin;
      }
      const action = interaction.action;
      const targetElementId = interaction.targetElementId;
      setActiveOverlayId((current: string | null) =>
        nextOverlayId(current, action, targetElementId),
      );
      return true;
    },
    [setActiveOverlayId],
  );
  /** 页面行为与详情联动独立；优先显式节点，其次 scene / 最近的 DOM 锚点。 */
  const openInteractionDetails = useCallback(
    (
      interaction: ReturnType<typeof sceneInteractionForElement>,
      element: Element,
    ) => {
      if (interaction?.action === "close" || interaction?.action === "hide") {
        return;
      }
      const sceneComponent = activePage
        ? sceneComponentForElement(activePage, element)
        : undefined;
      const nodeAnchor =
        interaction?.targetNodeId?.trim() ||
        sceneComponent?.nodeId?.trim() ||
        element.closest<HTMLElement>("[data-review-node-id]")?.dataset
          .reviewNodeId;
      if (nodeAnchor) {
        const mode = resolveNodeMode?.(nodeAnchor);
        if (mode) {
          onNodeActivate?.(nodeAnchor, mode);
          return;
        }
      }
      const componentId =
        sceneComponent?.componentId?.trim() ||
        element.closest<HTMLElement>("[data-component-id]")?.dataset
          .componentId;
      if (componentId) onSelect(componentId);
    },
    [activePage, onNodeActivate, onSelect, resolveNodeMode],
  );
  const nativeActionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(nativeActionTimer.current), [activePage]);
  useEffect(() => {
    const sync = (event: Event) => {
      const element = event.target;
      const frame = frameRef.current;
      const dock = previewRef.current;
      if (!(element instanceof Element) || !frame || !dock) return;
      if (dock.contains(element)) syncNativeControls(dock, dock);
      else if (frame.contains(element)) syncNativeControls(frame, dock);
    };
    for (const type of ["input", "change", "toggle"])
      document.addEventListener(type, sync, true);
    return () => {
      for (const type of ["input", "change", "toggle"])
        document.removeEventListener(type, sync, true);
    };
  }, [frameRef, previewRef]);
  const afterNativeAction = (element: Element, action: () => void) => {
    if (!isNativeActivation(element)) {
      action();
      return;
    }
    clearTimeout(nativeActionTimer.current);
    // A task boundary lets summary/link/form default actions and bubbling finish
    // before entering/docked-switching layout effects take a clone snapshot.
    nativeActionTimer.current = setTimeout(() => {
      const frame = frameRef.current;
      const dock = previewRef.current;
      if (!element.isConnected || !frame || !dock) return;
      syncNativeControls(dock.contains(element) ? dock : frame, dock);
      action();
    }, 0);
  };

  const handleDeclaredInteraction = (
    interaction: ReturnType<typeof sceneInteractionForElement>,
    element: Element,
    event: SyntheticEvent,
  ): boolean => {
    if (!interaction) return false;
    if (interaction.action === "navigate" && interaction.targetPageId) {
      event.preventDefault();
      event.stopPropagation();
      onPageChange(interaction.targetPageId, interaction.targetNodeId);
      return true;
    }
    if (applyOverlayAction(interaction, element)) {
      event.preventDefault();
      event.stopPropagation();
      openInteractionDetails(interaction, element);
    } else {
      afterNativeAction(element, () =>
        openInteractionDetails(interaction, element),
      );
    }
    return true;
  };
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeOverlayId) return;
      setActiveOverlayId(null);
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [activeOverlayId, setActiveOverlayId]);
  const pageMarkup = useMemo(
    () => ({
      __html: activePage?.pageHtml || renderSceneHtml(activePage?.scene),
    }),
    [activePage?.pageHtml, activePage?.scene],
  );
  useEffect(() => {
    const frame = frameRef.current;
    const scene = activePage?.scene;
    if (!frame || !scene) return;
    scene.components.forEach((component) => {
      const selector = component.source?.selector;
      const elements: HTMLElement[] = [];
      const sceneElement = frame.querySelector<HTMLElement>(
        `[data-scene-id="${CSS.escape(component.id)}"]`,
      );
      if (sceneElement) elements.push(sceneElement);
      if (selector) {
        try {
          frame.querySelectorAll<HTMLElement>(selector).forEach((element) => {
            if (!element.dataset.sceneId)
              element.dataset.sceneId = component.id;
            if (!elements.includes(element)) elements.push(element);
          });
        } catch {
          // 非法 selector 已在运行时忽略，避免破坏画板渲染；schema 仍保留原始值供诊断。
        }
      }
      if (component.mappingIds?.length) {
        const mappingTokens = component.mappingIds.map((id) =>
          component.componentId ? `${component.componentId}:${id}` : id,
        );
        elements.forEach((element) => {
          const current =
            element.dataset.reviewMappingId?.split(/\s+/).filter(Boolean) ?? [];
          element.dataset.reviewMappingId = [
            ...new Set([...current, ...mappingTokens]),
          ].join(" ");
        });
      }
    });
  }, [activePage, frameRef]);

  // canvas 页逻辑节点 hover 浮层：复用 HoverPopover，元素级委托于 frame。
  const [hoverAnchor, setHoverAnchor] = useState<string | null>(null);
  const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null);
  const hoverOverlayRef = useRef<string | null>(null);
  const hoverPopoverRef = useRef<HoverPopoverHandle | null>(null);

  const nodeModeHint = (anchor: string): string => {
    const mode = resolveNodeMode?.(anchor);
    if (mode === "canvas") return "点击进入深层画板";
    if (mode === "drilldown") return "点击下钻查看";
    return "点击在高亮预览中定位";
  };

  const onFrameNodeHover = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const hoverInteraction = activePage
      ? sceneInteractionForElement(activePage, target, "hover")
      : undefined;
    if (hoverInteraction && isOverlayAction(hoverInteraction.action)) {
      const targetId = hoverInteraction.targetElementId;
      if (targetId) {
        hoverOverlayRef.current = targetId;
        setActiveOverlayId(
          hoverInteraction.action === "hide" ? null : targetId,
        );
      }
      return;
    }
    if (phase !== "page" || activePage?.kind !== "canvas") {
      hoverPopoverRef.current?.scheduleClose();
      return;
    }
    const nodeEl = target.closest?.<HTMLElement>("[data-review-node-id]");
    if (nodeEl && frameRef.current?.contains(nodeEl)) {
      const anchor = nodeEl.dataset.reviewNodeId?.trim();
      if (anchor) {
        setHoverEl(nodeEl);
        setHoverAnchor(anchor);
        hoverPopoverRef.current?.clearCloseTimer();
        return;
      }
    }
    hoverPopoverRef.current?.scheduleClose();
  };
  const onFrameMouseLeave = () => {
    if (hoverOverlayRef.current) {
      setActiveOverlayId((current: string | null) =>
        current === hoverOverlayRef.current ? null : current,
      );
      hoverOverlayRef.current = null;
    }
    hoverPopoverRef.current?.scheduleClose();
  };
  const prevComponentIdRef = useRef<string | undefined>(undefined);
  const sourceRectRef = useRef<DOMRect | undefined>(undefined);
  const sourceLayoutRef = useRef<DOMRect | undefined>(undefined);
  const dockPoseRef = useRef<FlipPose | undefined>(undefined);
  const animationRef = useRef<Animation | undefined>(undefined);
  const pendingForwardAnchorRef = useRef<string | undefined>(undefined);
  const nestedAnimationRef = useRef<Animation | undefined>(undefined);

  useEffect(() => {
    if (!frameRef.current) return;
    prepareReviewTargets(frameRef.current);
  }, [frameRef, activePage]);

  // 补充板（非界面 component）在主画板中不占位：节点保留在 DOM 供 dock 克隆、
  // 锚点校验与评论定位使用，仅视觉隐藏，入口改由 header 提供。
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ids = new Set(supplementaryBoardIds ?? []);
    const marked: HTMLElement[] = [];
    frame.querySelectorAll<HTMLElement>("[data-component-id]").forEach((el) => {
      if (!ids.has(el.dataset.componentId ?? "")) return;
      el.classList.add("is-supplementary-board");
      marked.push(el);
    });
    return () => {
      marked.forEach((el) => el.classList.remove("is-supplementary-board"));
    };
  }, [frameRef, activePage, supplementaryBoardIds]);

  // clone 编排 + entering/docked-switching 动画
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const dock = previewRef.current;
    if (!frame || !dock) return;

    frame
      .querySelectorAll(".is-active")
      .forEach((element) => element.classList.remove("is-active"));
    const source = activeComponentId
      ? frame.querySelector<HTMLElement>(
          `[data-component-id="${CSS.escape(activeComponentId)}"]`,
        )
      : null;
    const prevId = prevComponentIdRef.current;
    prevComponentIdRef.current = activeComponentId;

    if (!source) {
      clearHost(dock);
      return;
    }

    source.classList.add("is-active");

    if (phase === "entering") {
      const sourceRect = captureRect(source);
      sourceRectRef.current = sourceRect;
      const layout = new DOMRect(
        sourceRect.left,
        sourceRect.top,
        source.offsetWidth,
        source.offsetHeight,
      );
      sourceLayoutRef.current = layout;
      mountComponentClone(dock, source);
      dock.classList.add("flip-morph");
      // 强制 reflow，确保起始位置生效
      void dock.offsetHeight;

      const from: FlipPose = {
        top: sourceRect.top,
        left: sourceRect.left,
        scale: sourceRect.width / (layout.width || 1),
      };
      const to = dockPoseFor(layout);
      dockPoseRef.current = to;

      if (instantNavigation) {
        dock.classList.remove("flip-morph");
        settleDockPose(dock, layout, to);
        onEntered();
        return;
      }

      if (dockGestures) {
        // Logical boards fade at their final bounds; UI previews retain FLIP.
        dock.classList.remove("flip-morph");
        settleDockPose(dock, layout, to);
        const animation = supportsReducedMotion()
          ? undefined
          : dock.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: motionDuration(240),
              easing: DOCK_SWITCH_EASING,
            });
        animationRef.current = animation;
        const settlement = settleAnimation(animation, onEntered);
        return () => settlement.cancel();
      }

      const animation = enterDockPose(dock, layout, from, to);
      animationRef.current = animation;

      const settlement = settleAnimation(animation, () => {
        dock.classList.remove("flip-morph");
        settleDockPose(dock, layout, to);
        onEntered();
      });

      return () => settlement.cancel();
    }

    if (
      phase === "docked" &&
      prevId !== undefined &&
      prevId !== activeComponentId
    ) {
      // dock 内连续切换组件：快速 fade，不用 scale
      sourceRectRef.current = captureRect(source);
      const layout = new DOMRect(0, 0, source.offsetWidth, source.offsetHeight);
      sourceLayoutRef.current = layout;
      const pose = dockPoseFor(layout);
      dockPoseRef.current = pose;
      mountComponentClone(dock, source);
      settleDockPose(dock, layout, pose);
      if (!instantNavigation && !supportsReducedMotion()) {
        const clone = dock.querySelector<HTMLElement>(
          "[data-component-id]:not(.component-dock-scroll-content *)",
        );
        clone?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: motionDuration(240),
          easing: DOCK_SWITCH_EASING,
        });
      }
    }
  }, [
    activeComponentId,
    phase,
    activePage,
    frameRef,
    previewRef,
    onEntered,
    dockGestures,
    instantNavigation,
  ]);

  // 恢复到 page 时清理 dock 内联样式和动画 class，避免下次使用时闪屏
  useEffect(() => {
    if (phase !== "page") return;
    const dock = previewRef.current;
    if (!dock) return;
    resetDockGeometry(dock);
    dock.classList.remove("is-fading-out", "flip-morph");
  }, [phase, previewRef]);

  // dock 已打开时，反馈栏展开/收起或窗口 resize 后按当前可用右边界重算位移。
  useEffect(() => {
    if (phase !== "docked") return;
    const dock = previewRef.current;
    if (!dock) return;
    let raf = 0;
    const recompute = () => {
      if (!dock.classList.contains("is-visible")) return;
      if (dock.classList.contains("flip-morph")) return;
      if (dock.dataset.dockModel === "fullpage") return;
      const canvasView = dock.dataset.dockModel === "canvas";
      const baseWidth = Number(dock.dataset.baseWidth) || dock.offsetWidth;
      const baseHeight = Number(dock.dataset.baseHeight) || dock.offsetHeight;
      if (baseWidth <= 0 || baseHeight <= 0) return;
      const baseRect = new DOMRect(0, 0, baseWidth, baseHeight);
      const pose = dockPoseFor(baseRect, false, canvasView);
      dockPoseRef.current = pose;
      settleDockPose(
        dock,
        baseRect,
        pose,
        false,
        canvasView,
        dockViewRef.current,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    schedule();
    const bodyObserver = new MutationObserver(schedule);
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("resize", schedule);
    const app = document.querySelector(".app");
    const appObserver = app ? new ResizeObserver(schedule) : undefined;
    if (app && appObserver) appObserver.observe(app);
    return () => {
      cancelAnimationFrame(raf);
      bodyObserver.disconnect();
      window.removeEventListener("resize", schedule);
      appObserver?.disconnect();
    };
  }, [phase, previewRef]);

  // leaving：dock 从当前 pose 动画回 page 阶段的最终源位置。
  useLayoutEffect(() => {
    if (phase !== "leaving") return;
    const frame = frameRef.current;
    const dock = previewRef.current;
    if (!frame || !dock) {
      onRestored();
      return;
    }

    cancelAnimation(nestedAnimationRef.current);
    nestedAnimationRef.current = undefined;

    const rootSource = frame.querySelector<HTMLElement>(
      `[data-component-id="${CSS.escape(activeComponentId ?? "")}"]`,
    );
    const finalSourceRect = rootSource
      ? captureRect(rootSource)
      : sourceRectRef.current;
    if (!finalSourceRect) {
      onRestored();
      return;
    }
    sourceRectRef.current = finalSourceRect;
    const layout = rootSource
      ? new DOMRect(0, 0, rootSource.offsetWidth, rootSource.offsetHeight)
      : (sourceLayoutRef.current ?? finalSourceRect);
    sourceLayoutRef.current = layout;

    if (rootSource) {
      mountComponentClone(dock, rootSource);
      const rootPose = dockPoseFor(layout);
      dockPoseRef.current = rootPose;
      // Leaving keeps the legacy FLIP behaviour: only the dock box pose is
      // reapplied (no surface-model switch); the page-phase cleanup resets
      // the geometry once the restore animation settles.
      applyFlipPose(dock, rootPose);
    }

    const from = dockPoseRef.current ?? {
      top: captureRect(dock).top,
      left: captureRect(dock).left,
      scale: 1,
    };
    setDockBaseSize(dock, layout);
    dock.classList.add("flip-morph");
    void dock.offsetHeight;

    const animation = flipPosition(
      dock,
      from,
      {
        top: finalSourceRect.top,
        left: finalSourceRect.left,
        scale: finalSourceRect.width / (layout.width || 1),
      },
      460,
    );
    animationRef.current = animation;

    const settlement = settleAnimation(animation, () => {
      dock.classList.remove("flip-morph");
      frame.querySelector(".is-active")?.classList.remove("is-active");
      onRestored();
    });

    return () => settlement.cancel();
  }, [phase, activeComponentId, frameRef, previewRef, onRestored]);

  // drilldown 外部状态同步：clone 始终对应当前展示中的复杂节点（或组件根）。
  useLayoutEffect(() => {
    if (phase !== "docked") {
      cancelAnimation(nestedAnimationRef.current);
      nestedAnimationRef.current = undefined;
      return;
    }

    if (
      displayNodeAnchor &&
      pendingForwardAnchorRef.current === displayNodeAnchor
    ) {
      pendingForwardAnchorRef.current = undefined;
      return;
    }

    const frame = frameRef.current;
    const dock = previewRef.current;
    if (!frame || !dock) return;

    const rootSource = frame.querySelector<HTMLElement>(
      `[data-component-id="${CSS.escape(activeComponentId ?? "")}"]`,
    );
    if (!displayNodeAnchor) {
      cancelAnimation(nestedAnimationRef.current);
      nestedAnimationRef.current = undefined;
      dock.classList.remove("flip-morph");
      pendingForwardAnchorRef.current = undefined;
      if (!rootSource) return;

      const currentClone = dock.querySelector<HTMLElement>(
        "[data-component-id]",
      );
      if (currentClone?.dataset.componentId === activeComponentId) return;

      const rootRect = new DOMRect(
        0,
        0,
        rootSource.offsetWidth,
        rootSource.offsetHeight,
      );
      const rootPose = dockPoseFor(rootRect);
      dockPoseRef.current = rootPose;
      mountComponentClone(dock, rootSource);
      settleDockPose(
        dock,
        rootRect,
        rootPose,
        false,
        false,
        dockViewRef.current,
      );
      if (!instantNavigation && !supportsReducedMotion()) {
        const clone = dock.querySelector<HTMLElement>("[data-component-id]");
        clone?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: motionDuration(240),
          easing: DOCK_SWITCH_EASING,
        });
      }
      return;
    }

    const source = frame.querySelector<HTMLElement>(
      `[data-review-node-id="${CSS.escape(displayNodeAnchor)}"]`,
    );
    if (!source) return;
    const sourceComponentId = (
      source.closest("[data-component-id]") as HTMLElement | null
    )?.dataset.componentId;
    if (sourceComponentId !== activeComponentId) {
      cancelAnimation(nestedAnimationRef.current);
      nestedAnimationRef.current = undefined;
      dock.classList.remove("flip-morph");
      pendingForwardAnchorRef.current = undefined;
      return;
    }

    const currentClone = dock.querySelector<HTMLElement>("[data-component-id]");
    if (currentClone?.dataset.reviewNodeId === displayNodeAnchor) return;

    cancelAnimation(nestedAnimationRef.current);
    nestedAnimationRef.current = undefined;
    dock.classList.remove("flip-morph");
    pendingForwardAnchorRef.current = undefined;
    const rect = captureRect(source);
    const naturalBase = new DOMRect(
      rect.left,
      rect.top,
      source.offsetWidth,
      source.offsetHeight,
    );
    const clone = mountComponentClone(dock, source);
    const naturalRect = drilldownRectFor(clone, naturalBase);
    const fullpage = isFullpageHostNode(
      displayNodeAnchor,
      source,
      isExplicitDrilldown,
    );
    const canvasView = !fullpage && isCanvasNode?.(displayNodeAnchor) === true;
    const pose = dockPoseFor(naturalRect, fullpage, canvasView);
    dockPoseRef.current = pose;
    settleDockPose(
      dock,
      naturalRect,
      pose,
      fullpage,
      canvasView,
      dockViewRef.current,
    );
    if (!instantNavigation && !supportsReducedMotion()) {
      const fadeTarget = dock.querySelector<HTMLElement>("[data-component-id]");
      fadeTarget?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: motionDuration(240),
        easing: DOCK_SWITCH_EASING,
      });
    }
  }, [
    displayNodeAnchor,
    activeComponentId,
    phase,
    activePage,
    frameRef,
    previewRef,
    isExplicitDrilldown,
    isCanvasNode,
    instantNavigation,
  ]);

  // dock 内节点高亮与外部 activeNodeAnchor 状态同步；切 root/phase 时清理旧高亮
  useEffect(() => {
    const dock = previewRef.current;
    if (!dock) return;
    const clearHighlight = () => {
      dock
        .querySelectorAll(".is-node-highlight")
        .forEach((element) => element.classList.remove("is-node-highlight"));
    };
    if (
      phase !== "docked" ||
      activeNodeMode !== "highlight" ||
      !activeNodeAnchor
    ) {
      clearHighlight();
      return;
    }
    const target = dock.querySelector<HTMLElement>(
      `[data-review-node-id="${CSS.escape(activeNodeAnchor)}"]`,
    );
    clearHighlight();
    target?.classList.add("is-node-highlight");
    if (target) return scrollAndPulse(target);
  }, [
    activeNodeAnchor,
    activeNodeMode,
    displayNodeAnchor,
    activeComponentId,
    phase,
    previewRef,
  ]);

  // 卸载时清理未完成的动画（下钻 + 进入/恢复 FLIP）
  useEffect(() => {
    return () => {
      cancelAnimation(nestedAnimationRef.current);
      cancelAnimation(animationRef.current);
    };
  }, []);

  /** Plain component roots retain click-to-detail; native controls keep defaults. */
  const navigateFrameAnchor = (element: Element) => {
    const sceneComponent = activePage
      ? sceneComponentForElement(activePage, element)
      : undefined;
    const nodeAnchor =
      sceneComponent?.nodeId?.trim() ||
      element
        .closest<HTMLElement>("[data-review-node-id]")
        ?.dataset.reviewNodeId?.trim();
    const mode = nodeAnchor ? resolveNodeMode?.(nodeAnchor) : undefined;
    if (nodeAnchor && mode) {
      onNodeActivate?.(nodeAnchor, mode);
      return;
    }
    const componentId =
      sceneComponent?.componentId ??
      element.closest<HTMLElement>("[data-component-id]")?.dataset.componentId;
    if (componentId) onSelect(componentId);
  };

  const onFrameKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const element = event.target instanceof Element ? event.target : undefined;
    if (
      !element ||
      isNativeActivation(element) ||
      (phase !== "page" && phase !== "docked")
    )
      return;
    const interaction = activePage
      ? sceneInteractionForElement(activePage, element, "keyboard")
      : undefined;
    handleDeclaredInteraction(interaction, element, event);
  };

  const onFrameClick = (e: React.MouseEvent<HTMLElement>) => {
    // Pan gestures are suppressed at the stage's capture-phase click listener
    // (useCanvasTransform); reaching here means a genuine click/tap.
    const textSelection = window.getSelection();
    const frame = frameRef.current;
    if (
      textSelection &&
      !textSelection.isCollapsed &&
      textSelection.toString().trim() &&
      frame &&
      textSelection.anchorNode &&
      textSelection.focusNode &&
      frame.contains(textSelection.anchorNode) &&
      frame.contains(textSelection.focusNode)
    ) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    const element = e.target instanceof Element ? e.target : undefined;
    if (
      !element ||
      !frameRef.current?.contains(element) ||
      (phase !== "page" && phase !== "docked")
    )
      return;
    const declaredInteraction = activePage
      ? ((e.detail === 0
          ? sceneInteractionForElement(activePage, element, "keyboard")
          : undefined) ??
        sceneInteractionForElement(activePage, element, "click"))
      : undefined;
    if (handleDeclaredInteraction(declaredInteraction, element, e)) return;
    const pageTarget =
      element.closest<HTMLElement>("[data-review-page]")?.dataset.reviewPage;
    if (pageTarget && pages.some((page) => page.id === pageTarget)) {
      e.preventDefault();
      e.stopPropagation();
      onPageChange(pageTarget);
      return;
    }
    const overlayClose = element.closest<HTMLElement>(
      "[data-review-overlay-close]",
    );
    const overlayBackdrop = element.matches("[data-review-overlay-backdrop]");
    if (overlayClose || overlayBackdrop) {
      e.preventDefault();
      e.stopPropagation();
      setActiveOverlayId(null);
      return;
    }
    const overlayTarget = element.closest<HTMLElement>("[data-review-overlay]")
      ?.dataset.reviewOverlay;
    if (overlayTarget) {
      e.preventDefault();
      e.stopPropagation();
      overlayFocusOriginRef.current = element;
      setActiveOverlayId((current: string | null) =>
        current === overlayTarget ? null : overlayTarget,
      );
      navigateFrameAnchor(element);
      return;
    }
    const summaryOwner = element.closest("summary")?.parentElement;
    if (
      summaryOwner instanceof HTMLDetailsElement &&
      resolveNodeMode?.(summaryOwner.dataset.reviewNodeId ?? "") === "drilldown"
    ) {
      e.preventDefault();
      navigateFrameAnchor(element);
      return;
    }
    afterNativeAction(element, () => navigateFrameAnchor(element));
  };

  const onDockMouseOver = (event: React.MouseEvent<HTMLElement>) => {
    if (phase !== "docked") return;
    const element = event.target instanceof Element ? event.target : undefined;
    const interaction =
      element && activePage
        ? sceneInteractionForElement(activePage, element, "hover")
        : undefined;
    if (!interaction || !isOverlayAction(interaction.action)) return;
    const targetId = interaction.targetElementId;
    if (!targetId) return;
    hoverOverlayRef.current = targetId;
    setActiveOverlayId(interaction.action === "hide" ? null : targetId);
  };
  const onDockMouseLeave = () => {
    if (!hoverOverlayRef.current) return;
    setActiveOverlayId((current: string | null) =>
      current === hoverOverlayRef.current ? null : current,
    );
    hoverOverlayRef.current = null;
  };
  const onDockKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const element = event.target instanceof Element ? event.target : undefined;
    if (!element || isNativeActivation(element) || phase !== "docked") return;
    const interaction = activePage
      ? sceneInteractionForElement(activePage, element, "keyboard")
      : undefined;
    handleDeclaredInteraction(interaction, element, event);
  };

  const onDockClick = (event: React.MouseEvent<HTMLElement>) => {
    if (phase !== "docked") return;
    const nativeSelection = window.getSelection();
    if (
      nativeSelection &&
      !nativeSelection.isCollapsed &&
      nativeSelection.toString().trim()
    ) {
      event.stopPropagation();
      return;
    }
    const dockElement = event.target instanceof Element ? event.target : null;
    if (dockElement) {
      const declaredDockInteraction = activePage
        ? ((event.detail === 0
            ? sceneInteractionForElement(activePage, dockElement, "keyboard")
            : undefined) ??
          sceneInteractionForElement(activePage, dockElement, "click"))
        : undefined;
      if (
        handleDeclaredInteraction(declaredDockInteraction, dockElement, event)
      )
        return;
      if (
        dockElement.closest("[data-review-overlay-close]") ||
        dockElement.matches("[data-review-overlay-backdrop]")
      ) {
        event.preventDefault();
        event.stopPropagation();
        setActiveOverlayId(null);
        return;
      }
      const legacyDockOverlay = dockElement.closest<HTMLElement>(
        "[data-review-overlay]",
      )?.dataset.reviewOverlay;
      if (legacyDockOverlay) {
        event.preventDefault();
        event.stopPropagation();
        overlayFocusOriginRef.current = dockElement;
        setActiveOverlayId((current: string | null) =>
          current === legacyDockOverlay ? null : legacyDockOverlay,
        );
        openInteractionDetails(undefined, dockElement);
        return;
      }
    }
    const summaryOwner =
      event.target instanceof Element
        ? event.target.closest("summary")?.parentElement
        : null;
    if (
      summaryOwner instanceof HTMLDetailsElement &&
      resolveNodeMode?.(summaryOwner.dataset.reviewNodeId ?? "") === "drilldown"
    ) {
      event.preventDefault();
    }
    if (
      dockElement &&
      isNativeActivation(dockElement) &&
      !event.defaultPrevented
    ) {
      afterNativeAction(dockElement, () =>
        openInteractionDetails(undefined, dockElement),
      );
      return;
    }
    const dock = previewRef.current;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-review-node-id]")
        : null;
    if (!target || !dock || !dock.contains(target)) return;
    const anchor = target.dataset.reviewNodeId?.trim();
    if (!anchor) return;
    const mode = resolveNodeMode?.(anchor);
    if (!mode) return;
    if (mode === "drilldown" && anchor === activeNodeAnchor) return;
    if (mode === "highlight") {
      dock
        .querySelectorAll(".is-node-highlight")
        .forEach((element) => element.classList.remove("is-node-highlight"));
      target.classList.add("is-node-highlight");
      if (!supportsReducedMotion()) {
        target.animate(
          [
            { opacity: 0.5, transform: "scale(0.96)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: motionDuration(180), easing: DOCK_SWITCH_EASING },
        );
      }
    }
    if (mode === "drilldown" || mode === "canvas") {
      const canvasView = mode === "canvas";
      const targetRect = captureRect(target);
      const naturalBase = new DOMRect(
        targetRect.left,
        targetRect.top,
        target.offsetWidth,
        target.offsetHeight,
      );
      const fromScale = targetRect.width / (target.offsetWidth || 1);
      const fullpage = isFullpageHostNode(anchor, target, isExplicitDrilldown);
      pendingForwardAnchorRef.current = anchor;
      cancelAnimation(nestedAnimationRef.current);
      nestedAnimationRef.current = undefined;
      const clone = mountComponentClone(dock, target);
      const naturalRect = drilldownRectFor(clone, naturalBase);

      if (canvasView) {
        const pose = dockPoseFor(naturalRect, false, true);
        dockPoseRef.current = pose;
        dock.classList.remove("flip-morph");
        settleDockPose(
          dock,
          naturalRect,
          pose,
          false,
          true,
          dockViewRef.current,
        );
        onNodeActivate?.(anchor, mode);
        return;
      }

      if (fullpage) {
        dock.classList.remove("flip-morph");
        const pose = dockPoseFor(naturalRect, true);
        dockPoseRef.current = pose;
        settleDockPose(
          dock,
          naturalRect,
          pose,
          true,
          false,
          dockViewRef.current,
        );
        if (!supportsReducedMotion()) {
          const fadeTarget = dock.querySelector<HTMLElement>(
            "[data-component-id]",
          );
          fadeTarget?.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: motionDuration(240),
            easing: DOCK_SWITCH_EASING,
          });
        }
        onNodeActivate?.(anchor, mode);
        return;
      }

      const to = dockPoseFor(naturalRect, false, canvasView);
      dockPoseRef.current = to;
      dock.classList.add("flip-morph");
      const animation = enterDockPose(
        dock,
        naturalRect,
        { top: targetRect.top, left: targetRect.left, scale: fromScale },
        to,
        dockViewRef.current,
      );
      nestedAnimationRef.current = animation;
      settleAnimation(animation, () => {
        nestedAnimationRef.current = undefined;
        dock.classList.remove("flip-morph");
        if (pendingForwardAnchorRef.current === anchor) {
          pendingForwardAnchorRef.current = undefined;
        }
        settleDockPose(
          dock,
          naturalRect,
          to,
          false,
          canvasView,
          dockViewRef.current,
        );
      });
    }
    onNodeActivate?.(anchor, mode);
  };

  return (
    <div className="canvas-shell">
      <PageStack
        pages={pages}
        activePageId={activePageId}
        visitedPages={visitedPages}
        canPrev={canPrev}
        canNext={canNext}
        previousPage={
          frameGestures && !instantNavigation ? previousPage : undefined
        }
        onPageChange={onPageChange}
        onPrev={onPrev}
        onNext={onNext}
      />
      <CanvasViewport
        frameRef={frameRef}
        stageRef={frameStageRef}
        contentRef={frameWorldRef}
        api={frameCanvas}
        gestures={frameGestures}
        className={`page-frame${frameGestures ? "" : " is-ui-preview"}${
          phase !== "page" ? " is-inspector-open" : ""
        }`}
        html={pageMarkup}
        onMouseOver={onFrameNodeHover}
        onMouseLeave={onFrameMouseLeave}
        onKeyDown={onFrameKeyDown}
        onClick={onFrameClick}
      >
        {activePage?.graph && (
          <GraphOverlay
            graph={activePage.graph}
            onNodeActivate={onNodeActivate}
          />
        )}
      </CanvasViewport>
      <DockPanel
        previewRef={previewRef}
        api={dockCanvas}
        gestures={dockGestures}
        visible={Boolean(activeComponentId) && phase !== "page"}
        morph={phase === "entering" || phase === "leaving"}
        onMouseOver={onDockMouseOver}
        onMouseLeave={onDockMouseLeave}
        onKeyDown={onDockKeyDown}
        onClick={onDockClick}
      />
      {phase === "page" && activePage?.kind === "canvas" && hoverAnchor && (
        <NodeHoverPopover
          ref={hoverPopoverRef}
          anchor={() => hoverEl}
          label={resolveNodeLabel?.(hoverAnchor) ?? hoverAnchor}
          hint={nodeModeHint(hoverAnchor)}
          onClose={() => setHoverAnchor(null)}
        />
      )}
    </div>
  );
}
