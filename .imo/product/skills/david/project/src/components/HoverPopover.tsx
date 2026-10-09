import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import "../styles/hover-popover.css";

const POPUP_WIDTH = 300;
const GAP = 10;
const EDGE = 8;
const VIEW_PAD = 16;
const CLOSE_DELAY = 150;
const MAX_HEIGHT = 300;

export type HoverPopoverHandle = {
  scheduleClose: () => void;
  clearCloseTimer: () => void;
};

type HoverPopoverProps = {
  /** 是否显示浮层。定位与关闭生命周期由组件内部管理。 */
  open: boolean;
  /** 组件内部决定关闭（Escape / resize / scroll / 延迟到期）时回调。 */
  onClose: () => void;
  /** 锚点元素或其 getter，用于可见性检测与纵向定位。 */
  anchor: HTMLElement | (() => HTMLElement | null);
  /** 横向参照元素（浮层优先贴其左右弹出）。缺省时退化使用锚点。 */
  reference?: HTMLElement | (() => HTMLElement | null);
  children: ReactNode;
  /** 透传给浮层根节点的 id；缺省时组件内部生成。 */
  id?: string;
  /** 追加到浮层根节点的额外类名（默认已有 hover-popover）。 */
  className?: string;
  /** 浮层宽度上限，默认 300。 */
  width?: number;
  /** 浮层与参照物/锚点之间的间距，默认 10。 */
  gap?: number;
  /** 视口边缘安全边距，默认 8。 */
  edge?: number;
  /** 视口横向可用宽度的安全边距，默认 16。 */
  viewPad?: number;
  /** 离开后延迟关闭的毫秒数，默认 150。 */
  closeDelay?: number;
  /** 浮层 maxHeight 上限，默认 300。 */
  maxHeightCap?: number;
};

type PopupPos = { top: number; left: number; maxHeight: number };

function resolve(
  value: HTMLElement | (() => HTMLElement | null),
): HTMLElement | null {
  return typeof value === "function" ? value() : value;
}

export const HoverPopover = forwardRef<HoverPopoverHandle, HoverPopoverProps>(
  function HoverPopover(
    {
      open,
      onClose,
      anchor,
      reference,
      children,
      id,
      className,
      width = POPUP_WIDTH,
      gap = GAP,
      edge = EDGE,
      viewPad = VIEW_PAD,
      closeDelay = CLOSE_DELAY,
      maxHeightCap = MAX_HEIGHT,
    },
    ref,
  ) {
    const popupRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<number | undefined>(undefined);
    const portalId = useId();
    const [pos, setPos] = useState<PopupPos | null>(null);

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // 锚点 / 参照元素以最新引用解析一次，便于在 open 变化或锚点切换时重算。
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    useEffect(() => {
      setAnchorEl(resolve(anchor));
    }, [anchor]);

    const [referenceEl, setReferenceEl] = useState<HTMLElement | null>(null);
    useEffect(() => {
      setReferenceEl(reference ? resolve(reference) : null);
    }, [reference]);

    const clearCloseTimer = useCallback(() => {
      if (closeTimer.current !== undefined) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
    }, []);

    const scheduleClose = useCallback(() => {
      clearCloseTimer();
      closeTimer.current = window.setTimeout(
        () => onCloseRef.current(),
        closeDelay,
      );
    }, [clearCloseTimer, closeDelay]);

    useImperativeHandle(ref, () => ({ scheduleClose, clearCloseTimer }), [
      scheduleClose,
      clearCloseTimer,
    ]);

    // 定位：仅当 open 翻转或锚点/参照元素切换时重算一次。
    useEffect(() => {
      if (!open) {
        setPos(null);
        return;
      }
      const lineEl = anchorEl ?? referenceEl;
      const blockEl = referenceEl ?? lineEl;
      if (!lineEl || !blockEl) return;

      const line = lineEl.getBoundingClientRect();
      if (
        line.bottom < 0 ||
        line.top > window.innerHeight ||
        line.right < 0 ||
        line.left > window.innerWidth
      ) {
        onCloseRef.current();
        return;
      }

      const popupWidth = Math.min(width, window.innerWidth - viewPad);
      const block = blockEl.getBoundingClientRect();
      const roomRight = window.innerWidth - block.right - gap - edge;
      const roomLeft = block.left - gap - edge;
      const maxVertical = Math.max(0, window.innerHeight - edge * 2);

      let left: number;
      let top: number;
      let maxHeight: number;

      if (roomRight >= popupWidth) {
        left = block.right + gap;
        maxHeight = Math.min(maxHeightCap, maxVertical);
        top = Math.min(
          Math.max(line.top, edge),
          Math.max(edge, window.innerHeight - edge - maxHeight),
        );
      } else if (roomLeft >= popupWidth) {
        left = block.left - gap - popupWidth;
        maxHeight = Math.min(maxHeightCap, maxVertical);
        top = Math.min(
          Math.max(line.top, edge),
          Math.max(edge, window.innerHeight - edge - maxHeight),
        );
      } else {
        left = Math.min(
          Math.max(line.left, edge),
          Math.max(edge, window.innerWidth - popupWidth - edge),
        );
        const roomAbove = line.top - gap;
        const roomBelow = window.innerHeight - line.bottom - gap;

        if (roomBelow >= roomAbove) {
          top = line.bottom + gap;
          maxHeight = Math.min(
            maxHeightCap,
            Math.max(0, window.innerHeight - top - edge),
          );
        } else {
          maxHeight = Math.min(maxHeightCap, Math.max(0, roomAbove - edge));
          top = line.top - gap - maxHeight;
        }
      }

      setPos({ top, left, maxHeight });
    }, [open, anchorEl, referenceEl, width, gap, edge, viewPad, maxHeightCap]);

    // 关闭生命周期：Escape（capture + stopPropagation）、resize、document scroll。
    useEffect(() => {
      if (!open) return;

      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          clearCloseTimer();
          onCloseRef.current();
        }
      };
      const onResize = () => {
        clearCloseTimer();
        onCloseRef.current();
      };
      const onScroll = (e: Event) => {
        if (!(
          e.target instanceof Node && popupRef.current?.contains(e.target)
        )) {
          clearCloseTimer();
          onCloseRef.current();
        }
      };

      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", onResize);
      document.addEventListener("scroll", onScroll, true);
      return () => {
        clearCloseTimer();
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("scroll", onScroll, true);
      };
    }, [open, clearCloseTimer]);

    useEffect(() => clearCloseTimer, [clearCloseTimer]);

    return (
      open &&
      pos &&
      createPortal(
        <div
          id={id ?? portalId}
          ref={popupRef}
          className={["hover-popover", className].filter(Boolean).join(" ")}
          role="tooltip"
          style={{
            top: pos.top,
            left: pos.left,
            width: Math.min(width, window.innerWidth - viewPad),
            maxHeight: pos.maxHeight,
          }}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          {children}
        </div>,
        document.body,
      )
    );
  },
);

export type { HoverPopoverProps };
