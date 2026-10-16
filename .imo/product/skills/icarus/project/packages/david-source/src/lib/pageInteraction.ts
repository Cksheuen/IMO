/**
 * 多页面 / 画板交互状态机（HARD-GATE 29）。
 *
 * 纯函数层，不触碰 DOM。描述「页面 + 详情」两级导航的合法转移、
 * 详情形态判定（highlight / drilldown / canvas）、键盘映射与返回语义，
 * 以及状态自身的数据校验。默认配置严格向后兼容现有交互模型：
 * - auto 节点仍解析为 highlight（与 reviewTree.resolveInteraction 一致）
 * - 显式 drilldown / highlight 保持原语义
 * - canvas（深层画板 / 等比放大）只在节点声明 canvas 或开启
 *   magnifyOnComplex 且子树深度达到阈值时出现
 *
 * 页面数小于 2 时 prev/next 均为边界 no-op（无 wrap），与 overview 的
 * prev/next 语义一致。返回（Escape / back）沿 history 栈回退一层到入口态。
 */
import type { ReviewInteraction } from "../types/review";

export type DetailKind = "highlight" | "drilldown" | "canvas";

/** 详情态。ref 为节点/目标锚点名（如 nodeId 或 target）；depth 为画板缩放层级。 */
export type PageDetail = null | {
  kind: DetailKind;
  ref: string;
  depth: number;
};

/** 页面 + 详情视图状态。history 为详情入口快照栈（back 回退一层）。 */
export type PageViewState = {
  pageIndex: number;
  detail: PageDetail;
  history: Array<{ pageIndex: number; detail: PageDetail }>;
};

export type DetailCandidate = {
  interaction?: ReviewInteraction;
  canvas?: boolean;
  children?: readonly unknown[];
};

export type ResolveDetailOptions = {
  /** 复杂节点（childrenDepth >= complexDepth）进入 canvas 等比放大视图。 */
  magnifyOnComplex?: boolean;
  /** 默认 4：children 子树深度达到该值视为复杂。 */
  complexDepth?: number;
};

export type PageTransitionResult = {
  state: PageViewState;
  handled: boolean;
};

export const DETAIL_KINDS: readonly DetailKind[] = [
  "highlight",
  "drilldown",
  "canvas",
];

/** children 子树最大深度（空子树为 0）。 */
const childrenDepth = (children?: readonly unknown[]): number => {
  if (!children || children.length === 0) return 0;
  let max = 0;
  for (const child of children) {
    const node = child as { children?: readonly unknown[] };
    max = Math.max(max, 1 + childrenDepth(node.children));
  }
  return max;
};

/**
 * 详情形态判定：
 * - 显式 drilldown / highlight 保持原语义（权威优先）
 * - 声明 canvas 的节点进入深层画板
 * - magnifyOnComplex 开启且子树深度达标 → canvas（按复杂度 highlight 或等比放大）
 * - 缺省（auto）→ highlight，与 resolveInteraction 完全一致（向后兼容）
 */
export function resolveDetailKind(
  node: DetailCandidate,
  options: ResolveDetailOptions = {},
): DetailKind {
  if (node.interaction === "drilldown") return "drilldown";
  if (node.interaction === "highlight") return "highlight";
  if (node.canvas === true) return "canvas";
  if (options.magnifyOnComplex === true) {
    const threshold = options.complexDepth ?? 4;
    if (childrenDepth(node.children) >= threshold) return "canvas";
  }
  return "highlight";
}

const clampPageIndex = (index: number, pageCount: number): number => {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return 0;
  return Math.min(Math.max(Math.floor(index), 0), pageCount - 1);
};

/** 初始态：pageIndex 0、detail null、history 空。 */
export function createPageViewState(
  pageCount: number,
  initialPageIndex = 0,
): PageViewState {
  return {
    pageIndex: clampPageIndex(initialPageIndex, pageCount),
    detail: null,
    history: [],
  };
}

/** 下一页；已在最后一页或无多页时 no-op（返回 undefined，无 wrap）。 */
export function nextPage(
  state: PageViewState,
  pageCount: number,
): PageViewState | undefined {
  if (pageCount < 2 || state.pageIndex >= pageCount - 1) return undefined;
  return { pageIndex: state.pageIndex + 1, detail: null, history: [] };
}

/** 上一页；已在第一页或无多页时 no-op。 */
export function prevPage(
  state: PageViewState,
  pageCount: number,
): PageViewState | undefined {
  if (pageCount < 2 || state.pageIndex <= 0) return undefined;
  return { pageIndex: state.pageIndex - 1, detail: null, history: [] };
}

/** 进入详情：把当前态压入 history 栈，返回带 detail 的新态。 */
export function enterDetail(
  state: PageViewState,
  kind: DetailKind,
  ref: string,
  depth = 1,
): PageViewState {
  if (!ref || ref.trim() === "") return state;
  return {
    pageIndex: state.pageIndex,
    detail: {
      kind,
      ref,
      depth: Math.max(1, Math.floor(depth)),
    },
    history: [
      ...state.history,
      { pageIndex: state.pageIndex, detail: state.detail },
    ],
  };
}

/** 返回：沿 history 栈回退一层；无 history 且无详情时保持原态。 */
export function leaveDetail(state: PageViewState): PageViewState {
  if (state.detail === null) return state;
  if (state.history.length === 0) {
    return { pageIndex: state.pageIndex, detail: null, history: [] };
  }
  const previous = state.history[state.history.length - 1];
  return {
    pageIndex: previous.pageIndex,
    detail: previous.detail,
    history: state.history.slice(0, -1),
  };
}

/** back 为 leaveDetail 的语义别名（Escape / 浏览器返回同语义）。 */
export const back = leaveDetail;

/**
 * 键盘转移：
 * - ArrowRight → 下一页；ArrowLeft → 上一页（边界 no-op，handled=false）
 * - Escape → 返回上一层（无详情时 no-op）
 * - 其余键 → handled=false，状态不变
 */
export function pageTransition(
  state: PageViewState,
  key: string,
  pageCount: number,
): PageTransitionResult {
  if (key === "ArrowRight") {
    const next = nextPage(state, pageCount);
    return next ? { state: next, handled: true } : { state, handled: false };
  }
  if (key === "ArrowLeft") {
    const prev = prevPage(state, pageCount);
    return prev ? { state: prev, handled: true } : { state, handled: false };
  }
  if (key === "Escape") {
    if (state.detail === null) return { state, handled: false };
    return { state: leaveDetail(state), handled: true };
  }
  return { state, handled: false };
}

const isValidDetail = (detail: PageDetail): boolean => {
  if (detail === null) return true;
  return (
    DETAIL_KINDS.includes(detail.kind) &&
    typeof detail.ref === "string" &&
    detail.ref.trim() !== "" &&
    typeof detail.depth === "number" &&
    Number.isInteger(detail.depth) &&
    detail.depth >= 1
  );
};

/**
 * 状态数据校验：pageIndex 落在 [0, pageCount-1]、detail/history 均合法。
 * 不抛错，返回布尔（供运行时在渲染前断言）。
 */
export function validatePageViewState(
  state: PageViewState,
  pageCount: number,
): boolean {
  if (!state || typeof state !== "object") return false;
  if (
    !Number.isInteger(state.pageIndex) ||
    state.pageIndex < 0 ||
    state.pageIndex >= pageCount
  ) {
    return false;
  }
  if (!isValidDetail(state.detail)) return false;
  if (!Array.isArray(state.history)) return false;
  for (const row of state.history) {
    if (
      !row ||
      typeof row !== "object" ||
      !Number.isInteger(row.pageIndex) ||
      row.pageIndex < 0 ||
      row.pageIndex >= pageCount ||
      !isValidDetail(row.detail)
    ) {
      return false;
    }
  }
  return true;
}
