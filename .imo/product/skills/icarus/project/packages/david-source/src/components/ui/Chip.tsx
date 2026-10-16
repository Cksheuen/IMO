import type { ReactNode } from "react";
import "./ui.css";

export type ChipTone =
  "neutral" | "accent" | "gold" | "muted" | "danger" | "success";

/**
 * Compact pill label. `title` exposes the full value on hover / keyboard
 * focus for cases where the chip content is shortened visually.
 */
export function Chip({
  tone = "neutral",
  title,
  children,
}: {
  tone?: ChipTone;
  title?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className={`dv-ui-chip dv-ui-chip--${tone}`} title={title}>
      {children}
    </span>
  );
}
