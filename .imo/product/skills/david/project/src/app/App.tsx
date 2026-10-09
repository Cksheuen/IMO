import { ReviewMaterialsPanel } from "../components/materials/ReviewMaterialsPanel";
import { preferredSelection, focusWithinSelection } from "../lib/feedbackFocus";
import { PreparationContext } from "../components/preparation/preparationContext";
import { REQUEST_CAPTURE_EVENT } from "../components/feedback/GlobalRegionSelection";
import { feedbackSelections, selectionScope } from "../lib/davidFeedback";
import { usePreviewLayout } from "../hooks/usePreviewLayout";
import { findMappingTargets } from "../lib/mappingHighlight";
import { useSyncExternalStore } from "react";
import {
  subscribeFieldSelection,
  getSelectedFieldName,
  clearSelectedField as setActiveField,
  toggleContractField,
  refreshFieldHighlight,
  installPageFieldBridge,
  CONTRACT_FIELD_LOCATE_EVENT,
} from "../components/api-contracts/fieldHighlightChannel";
import { ApiContractsContext } from "../components/api-contracts/useApiContracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "../components/app-header";
import { CommentRail } from "../components/CommentRail";
import {
  ComponentDetails,
  OverviewDetails,
  RichDetailDialog,
} from "../components/details";
import { DavidFeedbackPanel } from "../components/DavidFeedbackPanel";
import { GlobalRegionSelection } from "../components/GlobalRegionSelection";
import {
  OpenQuestionsPanel,
  useResolvedQuestions,
} from "../components/open-questions";
import { ReviewCanvas } from "../components/review-canvas";
import { ToastHost } from "../components/ToastHost";
import "../styles/prd-responsive.css";
import type { DisclosureColumn } from "../components/details";
import {
  hasDisclosureDetail,
  shouldInlineDisclosure,
} from "../lib/disclosureContent";
import { useDavidFeedback } from "../hooks/useDavidFeedback";
import { usePageViewState } from "../hooks/usePageViewState";
import { feedbackServeHint } from "../lib/feedbackTransport";
import {
  appendFeedbackReply,
  createFeedbackDocument,
  resolveFeedbackTarget,
  type DavidFeedbackDocument,
  type DavidFeedbackEntry,
} from "../lib/davidFeedback";
import { buildAgentClipboardPayload } from "../lib/davidBridge";
import { showToast } from "../lib/toast";
import { prepareReviewTargets } from "../lib/domTargets";
import { closeOpenRichDetails } from "../lib/richDetailEvents";
import {
  hasUsableAncestry,
  type AppearanceSelection,
} from "../lib/globalSelection";
import { scrollAndPulse } from "../lib/pulseHighlight";
import {
  findNodePath,
  flattenReviewTree,
  resolveLayerMapping,
  resolveNodeMapping,
  isInlineReviewNode,
  reviewForPage,
} from "../lib/reviewTree";
import { resolveDetailKind } from "../lib/pageInteraction";
import {
  type CanvasTransformContextValue,
  CanvasTransformContext,
} from "../hooks/useCanvasTransform";
import { buildDesignContext } from "../lib/designContext";
import type {
  ApiField,
  MappingRow,
  ReviewNode,
  ReviewPayload,
} from "../types/review";

type Phase = "page" | "entering" | "docked" | "leaving";

type FeedbackLocateRequest = {
  entryId: string;
  pageId?: string;
  componentId?: string;
  nodeId?: string;
  targetId?: string;
  selection?: AppearanceSelection;
};

type RichDetailRequest = {
  focusSelection?: AppearanceSelection;
  row: MappingRow;
  column: DisclosureColumn;
  componentId?: string;
  nodeId?: string;
};

const RICH_DETAIL_COLUMNS: readonly DisclosureColumn[] = [
  "requirement",
  "change",
  "api",
];

const findMappingRow = (
  components: ReviewPayload["data"]["components"],
  componentId: string,
  rowId: string,
): MappingRow | undefined => {
  const component = components.find((item) => item.id === componentId);
  if (!component) return undefined;
  const direct = component.mapping.find((row) => row.id === rowId);
  if (direct) return direct;
  for (const node of flattenReviewTree(component.children ?? [])) {
    const found = node.mapping?.find((row) => row.id === rowId);
    if (found) return found;
  }
  return undefined;
};

export function App({ data, pages }: ReviewPayload) {
  const [payload, setPayload] = useState<ReviewPayload>({ data, pages });
  const pageNav = usePageViewState(payload.pages);
  // 解构引用，避免整对象入依赖数组触发 exhaustive-deps 告警；各转移函数在同
  // payload 内稳定，view 随 commit 更新。
  const {
    view: pageView,
    visitedPages,
    canPrev,
    canNext,
    next: pageNext,
    prev: pagePrev,
    goTo: pageGoTo,
    enterCanvas,
    leaveCanvas,
    resetDetail,
    reset: pageNavReset,
  } = pageNav;
  const [phase, setPhase] = useState<Phase>("page");
  const [instantNavigation, setInstantNavigation] = useState(false);
  const [activeComponentId, setActiveComponentId] = useState<string>();
  const activeField = useSyncExternalStore(
    subscribeFieldSelection,
    getSelectedFieldName,
    () => undefined,
  );
  useEffect(installPageFieldBridge, []);
  const [activeNodeId, setActiveNodeId] = useState<string>();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [captureRequest, setCaptureRequest] = useState<{
    entryId?: string;
  } | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    entryId: string;
    selection: AppearanceSelection;
    error: string;
  } | null>(null);

  const [appearanceSelection, setAppearanceSelection] =
    useState<AppearanceSelection>();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const closeMaterials = useCallback(() => setMaterialsOpen(false), []);
  const [feedbackLocate, setFeedbackLocate] = useState<
    FeedbackLocateRequest | undefined
  >();
  const [locateMissedEntryId, setLocateMissedEntryId] = useState<
    string | undefined
  >();
  const [richDetail, setRichDetail] = useState<RichDetailRequest | undefined>();
  const [openQuestionsPanelOpen, setOpenQuestionsPanelOpen] = useState(false);

  // Active canvas pan/zoom transform bridged up from ReviewCanvas so the
  // region-selection capture (A4) can back-compute logical canvas points.
  const [canvasTransform, setCanvasTransform] =
    useState<CanvasTransformContextValue | null>(null);
  const handleCanvasTransform = useCallback(
    (transform: CanvasTransformContextValue | null) =>
      setCanvasTransform(transform),
    [],
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  usePreviewLayout(previewRef);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const inspectorScrollPositions = useRef(new Map<string, number>());
  const [expandedRowsByScope, setExpandedRowsByScope] = useState<
    Record<string, Record<string, boolean>>
  >({});
  // 反馈驱动的跳转（feedbackLocate）会自行滚动到目标，
  // 用这个标记跳过下一次 inspector 滚动重置，避免覆盖目标位置。
  const skipInspectorScrollResetRef = useRef(false);
  const pulseCleanupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(
    () => () => {
      pulseCleanupRef.current?.();
    },
    [],
  );

  const review = payload.data;
  const david = useDavidFeedback(review.slug, review.service?.baseUrl);
  // 待澄清问题的 per-viewer 已澄清集合（localStorage only，HARD-GATE 12/25）。
  const { resolvedIds: resolvedQuestionIds, setQuestionResolved } =
    useResolvedQuestions(review.slug);
  const openQuestions = review.openQuestions;
  const feedbackDoc = useMemo(
    () => david.feedback ?? createFeedbackDocument(review.slug),
    [david.feedback, review.slug],
  );
  const feedbackDocRef = useRef(feedbackDoc);
  useLayoutEffect(() => {
    feedbackDocRef.current = feedbackDoc;
  }, [feedbackDoc]);
  const pluginDefaultInteraction =
    david.activePlugin?.behavior?.defaultInteraction;
  const resolveNodeModeWithPlugin = useCallback(
    (node: Pick<ReviewNode, "interaction" | "canvas" | "children">) => {
      if (
        (node.interaction === undefined || node.interaction === "auto") &&
        (pluginDefaultInteraction === "highlight" ||
          pluginDefaultInteraction === "drilldown")
      ) {
        return pluginDefaultInteraction;
      }
      // 显式 drilldown/highlight 权威优先；auto 缺省仍 highlight（向后兼容）；
      // 声明 canvas 的节点进入深层画板。magnifyOnComplex 运行时未默认开启（需显式 opt-in）。
      return resolveDetailKind(node, { magnifyOnComplex: false });
    },
    [pluginDefaultInteraction],
  );
  const component = useMemo(
    () => review.components.find((item) => item.id === activeComponentId),
    [activeComponentId, review.components],
  );
  const componentIndex = useMemo(
    () => review.components.findIndex((item) => item.id === activeComponentId),
    [activeComponentId, review.components],
  );
  const nodes = useMemo(
    () => flattenReviewTree(component?.children ?? []),
    [component],
  );
  const nodeByAnchor = useMemo(
    () => new Map(nodes.map((node) => [node.target ?? node.id, node])),
    [nodes],
  );
  // 全部 components 的节点索引：canvas 页在 page 相位（未打开 component）时
  // hover 浮层的 label/mode 解析仍可用，不只依赖当前打开组件。
  const allNodeByAnchor = useMemo(() => {
    const map = new Map<string, ReviewNode>();
    for (const item of review.components) {
      for (const node of flattenReviewTree(item.children ?? [])) {
        const anchor = node.target ?? node.id;
        if (!map.has(anchor)) map.set(anchor, node);
        if (!map.has(node.id)) map.set(node.id, node);
      }
    }
    return map;
  }, [review.components]);
  /** 整页宿主判据的一半：必须是作者显式声明的 drilldown（interaction 原始值），
   *  不能用 resolveNodeModeWithPlugin 的推导值——否则 plugin 设了
   *  defaultInteraction: "drilldown" 会让所有 auto 节点都误判为整页宿主。 */
  const isExplicitDrilldown = useCallback(
    (anchor: string): boolean => {
      const node = nodeByAnchor.get(anchor);
      return node?.interaction === "drilldown";
    },
    [nodeByAnchor],
  );
  /** canvas 深层画板判据：节点声明 canvas:true（纯节点数据，稳定回调）。 */
  const isCanvasNode = useCallback(
    (anchor: string): boolean => nodeByAnchor.get(anchor)?.canvas === true,
    [nodeByAnchor],
  );
  const activeNode = useMemo(
    () => nodes.find((node) => node.id === activeNodeId),
    [nodes, activeNodeId],
  );
  const nodePath = useMemo(
    () =>
      activeNodeId
        ? findNodePath(component?.children ?? [], activeNodeId)
        : null,
    [component, activeNodeId],
  );
  const activeParent = useMemo(
    () =>
      nodePath && nodePath.length >= 2
        ? nodePath[nodePath.length - 2]
        : undefined,
    [nodePath],
  );
  const siblingNodes = useMemo(
    () =>
      activeNode
        ? (activeParent?.children ?? component?.children ?? [])
        : review.components,
    [activeNode, activeParent, component, review.components],
  );
  const siblingIndex = useMemo(
    () =>
      activeNode
        ? siblingNodes.findIndex((node) => node.id === activeNode.id)
        : componentIndex,
    [activeNode, siblingNodes, componentIndex],
  );
  const displayNode = useMemo(() => {
    if (!activeNode || !nodePath) return undefined;
    return [...nodePath].reverse().find((node) => {
      const mode = resolveNodeModeWithPlugin(node);
      return mode === "drilldown" || mode === "canvas";
    });
  }, [activeNode, nodePath, resolveNodeModeWithPlugin]);
  const displayNodeAnchor = displayNode?.target ?? displayNode?.id;
  const activeMapping = useMemo(
    () =>
      component
        ? resolveLayerMapping(component, activeNode ?? undefined)
        : undefined,
    [activeNode, component],
  );
  const activePageId = pageNav.pageId;
  const pageOverviewReview = useMemo(
    () =>
      reviewForPage(
        review,
        payload.pages.find((page) => page.id === activePageId),
      ),
    [review, payload.pages, activePageId],
  );
  const readingScope = `${review.slug ?? "review"}/${activePageId}/${activeComponentId ?? ""}/${activeNodeId ?? ""}`;
  const expandedRows = expandedRowsByScope[readingScope];
  const isRowExpanded = useCallback(
    (rowId: string) =>
      expandedRows?.[rowId] ?? activeMapping?.[0]?.id === rowId,
    [expandedRows, activeMapping],
  );
  const setRowExpanded = useCallback(
    (rowId: string, expanded: boolean) => {
      setExpandedRowsByScope((current) => ({
        ...current,
        [readingScope]: { ...current[readingScope], [rowId]: expanded },
      }));
    },
    [readingScope],
  );

  // Runtime directory follows the current imported review data.
  // Embedded as a JSON script tag; the "<" escape mirrors the feedback script.
  const designContextJson = useMemo(
    () =>
      JSON.stringify(buildDesignContext(review, payload.pages)).replace(
        /</g,
        "\\u003c",
      ),
    [review, payload.pages],
  );

  const handleEntered = useCallback(() => setPhase("docked"), []);

  const handleRestored = useCallback(() => {
    resetDetail();
    setActiveComponentId(undefined);
    setActiveNodeId(undefined);
    setActiveField();
    setPhase("page");
  }, [resetDetail]);

  const startRestore = useCallback(() => {
    setPhase((current) =>
      current === "entering" || current === "docked" ? "leaving" : current,
    );
  }, []);

  const handlePageChange = useCallback(
    (pageId: string, nodeAnchor?: string) => {
      if (!payload.pages.some((page) => page.id === pageId)) return;
      setInstantNavigation(false);
      const node = nodeAnchor ? allNodeByAnchor.get(nodeAnchor) : undefined;
      const host = node
        ? review.components.find((item) =>
            flattenReviewTree(item.children ?? []).some(
              (n) => n.id === node.id,
            ),
          )
        : undefined;
      pageGoTo(
        pageId,
        node && resolveNodeModeWithPlugin(node) === "canvas"
          ? node.id
          : undefined,
      );
      setActiveComponentId(host?.id);
      setActiveNodeId(node?.id);
      setActiveField();
      // 同一提交切页并指定详情；dock 在新页面 DOM 挂载后测量，避免克隆旧页面。
      setPhase(host ? "entering" : "page");
    },
    [
      pageGoTo,
      payload.pages,
      allNodeByAnchor,
      review.components,
      resolveNodeModeWithPlugin,
    ],
  );

  const openComponent = useCallback(
    (id: string, instant = false) => {
      if (phase !== "page" && phase !== "docked") return;
      const source = frameRef.current?.querySelector<HTMLElement>(
        `[data-component-id="${CSS.escape(id)}"]`,
      );
      if (!source) return;
      setInstantNavigation(instant);
      setActiveComponentId(id);
      setActiveNodeId(undefined);
      setActiveField();
      if (phase === "page") setPhase("entering");
    },
    [phase],
  );

  /**
   * 补充板 = 非界面类 component（kind 非 "ui"）。这类内容（脚手架、数据层、
   * 风险清单）不是页面视觉主体，堆在主画板下方会淹没主预览；改由 header
   * 入口直接进入其层级。全部 component 都是 ui 或都未标 kind 时不显示入口。
   */
  const supplementaryBoards = useMemo(() => {
    const boards = review.components
      .filter((item) => item.kind !== undefined && item.kind !== "ui")
      .map((item) => ({ id: item.id, label: item.kindLabel || item.label }));
    return boards.length === review.components.length ? [] : boards;
  }, [review.components]);
  const currentPageBoards = useMemo(() => {
    const page = payload.pages.find((item) => item.id === activePageId);
    const ids = new Set(
      Array.from(
        (page?.pageHtml ?? "").matchAll(
          /data-component-id\s*=\s*["']([^"']+)["']/g,
        ),
        (match) => match[1],
      ),
    );
    page?.scene?.components.forEach((item) => {
      if (item.componentId) ids.add(item.componentId);
    });
    return supplementaryBoards.filter((board) => ids.has(board.id));
  }, [payload.pages, activePageId, supplementaryBoards]);
  const supplementaryBoardIds = useMemo(
    () => supplementaryBoards.map((board) => board.id),
    [supplementaryBoards],
  );

  const resolvedQuestionIdSet = useMemo(
    () => new Set(resolvedQuestionIds),
    [resolvedQuestionIds],
  );
  const openQuestionOpenCount = useMemo(
    () =>
      (openQuestions ?? []).filter(
        (question) =>
          question.status !== "resolved" &&
          !resolvedQuestionIdSet.has(question.id),
      ).length,
    [openQuestions, resolvedQuestionIdSet],
  );

  const handleSelect = useCallback(
    (componentId?: string) => {
      if (componentId) openComponent(componentId);
    },
    [openComponent],
  );

  /**
   * 补充板（scaffold / data-layer / risks 一类非主预览 component）：
   * 从 header 按钮直接进入其详情层级，而不是堆在主画板下方展开/隐藏。
   * 与 openComponent 的差别只在入口与"已在详情中可直接切换"，
   * 进入后的层级行为完全一致。
   */
  const openBoard = useCallback(
    (componentId: string) => {
      if (activeComponentId === componentId) return;
      setInstantNavigation(false);
      if (phase === "docked") {
        const source = frameRef.current?.querySelector<HTMLElement>(
          `[data-component-id="${CSS.escape(componentId)}"]`,
        );
        if (!source) return;
        setActiveComponentId(componentId);
        setActiveNodeId(undefined);
        setActiveField();
        return;
      }
      openComponent(componentId);
    },
    [phase, activeComponentId, openComponent],
  );

  const switchComponent = useCallback(
    (index: number) => {
      if (phase !== "docked") return;
      setInstantNavigation(false);
      const target = review.components[index];
      if (!target || target.id === activeComponentId) return;
      const source = frameRef.current?.querySelector<HTMLElement>(
        `[data-component-id="${CSS.escape(target.id)}"]`,
      );
      if (!source) return;
      setActiveComponentId(target.id);
      setActiveNodeId(undefined);
      setActiveField();
    },
    [phase, review.components, activeComponentId],
  );

  const clearInspectorTransientSelection = useCallback(() => {
    setActiveField();
  }, []);

  const switchSibling = useCallback(
    (index: number) => {
      if (phase !== "docked") return;
      setInstantNavigation(false);
      if (!activeNode) {
        switchComponent(index);
        return;
      }
      const target = siblingNodes[index];
      if (!target || target.id === activeNodeId) return;
      clearInspectorTransientSelection();
      setActiveNodeId(target.id);
    },
    [
      phase,
      activeNode,
      activeNodeId,
      siblingNodes,
      switchComponent,
      clearInspectorTransientSelection,
    ],
  );

  const handleInspectorBack = useCallback(() => {
    if (phase !== "entering" && phase !== "docked") return;
    setInstantNavigation(false);
    clearInspectorTransientSelection();
    setFeedbackLocate(undefined);
    // canvas 深层画板：沿 history 栈回退一层（与 Escape 语义一致，HARD-GATE 29）。
    if (pageView.detail !== null) {
      const previous = pageView.history[pageView.history.length - 1];
      const previousRef = previous?.detail?.ref;
      leaveCanvas();
      if (previousRef) {
        setActiveNodeId(previousRef);
      } else {
        startRestore();
      }
      return;
    }
    if (activeNodeId) {
      setActiveNodeId(activeParent?.id);
      return;
    }
    startRestore();
  }, [
    phase,
    pageView,
    leaveCanvas,
    activeNodeId,
    activeParent,
    clearInspectorTransientSelection,
    startRestore,
  ]);

  const handleReset = useCallback(() => {
    setInstantNavigation(false);
    setFeedbackLocate(undefined);
    startRestore();
  }, [startRestore]);

  const handleImport = useCallback(
    (next: ReviewPayload) => {
      setPayload(next);
      pageNavReset();
      setPhase("page");
      setActiveComponentId(undefined);
      setActiveNodeId(undefined);
      setActiveField();
      setFeedbackLocate(undefined);
      setLocateMissedEntryId(undefined);
      setRichDetail(undefined);
      setOpenQuestionsPanelOpen(false);
    },
    [pageNavReset],
  );

  const handleImportFeedback = useCallback(
    async (content: string) => {
      // 显式导入：传原始 JSON 字符串给 hook，损坏/错 slug 的存量也可恢复。
      await david.updateFeedback(content);
    },
    [david],
  );

  /**
   * Auto-copy a feedback doc to the agent clipboard when the bridge flag is on.
   * Must only run inside a user gesture (never from an effect); callers pass the
   * freshly-updated doc so the copied payload reflects the latest change.
   */
  const handleAutoCopy = useCallback(
    (next: DavidFeedbackDocument) => {
      let bridgeEnabled = false;
      try {
        bridgeEnabled =
          window.localStorage.getItem(`david:${review.slug}:bridge`) === "1";
      } catch {
        // localStorage can throw in private mode; keep the disabled default.
      }
      if (!bridgeEnabled) return;
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        showToast(
          "error",
          "此环境不支持写入剪贴板，请改用「导出 feedback JSON」",
        );
        return;
      }
      void navigator.clipboard
        .writeText(buildAgentClipboardPayload(next))
        .then(() => showToast("success", "已自动复制反馈给 agent"))
        .catch(() => showToast("error", "自动复制失败，请手动复制"));
    },
    [review.slug],
  );

  /** 离线横幅：复制一段可直接粘给 agent 的启动指令。 */
  const handleCopyServeHint = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      showToast("error", "此环境不支持写入剪贴板，请手动运行 serve 命令");
      return;
    }
    void navigator.clipboard
      .writeText(feedbackServeHint(review.slug))
      .then(() => showToast("success", "启动指令已复制，粘贴给 agent 即可"))
      .catch(() => showToast("error", "复制失败，请手动运行 serve 命令"));
  }, [review.slug]);

  /** DavidFeedbackPanel onChange: auto-copy only after a new feedback entry is added. */
  const handleFeedbackChange = useCallback(
    async (input: string | DavidFeedbackDocument) => {
      const current = feedbackDocRef.current;
      await david.updateFeedback(input);
      if (typeof input === "string") return; // explicit JSON import, not a submit
      if (current === undefined) return;
      if (input.entries.length === current.entries.length + 1) {
        handleAutoCopy(input);
      }
    },
    [david, handleAutoCopy],
  );

  /** CommentRail onReply: auto-copy the doc including the freshly added reply. */
  const handleRailReply = useCallback(
    async (entryId: string, body: string) => {
      const reply = await david.replyToFeedback(entryId, body);
      const current = feedbackDocRef.current;
      if (current === undefined) return;
      handleAutoCopy(
        current.entries.some((entry) =>
          entry.replies?.some((item) => item.id === reply.id),
        )
          ? current
          : appendFeedbackReply(current, entryId, reply),
      );
    },
    [david, handleAutoCopy],
  );

  const requestSelection = useCallback((entryId?: string) => {
    setCaptureRequest({ entryId });
    window.dispatchEvent(new Event(REQUEST_CAPTURE_EVENT));
  }, []);
  const saveAttachedSelection = useCallback(
    async (entryId: string, selection: AppearanceSelection) => {
      try {
        await david.addFeedbackSelection(entryId, selection);
        setPendingAttachment(null);
        showToast("success", "选区已追加到评论");
      } catch (error) {
        setPendingAttachment({
          entryId,
          selection,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [david],
  );

  // 反馈定位：记录请求，由 effect 在场景就绪后滚动/命中。
  const handleLocateFeedback = useCallback(
    (entry: DavidFeedbackEntry) => {
      pulseCleanupRef.current?.();
      pulseCleanupRef.current = undefined;
      closeOpenRichDetails();
      setLocateMissedEntryId(undefined);
      setRichDetail(undefined);
      const selections = feedbackSelections(entry.scope);
      const preferred =
        selections.length > 1 ? preferredSelection(selections) : undefined;
      const scope =
        preferred && preferred !== selections[0]
          ? selectionScope(preferred)
          : entry.scope;
      const target = resolveFeedbackTarget(scope);
      if (!target) {
        setLocateMissedEntryId(entry.id);
        return;
      }
      if (
        target.pageId &&
        !payload.pages.some((page) => page.id === target.pageId)
      ) {
        // 不存在的 page：明确失效，不进入无限等待。
        setLocateMissedEntryId(entry.id);
        return;
      }
      const targetComponent = review.components.find(
        (item) => item.id === target.componentId,
      );
      let locateTargetId = scope?.targetId;
      // Programmatic comments must use the same visible layer as the inspector's
      // drill-in control. Preserve explicitly captured selections/detail dialogs.
      if (!scope?.selection && targetComponent && target.nodeId) {
        const path = findNodePath(
          targetComponent.children ?? [],
          target.nodeId,
        );
        const leaf = path?.at(-1);
        if (leaf && isInlineReviewNode(leaf, targetComponent)) {
          const row = resolveNodeMapping(leaf, targetComponent)[0];
          target.nodeId = path?.at(-2)?.id;
          const column =
            row.api?.contractIds?.length || row.api?.changed ? "api" : "change";
          locateTargetId = `${target.nodeId ?? targetComponent.id}:${row.id}:${column}`;
        }
      }
      if (
        target.componentId &&
        (!targetComponent ||
          (target.nodeId &&
            !flattenReviewTree(targetComponent.children ?? []).some(
              (node) => node.id === target.nodeId,
            )))
      ) {
        setLocateMissedEntryId(entry.id);
        return;
      }
      setInstantNavigation(true);
      if (target.pageId && target.pageId !== activePageId) {
        // Page, component and node commit together; no visible overview waypoint.
        pageGoTo(target.pageId);
        setActiveField();
        if (!target.componentId) setPhase("page");
      }
      if (target.componentId) {
        setActiveComponentId(target.componentId);
        setActiveNodeId(target.nodeId);
        setActiveField();
        setPhase(
          phase === "docked" &&
            (!target.pageId || target.pageId === activePageId)
            ? "docked"
            : "entering",
        );
      }
      // 反馈面板 shell 锚：直接打开真实面板，无需场景切换。
      if (scope?.targetId === "shell:feedback-panel") {
        setFeedbackOpen(true);
        return;
      }
      setFeedbackLocate({
        entryId: entry.id,
        pageId: target.pageId,
        componentId: target.componentId,
        nodeId: target.nodeId,
        targetId: locateTargetId,
        selection: scope?.selection,
      });
    },
    [payload.pages, review.components, activePageId, pageGoTo, phase],
  );

  // 反馈定位执行：先把场景（页/组件/节点）切到目标，再命中真实锚点；
  // 无效 page/component/node 与无锚场景一律有界失效，不把随意滚动当成功。
  useLayoutEffect(() => {
    if (!feedbackLocate) return;
    const request = feedbackLocate;
    const { entryId, pageId, componentId, nodeId, targetId, selection } =
      request;

    const finishMissed = () => {
      pulseCleanupRef.current?.();
      pulseCleanupRef.current = undefined;
      setFeedbackLocate(undefined);
      setLocateMissedEntryId(entryId);
    };
    const finishLocated = (element?: HTMLElement) => {
      pulseCleanupRef.current?.();
      pulseCleanupRef.current = undefined;
      if (element) {
        pulseCleanupRef.current = scrollAndPulse(element);
      }
      setFeedbackLocate(undefined);
      setLocateMissedEntryId(undefined);
    };
    // 场景切换与富详情命中：effect 内局部函数，避免同步 setState 级联渲染。
    const switchScene = (nextComponentId: string, nextNodeId?: string) => {
      setActiveComponentId(nextComponentId);
      setActiveNodeId(nextNodeId);
      setActiveField();
    };
    const openRichDetail = (request: RichDetailRequest) => {
      setRichDetail(request);
      setFeedbackLocate(undefined);
      setLocateMissedEntryId(undefined);
    };
    const requestRestore = () => startRestore();

    // 等切页完成；page 不存在则双保险标记失效。
    if (pageId && pageId !== activePageId) return;
    if (pageId && !payload.pages.some((page) => page.id === pageId)) {
      finishMissed();
      return;
    }

    // 场景切换：先把 component/node 状态切到目标，再找锚点。
    if (componentId) {
      const targetComponent = review.components.find(
        (item) => item.id === componentId,
      );
      if (!targetComponent) {
        finishMissed();
        return;
      }
      if (
        !frameRef.current?.querySelector(
          `[data-component-id="${CSS.escape(componentId)}"]`,
        )
      ) {
        setPhase("page");
        setActiveComponentId(undefined);
        setActiveNodeId(undefined);
        finishMissed();
        return;
      }
      if (phase === "page") {
        // External-state sync (feedback locate request -> scene transition);
        // the phase change must happen synchronously so the effect's next run
        // continues the locate flow without an intermediate paint.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        openComponent(componentId, true);
        return;
      }
      if (phase !== "docked") return; // entering/leaving：等动画完成
      if (activeComponentId !== componentId) {
        // docked 于组件 A 时切到组件 B（有界切换，不 return 卡死）。
        switchScene(componentId, undefined);
        return;
      }
      if (nodeId) {
        const nodeExists = flattenReviewTree(
          targetComponent.children ?? [],
        ).some((node) => node.id === nodeId);
        if (!nodeExists) {
          finishMissed();
          return;
        }
        if (activeNodeId !== nodeId) {
          skipInspectorScrollResetRef.current = true;
          switchScene(componentId, nodeId);
          return;
        }
      } else if (activeNodeId !== undefined) {
        // 组件根层目标：子节点中点击根反馈也要清掉 activeNodeId，
        // 否则留下错误面包屑、根 mapping 不可见。
        skipInspectorScrollResetRef.current = true;
        switchScene(componentId, undefined);
        return;
      }
    } else if (phase !== "page") {
      // page/shell/overview 级目标：回总览再定位（docked 时 overview 隐藏、
      // body 滚动被锁，fallback 滚动只是伪成功）。
      if (phase === "docked") requestRestore();
      return;
    }

    // rich-detail 选区：先恢复对应节点/行，再打开富详情 dialog。
    const detail = selection?.detail;
    if (detail) {
      const detailComponentId = detail.componentId ?? componentId;
      if (detail.nodeId && detail.nodeId !== activeNodeId) {
        const comp = review.components.find(
          (item) => item.id === detailComponentId,
        );
        const nodeExists =
          comp &&
          flattenReviewTree(comp.children ?? []).some(
            (node) => node.id === detail.nodeId,
          );
        if (nodeExists && detailComponentId) {
          // 保留 feedbackLocate，节点就绪后 effect 重跑再开 dialog。
          skipInspectorScrollResetRef.current = true;
          switchScene(detailComponentId, detail.nodeId);
          return;
        }
      }
      const row = detailComponentId
        ? findMappingRow(
            review.components,
            detailComponentId,
            detail?.rowId ?? "",
          )
        : undefined;
      if (row && detail) {
        const column = RICH_DETAIL_COLUMNS.includes(
          detail.column as DisclosureColumn,
        )
          ? (detail.column as DisclosureColumn)
          : "requirement";
        if (shouldInlineDisclosure(row, column)) {
          const hostRow = inspectorRef.current?.querySelector<HTMLElement>(
            `[data-trd-row="${CSS.escape(row.id)}"]`,
          );
          if (hostRow && !isRowExpanded(row.id)) {
            setRowExpanded(row.id, true);
            return;
          }
          const inlineContent = hostRow?.querySelector<HTMLElement>(
            `[data-disclosure-column="${column}"]`,
          );
          if (inlineContent) finishLocated(inlineContent);
          else finishMissed();
          return;
        }
        if (
          !hasDisclosureDetail(
            row,
            column,
            detail.nodeId ? "node" : "component",
          )
        ) {
          const locateComponentId = detailComponentId ?? componentId;
          if (locateComponentId && phase === "page") {
            openComponent(locateComponentId, true);
            return;
          }
          if (
            locateComponentId &&
            phase === "docked" &&
            activeComponentId !== locateComponentId
          ) {
            switchScene(locateComponentId, undefined);
            return;
          }
          finishMissed();
          return;
        }
        openRichDetail({
          focusSelection: selection,
          row,
          column,
          componentId: detailComponentId,
          nodeId: detail.nodeId,
        });
        return;
      }
      finishMissed();
      return;
    }

    // Mapping metadata is more precise than a broad component/shell target.
    const mapping = selection?.context?.mapping;
    if (selection && mapping?.rowId && phase === "docked") {
      const hostRow = inspectorRef.current?.querySelector<HTMLElement>(
        `[data-trd-row="${CSS.escape(mapping.rowId)}"]`,
      );
      if (hostRow) {
        if (!isRowExpanded(mapping.rowId)) {
          setRowExpanded(mapping.rowId, true);
          return;
        }
        const column = mapping.column;
        const target =
          column && column !== "trd"
            ? hostRow.querySelector<HTMLElement>(
                `[data-disclosure-column="${CSS.escape(column)}"],[data-review-target$=":${CSS.escape(mapping.rowId)}:${CSS.escape(column)}"]`,
              )
            : hostRow;
        if (target) {
          finishLocated(focusWithinSelection(target, selection));
          return;
        }
      }
    }

    // 元素目标：仅在当前可见 surface 根中按优先级查找，
    // 不命中 hidden/inert 的常驻 overview 或背景 clone。
    if (targetId) {
      const usableRoot = (
        root: HTMLDivElement | null | undefined,
      ): root is HTMLDivElement => {
        if (!root || !hasUsableAncestry(root)) return false;
        const rect = root.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const orderedRoots =
        phase === "docked"
          ? [
              inspectorRef.current,
              previewRef.current,
              frameRef.current,
              overviewRef.current,
            ]
          : [
              overviewRef.current,
              frameRef.current,
              previewRef.current,
              inspectorRef.current,
            ];
      for (const root of orderedRoots) {
        if (!usableRoot(root)) continue;
        const element = root.querySelector<HTMLElement>(
          `[data-review-target="${CSS.escape(targetId)}"]`,
        );
        const rowId =
          element?.closest<HTMLElement>("[data-trd-row]")?.dataset.trdRow;
        if (rowId && !isRowExpanded(rowId)) {
          setRowExpanded(rowId, true);
          return;
        }
        if (element && hasUsableAncestry(element)) {
          finishLocated(element);
          return;
        }
      }
      if (/^surface:(page|overview|inspector|dock)$/.test(targetId)) {
        finishMissed();
        return;
      }
    }

    finishMissed();
  }, [
    feedbackLocate,
    activePageId,
    phase,
    activeComponentId,
    activeNodeId,
    review.components,
    payload.pages,
    openComponent,
    startRestore,
    isRowExpanded,
    setRowExpanded,
  ]);

  // 动画期间锁 body 滚动
  useLayoutEffect(() => {
    document.body.classList.toggle("is-inspector-open", phase !== "page");
  }, [phase]);

  // 每个页面/组件/节点保存自己的阅读位置；反馈定位仍拥有目标滚动的优先权。
  useLayoutEffect(() => {
    if (skipInspectorScrollResetRef.current) {
      skipInspectorScrollResetRef.current = false;
      return;
    }
    const shell = inspectorRef.current;
    if (shell)
      shell.scrollTop = inspectorScrollPositions.current.get(readingScope) ?? 0;
  }, [readingScope]);

  // Escape 全局返回：docked 时逐级退出节点，根级再按则收起 inspector；
  // feedback 面板打开时交给面板自身 handler，输入类元素聚焦时不拦截
  useEffect(() => {
    if (feedbackOpen || materialsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }
      if (phase !== "entering" && phase !== "docked") return;
      handleInspectorBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [feedbackOpen, materialsOpen, phase, handleInspectorBack]);

  // 页面翻页键盘（HARD-GATE 29）：ArrowRight/ArrowLeft 在 page 相位翻页，
  // 边界 no-op（无 wrap）；详情（dock）相位不拦截，避免干扰后续同级切换。
  useEffect(() => {
    if (phase !== "page") return;
    if (feedbackOpen || openQuestionsPanelOpen || materialsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }
      if (event.key === "ArrowRight" && canNext) {
        setInstantNavigation(false);
        event.preventDefault();
        pageNext();
      } else if (event.key === "ArrowLeft" && canPrev) {
        setInstantNavigation(false);
        event.preventDefault();
        pagePrev();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    phase,
    feedbackOpen,
    openQuestionsPanelOpen,
    materialsOpen,
    canNext,
    canPrev,
    pageNext,
    pagePrev,
  ]);

  // A data-board field can locate its UI component without losing the contract.
  useEffect(() => {
    const locate = (event: Event) => {
      if (phase !== "docked") return;
      const field = (event as CustomEvent<ApiField>).detail;
      const source = frameRef.current?.querySelector<HTMLElement>(
        `[data-api-field~="${CSS.escape(field.target ?? field.name)}"]`,
      );
      const id = source?.closest<HTMLElement>("[data-component-id]")?.dataset
        .componentId;
      if (!id || id === activeComponentId) return;
      const row = component?.mapping.find((item) =>
        item.api?.fields?.some((candidate) => candidate.name === field.name),
      );
      if (row) {
        closeOpenRichDetails();
        setRichDetail({ row, column: "api", componentId: component?.id });
      }
      setActiveComponentId(id);
      setActiveNodeId(undefined);
    };
    window.addEventListener(CONTRACT_FIELD_LOCATE_EVENT, locate);
    return () =>
      window.removeEventListener(CONTRACT_FIELD_LOCATE_EVENT, locate);
  }, [phase, activeComponentId, component]);

  // Reapply the shared selected field after imperative clone replacement.
  useEffect(() => {
    refreshFieldHighlight(phase === "docked");
  }, [activeComponentId, activeField, activeNodeId, phase, payload]);
  useEffect(() => {
    setActiveField();
  }, [payload]);

  // overview / inspector 表面渲染后补齐自动评审目标（data-auto-review-target +
  // data-review-label），供全局框选命中与 rail 定位使用。
  useEffect(() => {
    if (phase !== "page") return;
    const root = overviewRef.current;
    if (root) prepareReviewTargets(root);
  }, [phase, payload, activePageId]);

  useEffect(() => {
    if (phase === "page" || !component) return;
    const root = inspectorRef.current;
    if (root) prepareReviewTargets(root);
  }, [phase, component, activeNodeId, payload]);

  return (
    <PreparationContext.Provider value={review.slug}>
      <ApiContractsContext.Provider value={review.apiContracts ?? []}>
        <main className="app">
          <script
            id="david-agent-feedback"
            type="application/json"
            data-schema="david-feedback/v1"
            data-updated-at={feedbackDoc.updatedAt}
            data-entries={feedbackDoc.entries.length}
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(feedbackDoc).replace(/</g, "\\u003c"),
            }}
          />
          <script
            id="david-design-context"
            type="application/json"
            dangerouslySetInnerHTML={{ __html: designContextJson }}
          />
          <ReviewMaterialsPanel
            key={`${review.slug}|${david.serviceBaseUrl}`}
            open={materialsOpen}
            onClose={closeMaterials}
            slug={review.slug}
            pages={payload.pages}
            activePageId={activePageId}
            serviceBaseUrl={david.serviceBaseUrl}
          />
          <AppHeader
            onOpenMaterials={() => setMaterialsOpen(true)}
            title={review.title}
            subtitle={review.subtitle}
            slug={review.slug}
            sourcePath={review.sourcePath}
            feedbackDoc={feedbackDoc}
            onReset={handleReset}
            onImport={handleImport}
            onImportFeedback={handleImportFeedback}
            onOpenDavid={() => setFeedbackOpen(true)}
            onImportDavidPlugin={david.importPlugin}
            activePluginName={david.activePlugin?.name}
            supplementaryBoards={currentPageBoards}
            onOpenBoard={openBoard}
            openQuestionCount={openQuestions?.length}
            openQuestionOpenCount={openQuestionOpenCount}
            onOpenQuestions={() => setOpenQuestionsPanelOpen(true)}
          />
          {david.sync === "offline" && (
            <div className="feedback-offline-banner" role="status">
              <span className="feedback-offline-text">
                评论服务未启动（{david.serviceBaseUrl}），当前无法写入评论。 让
                agent 拉起服务后即可读写，且 agent 能直接读到本页评论。
              </span>
              <span className="feedback-offline-actions">
                <button
                  type="button"
                  className="feedback-offline-copy"
                  onClick={handleCopyServeHint}
                >
                  复制启动指令
                </button>
                <button
                  type="button"
                  className="feedback-offline-retry"
                  onClick={david.reload}
                >
                  重试连接
                </button>
              </span>
            </div>
          )}
          {david.error && (
            <div className="comment-load-warning" role="alert">
              <span className="comment-load-warning-text">
                {david.error.message}
              </span>
            </div>
          )}
          <section
            className={`stage ${
              phase === "entering" || phase === "docked" ? "has-inspector" : ""
            }`}
          >
            <CanvasTransformContext.Provider value={canvasTransform}>
              <ReviewCanvas
                pages={payload.pages}
                activePageId={activePageId}
                phase={phase}
                instantNavigation={instantNavigation}
                activeComponentId={activeComponentId}
                nativeComponent={component?.kind === "ui"}
                activeNodeAnchor={activeNode?.target ?? activeNode?.id}
                displayNodeAnchor={displayNodeAnchor}
                activeNodeMode={
                  activeNode ? resolveNodeModeWithPlugin(activeNode) : undefined
                }
                resolveNodeMode={(anchor) => {
                  const node = allNodeByAnchor.get(anchor);
                  return node ? resolveNodeModeWithPlugin(node) : undefined;
                }}
                isExplicitDrilldown={isExplicitDrilldown}
                isCanvasNode={isCanvasNode}
                onNodeActivate={(anchor, mode) => {
                  setInstantNavigation(false);
                  const node = allNodeByAnchor.get(anchor);
                  if (!node) return;
                  const nodeId = node.id;
                  clearInspectorTransientSelection();
                  // canvas 深层画板：沿 history 栈压入当前画板态。
                  if (mode === "canvas" && activeNodeId !== nodeId) {
                    enterCanvas(nodeId, (pageView.detail?.depth ?? 0) + 1);
                  }
                  // 支持从主画板直接进入节点，以及 inspector 打开后切换其他组件。
                  const host = review.components.find((item) =>
                    flattenReviewTree(item.children ?? []).some(
                      (n) => n.id === nodeId,
                    ),
                  );
                  if (!host) return;
                  if (phase === "page" || host.id !== activeComponentId)
                    openComponent(host.id);
                  setActiveNodeId(nodeId);
                }}
                supplementaryBoardIds={supplementaryBoardIds}
                frameRef={frameRef}
                previewRef={previewRef}
                onSelect={handleSelect}
                onPageChange={handlePageChange}
                visitedPages={visitedPages}
                canPrev={canPrev}
                canNext={canNext}
                onPrev={() => {
                  setInstantNavigation(false);
                  pagePrev();
                }}
                onNext={() => {
                  setInstantNavigation(false);
                  pageNext();
                }}
                resolveNodeLabel={(anchor) =>
                  allNodeByAnchor.get(anchor)?.label
                }
                onEntered={handleEntered}
                onRestored={handleRestored}
                onCanvasTransform={handleCanvasTransform}
              />
              <div
                ref={overviewRef}
                data-surface="overview"
                className={`david-overview-surface ${
                  phase === "page"
                    ? "is-active"
                    : phase === "leaving"
                      ? "is-returning"
                      : "is-hidden"
                }`}
                inert={phase !== "page"}
              >
                <OverviewDetails
                  review={pageOverviewReview}
                  onComponentSelect={openComponent}
                  active={phase === "page"}
                />
              </div>
              {phase !== "page" && component && (
                <div
                  ref={inspectorRef}
                  onScroll={(event) =>
                    inspectorScrollPositions.current.set(
                      readingScope,
                      event.currentTarget.scrollTop,
                    )
                  }
                  className={`inspector-shell ${phase === "leaving" ? "is-leaving" : ""}`}
                  data-navigation={instantNavigation ? "direct" : undefined}
                >
                  <ComponentDetails
                    component={component}
                    node={activeNode}
                    mapping={activeMapping}
                    expandedRows={expandedRows}
                    onRowToggle={(rowId) => {
                      setInstantNavigation(false);
                      setRowExpanded(rowId, !isRowExpanded(rowId));
                    }}
                    breadcrumbs={[
                      { id: undefined, label: "总览", kind: "overview" },
                      {
                        id: component.id,
                        label: component.label,
                        kind: "component",
                      },
                      ...(nodePath ?? []).map((node) => ({
                        id: node.id,
                        label: node.label,
                        kind: "node" as const,
                      })),
                    ]}
                    onBreadcrumb={(id) => {
                      setInstantNavigation(false);
                      clearInspectorTransientSelection();
                      setFeedbackLocate(undefined);
                      if (id === undefined) {
                        startRestore();
                      } else if (id === component.id) {
                        setActiveNodeId(undefined);
                      } else {
                        setActiveNodeId(id);
                      }
                    }}
                    activeField={activeField}
                    index={siblingIndex}
                    total={siblingNodes.length}
                    onFieldClick={(field: ApiField) =>
                      toggleContractField(field)
                    }
                    onClose={handleInspectorBack}
                    onSwitch={switchSibling}
                    onRowHover={(token) => {
                      // 详情态 TRD 行 hover：在 dock 克隆画板上同步 linked 高亮
                      // （与 overview 表格 hover 同一套 .david-overview-linked）。
                      const dock =
                        document.querySelector<HTMLElement>(".component-dock");
                      dock
                        ?.querySelectorAll<HTMLElement>(
                          ".david-overview-linked",
                        )
                        .forEach((el) =>
                          el.classList.remove("david-overview-linked"),
                        );
                      if (!token || !dock) return;
                      findMappingTargets(dock, token).forEach((el) =>
                        el.classList.add("david-overview-linked"),
                      );
                    }}
                    onNodeSelect={(nodeId) => {
                      clearInspectorTransientSelection();
                      setActiveNodeId(nodeId);
                    }}
                  />
                </div>
              )}
              <CommentRail
                processingTasks={david.feedbackTasks}
                processingBatch={david.feedbackBatch}
                supportsProcessingStatus={david.supportsFeedbackTasks}
                entries={feedbackDoc.entries}
                loading={david.sync === "checking"}
                currentPageId={activePageId}
                activeComponentId={activeComponentId}
                activeNodeId={activeNodeId}
                displayNodeId={displayNode?.id}
                onLocate={handleLocateFeedback}
                onAddSelection={
                  david.supportsMultiSelection ? requestSelection : undefined
                }
                onLocateSelection={(entry, index) => {
                  const selection = feedbackSelections(entry.scope)[index];
                  if (selection)
                    handleLocateFeedback({
                      ...entry,
                      scope: selectionScope(selection),
                    });
                }}
                onDelete={
                  david.supportsFeedbackDeletion
                    ? david.deleteFeedbackEntry
                    : undefined
                }
                onRemoveSelection={
                  david.supportsFeedbackDeletion
                    ? (entry, index) =>
                        david.removeFeedbackSelection(
                          entry.id,
                          feedbackSelections(entry.scope)[index],
                        )
                    : undefined
                }
                onReply={handleRailReply}
                onStatusChange={david.setFeedbackStatus}
                onDecision={david.setFeedbackDecision}
                onEdit={david.editFeedbackSuggestion}
                locateMissedEntryId={locateMissedEntryId}
              />
              <GlobalRegionSelection
                surfaces={{
                  page: frameRef,
                  overview: overviewRef,
                  inspector: inspectorRef,
                  dock: previewRef,
                }}
                scene={{
                  pageId: activePageId,
                  componentId: activeComponentId,
                  nodeId: activeNodeId,
                  displayNodeId: displayNode?.id,
                }}
                onCancel={() => setCaptureRequest(null)}
                onAppearance={(selection) => {
                  const request = captureRequest;
                  setCaptureRequest(null);
                  if (request?.entryId) {
                    void saveAttachedSelection(request.entryId, selection);
                    return;
                  }
                  setAppearanceSelection(selection);
                  setFeedbackOpen(true);
                }}
              />
              {feedbackOpen && (
                <DavidFeedbackPanel
                  doc={feedbackDoc}
                  pageId={activePageId}
                  nodePath={[
                    activeComponentId,
                    ...(nodePath ?? []).map((node) => node.id),
                  ].filter((id): id is string => Boolean(id))}
                  selection={appearanceSelection}
                  suspended={Boolean(captureRequest)}
                  onAddSelection={
                    david.supportsMultiSelection
                      ? () => requestSelection()
                      : undefined
                  }
                  onChange={handleFeedbackChange}
                  onClose={() => {
                    setFeedbackOpen(false);
                    setAppearanceSelection(undefined);
                  }}
                />
              )}
              {pendingAttachment && (
                <div className="feedback-selection-retry" role="alert">
                  <span>选区尚未保存：{pendingAttachment.error}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void saveAttachedSelection(
                        pendingAttachment.entryId,
                        pendingAttachment.selection,
                      )
                    }
                  >
                    重试保存选区
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                  >
                    取消
                  </button>
                </div>
              )}
              {richDetail && (
                <RichDetailDialog
                  row={richDetail.row}
                  focusSelection={richDetail.focusSelection}
                  column={richDetail.column}
                  componentId={richDetail.componentId}
                  nodeId={richDetail.nodeId}
                  onClose={() => setRichDetail(undefined)}
                  onFieldClick={(field) => toggleContractField(field)}
                />
              )}
              <OpenQuestionsPanel
                open={openQuestionsPanelOpen}
                onClose={() => setOpenQuestionsPanelOpen(false)}
                questions={openQuestions}
                resolvedIds={resolvedQuestionIds}
                onToggleResolved={setQuestionResolved}
              />
              <ToastHost />
            </CanvasTransformContext.Provider>
          </section>
        </main>
      </ApiContractsContext.Provider>
    </PreparationContext.Provider>
  );
}
