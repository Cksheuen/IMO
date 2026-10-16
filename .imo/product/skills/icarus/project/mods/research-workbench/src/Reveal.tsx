import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motionDuration } from "@david/lib/flip";
const EnteringParent = createContext(false);
/** Retain exiting children; one measured-height transition owns each new subtree. */
export function Reveal({
  open = true,
  children,
}: {
  open?: boolean;
  children: ReactNode;
}) {
  const parentEntering = useContext(EnteringParent);
  const [present, setPresent] = useState(open);
  const [settled, setSettled] = useState(!open);
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const previous = useRef<{ element: HTMLElement; open: boolean } | null>(null);
  // Mount before paint. During exit the original subtree survives until height reaches zero.
  if (open && !present) {
    setPresent(true);
    setSettled(false);
  }
  useLayoutEffect(() => {
    const el = frame.current,
      content = inner.current;
    if (
      !el ||
      !content ||
      (previous.current?.element === el && previous.current.open === open)
    )
      return;
    const fresh = previous.current?.element !== el;
    previous.current = { element: el, open };
    const from = fresh ? 0 : el.getBoundingClientRect().height;
    let animation: Animation | undefined;
    let disposed = false;
    let complete = false;
    const done = () => {
      if (disposed) return;
      complete = true;
      if (open) {
        el.style.removeProperty("height");
        el.style.removeProperty("overflow");
      } else {
        // Keep the final zero-height frame until React commits the unmount.
        el.style.height = "0px";
      }
      el.dataset.revealState = open ? "open" : "closed";
      animation?.cancel();
      setSettled(true);
      if (!open) setPresent(false);
    };
    const duration = parentEntering ? 0 : motionDuration(380);
    if (!duration) {
      done();
      return;
    }
    el.dataset.revealState = open ? "entering" : "exiting";
    el.style.overflow = "clip";
    let target = open ? content.getBoundingClientRect().height : 0;
    const animate = (start: number, ms: number) => {
      el.style.height = `${start}px`;
      animation = el.animate(
        [{ height: `${start}px` }, { height: `${target}px` }],
        {
          duration: ms,
          easing: "cubic-bezier(.22,.8,.24,1)",
          fill: "both",
        },
      );
      animation.onfinish = done;
    };
    animate(from, duration);
    const resize = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height;
      if (
        complete ||
        !open ||
        !animation ||
        animation.playState === "finished" ||
        Math.abs(next - target) < 1
      )
        return;
      const height = el.getBoundingClientRect().height;
      const remaining = Math.max(
        60,
        Number(animation.effect!.getTiming().duration) -
          Number(animation.currentTime ?? 0),
      );
      animation.cancel();
      target = next;
      animate(height, remaining);
    });
    resize.observe(content);
    return () => {
      disposed = true;
      resize.disconnect();
      // Interrupted close/open starts from the displayed height, never from zero or full height.
      el.style.height = `${el.getBoundingClientRect().height}px`;
      animation?.cancel();
    };
  }, [open, present, parentEntering]);
  if (!present) return null;
  return (
    <EnteringParent.Provider value={parentEntering || !settled}>
      <div
        ref={frame}
        className="research-reveal"
        inert={!open}
        aria-hidden={!open}
      >
        <div ref={inner} className="research-reveal-inner">
          {children}
        </div>
      </div>
    </EnteringParent.Provider>
  );
}
