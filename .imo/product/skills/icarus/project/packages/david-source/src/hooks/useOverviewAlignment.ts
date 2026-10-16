import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ReviewData } from "../types/review";
import "../styles/overview-alignment.css";

export function useOverviewAlignment(
  hostRef: RefObject<HTMLElement | null>,
  active: boolean,
  review: ReviewData,
) {
  const activeRef = useRef(active);
  const scheduleRef = useRef<() => void>(() => {});
  const savedStylesRef = useRef(
    new Map<HTMLElement, Map<string, { value: string; priority?: string }>>(),
  );
  const hadClassRef = useRef(false);

  useLayoutEffect(() => {
    activeRef.current = active;
    if (active) scheduleRef.current?.();
  }, [active]);

  useLayoutEffect(() => {
    const hostCandidate = hostRef.current;
    if (!hostCandidate || !review?.components?.length) return;
    const host: HTMLElement = hostCandidate;

    const stageCandidate = host.closest(".stage") as HTMLElement | null;
    if (!stageCandidate) return;
    const stage: HTMLElement = stageCandidate;

    const frameCandidate = stage.querySelector(
      ".page-frame",
    ) as HTMLElement | null;
    if (!frameCandidate) return;
    const frame: HTMLElement = frameCandidate;

    const marker = frame.querySelector(
      '[data-review-layout="aligned-components"]',
    ) as HTMLElement | null;
    if (!marker) return;

    const componentIds = review.components
      .map((c) => c.id)
      .filter(Boolean) as string[];
    const pairs = componentIds
      .map((id) => {
        const safeId = CSS.escape(id);
        return {
          group: host.querySelector(
            `tbody[data-component-id="${safeId}"]`,
          ) as HTMLElement | null,
          board: marker.querySelector(
            `:scope > [data-component-id="${safeId}"]`,
          ) as HTMLElement | null,
        };
      })
      .filter((p): p is { group: HTMLElement; board: HTMLElement } =>
        Boolean(p.group && p.board),
      );

    if (pairs.length === 0) return;

    const footer = marker.querySelector(
      "[data-review-overview-footer]",
    ) as HTMLElement | null;
    const saved = savedStylesRef.current;

    function saveStyle(
      el: HTMLElement,
      prop: string,
      value: string,
      priority?: string,
    ) {
      let elMap = saved.get(el);
      if (!elMap) {
        elMap = new Map();
        saved.set(el, elMap);
      }
      if (!elMap.has(prop)) {
        elMap.set(prop, { value, priority });
      }
    }

    function setStyle(
      el: HTMLElement,
      prop: string,
      value: string,
      priority?: string,
    ) {
      const currentValue = el.style.getPropertyValue(prop);
      const currentPriority = el.style.getPropertyPriority(prop);
      if (
        currentValue !== value ||
        (priority || "") !== (currentPriority || "")
      ) {
        saveStyle(el, prop, currentValue, currentPriority || undefined);
        el.style.setProperty(prop, value, priority);
      }
    }

    function restoreAll() {
      saved.forEach((props, el) => {
        props.forEach(({ value, priority }, prop) => {
          if (priority) el.style.setProperty(prop, value, priority);
          else el.style.setProperty(prop, value);
        });
      });
      saved.clear();
      if (hadClassRef.current) {
        stage.classList.remove("is-overview-aligned");
        hadClassRef.current = false;
      }
    }

    const media = window.matchMedia("(min-width: 1100px)");

    function isDesktop() {
      return media.matches;
    }

    function handleNarrow() {
      restoreAll();
    }

    let rafId = 0;
    function scheduleMeasure() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        measure();
      });
    }

    function measure() {
      if (!activeRef.current || !isDesktop()) return;

      if (!stage.classList.contains("is-overview-aligned")) {
        stage.classList.add("is-overview-aligned");
        hadClassRef.current = true;
      }

      // Set group heights to match board heights
      pairs.forEach(({ board, group }) => {
        const height = board.getBoundingClientRect().height;
        setStyle(group, "height", `${height}px`);
      });

      const frameRect = frame.getBoundingClientRect();

      let maxBoardBottom = 0;
      pairs.forEach(({ board, group }) => {
        const boardTop = group.getBoundingClientRect().top - frameRect.top;
        setStyle(board, "--review-board-top", `${boardTop}px`);
        const boardHeight = board.getBoundingClientRect().height;
        const bottom = boardTop + boardHeight;
        if (bottom > maxBoardBottom) maxBoardBottom = bottom;
      });

      if (footer) {
        const hostRect = host.getBoundingClientRect();
        const hostBottom = hostRect.bottom - frameRect.top;
        const footerTop = Math.max(hostBottom, maxBoardBottom) + 16;
        setStyle(footer, "--review-footer-top", `${footerTop}px`);
        const footerHeight = footer.getBoundingClientRect().height;
        const frameHeight = footerTop + footerHeight;
        setStyle(frame, "--review-aligned-height", `${frameHeight}px`);
      } else {
        const hostRect = host.getBoundingClientRect();
        const hostBottom = hostRect.bottom - frameRect.top;
        const frameHeight = Math.max(hostBottom, maxBoardBottom);
        setStyle(frame, "--review-aligned-height", `${frameHeight}px`);
      }
    }

    scheduleRef.current = measure;
    measure();

    const targets = [
      host,
      frame,
      marker,
      footer,
      ...pairs.flatMap((p) => [p.board, p.group]),
    ].filter(Boolean) as HTMLElement[];
    const observer = new ResizeObserver(() => {
      scheduleMeasure();
    });
    targets.forEach((t) => observer.observe(t));

    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        scheduleMeasure();
      } else {
        handleNarrow();
      }
    };
    media.addEventListener("change", handleMediaChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      media.removeEventListener("change", handleMediaChange);
      restoreAll();
      scheduleRef.current = () => {};
    };
  }, [hostRef, review]);
}
