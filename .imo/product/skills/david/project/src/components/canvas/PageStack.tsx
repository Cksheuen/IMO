import { useLayoutEffect, useRef } from "react";
import type { PageSpec } from "../../types/review";

interface PageStackProps {
  pages: PageSpec[];
  activePageId: string;
  visitedPages?: ReadonlySet<string>;
  canPrev?: boolean;
  canNext?: boolean;
  previousPage?: PageSpec;
  onPageChange: (pageId: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * Single-row scrolling page navigation + hover edge flip buttons + the cross-page
 * transition placeholder. Purely presentational; state lives in App /
 * usePageViewState.
 */
export function PageStack({
  pages,
  activePageId,
  visitedPages,
  canPrev,
  canNext,
  previousPage,
  onPageChange,
  onPrev,
  onNext,
}: PageStackProps) {
  const stackRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const revealActivePage = () => {
      const active = stack.querySelector<HTMLElement>("[aria-current=page]");
      if (!active) return;
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < stack.scrollLeft) stack.scrollLeft = left;
      else if (right > stack.scrollLeft + stack.clientWidth)
        stack.scrollLeft = right - stack.clientWidth;
    };
    revealActivePage();
    const observer = new ResizeObserver(revealActivePage);
    observer.observe(stack);
    return () => observer.disconnect();
  }, [activePageId, pages]);
  const hasMultiplePages = pages.length > 1;
  const activePageIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === activePageId),
  );
  return (
    <>
      {previousPage && (
        <div
          className="david-previous-page-card"
          aria-hidden="true"
          inert
          dangerouslySetInnerHTML={{ __html: previousPage.pageHtml }}
        />
      )}
      {hasMultiplePages && (
        <nav ref={stackRef} className="page-stack" aria-label="页面">
          {pages.map((page, index) => {
            const active = page.id === activePageId;
            const adjacent = Math.abs(index - activePageIndex) === 1;
            const visited = visitedPages?.has(page.id) ?? active;
            return (
              <button
                key={page.id}
                type="button"
                className={`page-stack-item ${active ? "is-active" : ""} ${
                  adjacent ? "is-adjacent" : ""
                } ${visited ? "is-visited" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onPageChange(page.id)}
              >
                <span className="page-stack-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="page-stack-label">{page.label}</span>
                {active && <span className="page-stack-badge">当前</span>}
              </button>
            );
          })}
        </nav>
      )}
      {hasMultiplePages && canPrev && (
        <button
          type="button"
          className="page-flip-btn is-prev"
          aria-label="上一页"
          onClick={onPrev}
        >
          ‹
        </button>
      )}
      {hasMultiplePages && canNext && (
        <button
          type="button"
          className="page-flip-btn is-next"
          aria-label="下一页"
          onClick={onNext}
        >
          ›
        </button>
      )}
    </>
  );
}
