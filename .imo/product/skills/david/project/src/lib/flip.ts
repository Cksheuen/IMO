/** Transform-based FLIP 动画工具。 */

export function captureRect(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect();
}

export function supportsReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 读取 :root 上的 --david-motion-scale（有限数，夹紧到 0..2，缺省 1），
 * 把基准时长换算成实际动画时长。
 * prefers-reduced-motion 或 scale 为 0 时返回 0，表示立即完成、不做动画。
 */
export function motionDuration(base: number): number {
  if (supportsReducedMotion()) return 0;
  const raw = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--david-motion-scale",
    ),
  );
  const scale = Number.isFinite(raw) ? Math.min(2, Math.max(0, raw)) : 1;
  if (scale === 0) return 0;
  return base * scale;
}

export type FlipPose = {
  top: number;
  left: number;
  /** 只允许统一缩放，禁止分别修改 X/Y 比例。 */
  scale: number;
};

export const applyFlipPose = (el: HTMLElement, pose: FlipPose) => {
  el.style.position = "fixed";
  el.style.top = `${pose.top}px`;
  el.style.left = `${pose.left}px`;
  el.style.right = "auto";
  el.style.transformOrigin = "top left";
  el.style.transform = `scale(${pose.scale})`;
};

/**
 * Transform-based FLIP：元素保持固定的基础宽高，只对位移和统一 scale 做动画。
 * 因为 X/Y 始终使用同一个 scale，组件在整个过程中不会被压扁或拉长。
 */
export function flipPosition(
  el: HTMLElement,
  from: FlipPose,
  to: FlipPose,
  duration: number,
): Animation | undefined {
  applyFlipPose(el, to);
  const scaledDuration = motionDuration(duration);
  if (scaledDuration === 0) return undefined;

  const dx = from.left - to.left;
  const dy = from.top - to.top;

  return el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${from.scale})` },
      { transform: `translate(0px, 0px) scale(${to.scale})` },
    ],
    {
      duration: scaledDuration,
      easing: "cubic-bezier(0.22, 0.8, 0.24, 1)",
    },
  );
}
