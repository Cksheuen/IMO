import type { ReactNode } from "react";
import "./ui.css";

/** Keep descendants mounted so closing a feature preserves inputs and reading state. */
export function Collapsible({
  open,
  id,
  className = "",
  children,
}: {
  open: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={`dv-ui-collapse ${className}`}
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="dv-ui-collapse-inner">{children}</div>
    </div>
  );
}
