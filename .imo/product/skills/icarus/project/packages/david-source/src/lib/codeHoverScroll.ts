import { useEffect, useLayoutEffect, useRef } from "react";

// One passive listener for every code pane, including synchronized diff panes.
// Recheck the actual hover only after scrolling settles; scroll itself never
// triggers tooltip measurement or repeated React renders.
const listeners = new Set<{ close: () => void; resume: () => void }>();
let scrolling = false;
let idleTimer: number | undefined;
const onScroll = (event: Event) => {
  // Readers may scroll a long tooltip without dismissing it.
  if (event.target instanceof Element && event.target.closest(".hover-popover"))
    return;
  if (!scrolling) {
    scrolling = true;
    listeners.forEach(({ close }) => close());
  }
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    scrolling = false;
    listeners.forEach(({ resume }) => resume());
  }, 180);
};

export function codeHoverIsIdle() {
  return !scrolling;
}

export function useCodeHoverScroll(close: () => void, resume: () => void) {
  const resumeRef = useRef(resume);
  useLayoutEffect(() => {
    resumeRef.current = resume;
  }, [resume]);
  useEffect(() => {
    if (!listeners.size) {
      document.addEventListener("scroll", onScroll, {
        capture: true,
        passive: true,
      });
      document.addEventListener("wheel", onScroll, {
        capture: true,
        passive: true,
      });
    }
    const listener = { close, resume: () => resumeRef.current() };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        document.removeEventListener("scroll", onScroll, true);
        document.removeEventListener("wheel", onScroll, true);
        window.clearTimeout(idleTimer);
        scrolling = false;
      }
    };
  }, [close]);
}
