import { forwardRef } from "react";
import { HoverPopover, type HoverPopoverHandle } from "../HoverPopover";

type NodeHoverPopoverProps = {
  anchor: () => HTMLElement | null;
  label: string;
  hint: string;
  onClose: () => void;
};

/**
 * Canvas-page hover popover for logical review-tree nodes. The shell used to
 * be inline JSX in ReviewCanvas; it lives here so the canvas orchestrator only
 * supplies anchor/label/hint. DOM, class names and props are unchanged.
 */
export const NodeHoverPopover = forwardRef<
  HoverPopoverHandle,
  NodeHoverPopoverProps
>(function NodeHoverPopover({ anchor, label, hint, onClose }, ref) {
  return (
    <HoverPopover
      ref={ref}
      open
      anchor={anchor}
      onClose={onClose}
      width={240}
      maxHeightCap={180}
      className="canvas-node-popover"
    >
      <div className="canvas-node-popover-label">{label}</div>
      <div className="canvas-node-popover-hint">{hint}</div>
    </HoverPopover>
  );
});
