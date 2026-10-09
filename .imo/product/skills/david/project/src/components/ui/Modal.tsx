import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./ui.css";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Centered modal dialog rendered through a body portal.
 * - Closes on backdrop click and Escape.
 * - Moves focus into the dialog on open and restores the previous focus on
 *   close; Tab is trapped inside while open.
 * - `wide` enlarges the panel for dense content.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  wide = false,
  nonModal = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  wide?: boolean;
  /** Floating supporting panel: comments/capture remain interactive above it. */
  nonModal?: boolean;
  children: ReactNode;
}): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    const focusables =
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables?.[0]?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        nonModal &&
        (document.body.classList.contains("david-gc-mode") ||
          document.querySelector('[data-testid="david-feedback-panel"]') ||
          !panelRef.current?.contains(document.activeElement))
      )
        return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (nonModal || event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(
        (element) =>
          element.offsetParent !== null || element === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, [open, onClose, nonModal]);

  if (!open) return null;

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return createPortal(
    <div
      className={`dv-ui-modal-backdrop${nonModal ? " dv-ui-panel-host" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`dv-ui-modal${wide ? " dv-ui-modal--wide" : ""}`}
        role="dialog"
        aria-modal={nonModal ? undefined : true}
        aria-labelledby={labelledBy}
        onKeyDown={handlePanelKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
