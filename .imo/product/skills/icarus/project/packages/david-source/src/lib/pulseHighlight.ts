import { supportsReducedMotion } from "./flip";

const PULSE_DURATION = 900;
const MAX_SCROLL_WAIT = 1800;
const STABLE_FRAMES = 3;

/**
 * Scroll first, then start the highlight after the target has visually settled.
 * This keeps a long smooth scroll (or a freshly committed FLIP clone) from
 * consuming the pulse while the target is still off-screen.
 */
export function scrollAndPulse(
  initialTarget: HTMLElement,
  resolveCurrentTarget: () => HTMLElement | null = () => initialTarget,
): () => void {
  let frame: number | undefined;
  let removeTimer: number | undefined;
  let cancelled = false;
  let stableFrames = 0;
  let previousTop: number | undefined;
  const startedAt = performance.now();
  const reducedMotion = supportsReducedMotion();
  let target = initialTarget;

  target.classList.remove("is-pulse-highlight");
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
  });

  const startPulse = () => {
    const currentTarget = resolveCurrentTarget();
    if (currentTarget) target = currentTarget;
    if (cancelled || !target.isConnected) return;
    // A frame boundary restarts the CSS animation without a forced synchronous reflow.
    target.classList.remove("is-pulse-highlight");
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      if (cancelled || !target.isConnected) return;
      target.classList.add("is-pulse-highlight");
      removeTimer = window.setTimeout(() => {
        removeTimer = undefined;
        target.classList.remove("is-pulse-highlight");
      }, PULSE_DURATION);
    });
  };

  const waitForSettle = () => {
    frame = undefined;
    const currentTarget = resolveCurrentTarget();
    if (currentTarget) target = currentTarget;
    if (cancelled) return;
    if (!target.isConnected) {
      if (performance.now() - startedAt < MAX_SCROLL_WAIT) {
        frame = window.requestAnimationFrame(waitForSettle);
      }
      return;
    }
    const rect = target.getBoundingClientRect();
    const moved =
      previousTop === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(rect.top - previousTop);
    const isVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    stableFrames = isVisible && moved < 0.5 ? stableFrames + 1 : 0;
    previousTop = rect.top;
    if (
      reducedMotion ||
      stableFrames >= STABLE_FRAMES ||
      performance.now() - startedAt >= MAX_SCROLL_WAIT
    ) {
      startPulse();
      return;
    }
    frame = window.requestAnimationFrame(waitForSettle);
  };

  frame = window.requestAnimationFrame(waitForSettle);
  return () => {
    cancelled = true;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    if (removeTimer !== undefined) window.clearTimeout(removeTimer);
    target.classList.remove("is-pulse-highlight");
  };
}
