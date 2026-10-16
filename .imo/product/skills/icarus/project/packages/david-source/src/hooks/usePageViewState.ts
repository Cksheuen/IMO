import { useCallback, useState } from "react";
import type { PageSpec } from "../types/review";
import {
  createPageViewState,
  enterDetail,
  leaveDetail,
  nextPage,
  prevPage,
  validatePageViewState,
  type PageViewState,
} from "../lib/pageInteraction";

/**
 * 运行时接线：把 pageInteraction.ts 的纯函数状态机（HARD-GATE 29）接入 React。
 *
 * 单一真源持有 `PageViewState`（pageIndex + detail + history），所有变更先经
 * 纯函数转移，`validatePageViewState` 拒绝非法状态后才会提交上屏
 * （契约：状态上屏前必须过校验）。向后兼容：无 pages 的单页 spec 走同一个 hook，
 * next/prev 均为边界 no-op。
 *
 * detail 层只承载 **canvas 深层画板** 详情（kind=canvas）：现有 highlight/drilldown
 * 组件/节点导航继续由 App 的 phase/activeNodeId 管理；Escape 在 canvas 详情存在时
 * 沿 history 栈回退一层，否则回落到既有行为。
 *
 * 不使用 ref 缓存 view：callbacks 以当前 view 重建，事件处理器拿到的是最新一帧，
 * 满足 react-hooks/refs 规则与 StrictMode。
 */
export type PageNav = {
  view: PageViewState;
  pageId: string;
  pageIndex: number;
  canPrev: boolean;
  canNext: boolean;
  visitedPages: ReadonlySet<string>;
  /** 下一页：边界 no-op（无 wrap）。可导航性同时给出供 UI 禁用。 */
  next: () => void;
  prev: () => void;
  /** 直接跳转指定页（等价于既有 onPageChange）。非法 id 忽略。 */
  goTo: (pageId: string, canvasRef?: string) => void;
  /** 进入 canvas 深层画板：压入 history 栈。ref 为节点/目标锚点名。 */
  enterCanvas: (ref: string, depth?: number) => void;
  /** 沿 history 栈回退一层（Escape / 返回同语义）。 */
  leaveCanvas: () => void;
  /** 回到 page 相位后清空 detail 栈，避免 stale canvas 详情残留。 */
  resetDetail: () => void;
  /** 导入新 payload 后重建状态机（回到首页、清空访问记录）。 */
  reset: () => void;
  /** 上屏前硬校验当前状态（契约校验入口，供断言与 debug）。 */
  validate: () => boolean;
};

export function usePageViewState(pages: readonly PageSpec[] | null): PageNav {
  const pageCount = pages?.length ?? 0;
  const [view, setView] = useState<PageViewState>(() =>
    createPageViewState(pageCount, 0),
  );
  const [visitedPages, setVisitedPages] = useState<ReadonlySet<string>>(
    () => new Set(pages && pages.length > 0 ? [pages[0].id] : []),
  );

  const markVisited = useCallback(
    (pageIndex: number) => {
      const id = pages?.[pageIndex]?.id;
      if (!id) return;
      setVisitedPages((existing) =>
        existing.has(id) ? existing : new Set(existing).add(id),
      );
    },
    [pages],
  );

  /** 提交守卫：纯函数转移结果通过 validatePageViewState 才上屏。 */
  const commit = useCallback(
    (compute: (current: PageViewState) => PageViewState | undefined | null) => {
      const next = compute(view);
      if (!next || !validatePageViewState(next, pageCount)) return;
      setView(next);
      markVisited(next.pageIndex);
    },
    [view, pageCount, markVisited],
  );

  const next = useCallback(() => {
    commit((current) => nextPage(current, pageCount));
  }, [commit, pageCount]);

  const prev = useCallback(() => {
    commit((current) => prevPage(current, pageCount));
  }, [commit, pageCount]);

  const goTo = useCallback(
    (pageId: string, canvasRef?: string) => {
      const index = pages?.findIndex((page) => page.id === pageId) ?? -1;
      if (index < 0) return;
      commit(() => {
        const next = createPageViewState(pageCount, index);
        return canvasRef ? enterDetail(next, "canvas", canvasRef, 1) : next;
      });
    },
    [commit, pages, pageCount],
  );

  const enterCanvas = useCallback(
    (ref: string, depth?: number) => {
      commit((current) => enterDetail(current, "canvas", ref, depth));
    },
    [commit],
  );

  const leaveCanvas = useCallback(() => {
    commit((current) => leaveDetail(current));
  }, [commit]);

  const resetDetail = useCallback(() => {
    commit((current) => {
      if (current.detail === null && current.history.length === 0) return null;
      return { ...current, detail: null, history: [] };
    });
  }, [commit]);

  const reset = useCallback(() => {
    setVisitedPages(new Set());
    commit(() => createPageViewState(pageCount, 0));
  }, [commit, pageCount]);

  const validate = useCallback(
    () => validatePageViewState(view, pageCount),
    [view, pageCount],
  );

  const pageIndex = view.pageIndex;
  const pageId = pages?.[pageIndex]?.id ?? "default";
  const canPrev = pageCount > 1 && pageIndex > 0;
  const canNext = pageCount > 1 && pageIndex < pageCount - 1;

  return {
    view,
    pageId,
    pageIndex,
    canPrev,
    canNext,
    visitedPages,
    next,
    prev,
    goTo,
    enterCanvas,
    leaveCanvas,
    resetDetail,
    reset,
    validate,
  };
}
