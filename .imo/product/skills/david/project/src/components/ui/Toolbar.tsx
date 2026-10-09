import type { ReactNode } from "react";
import "./ui.css";

/** Horizontal action container; wraps on narrow widths. */
export function Toolbar({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return <div className="dv-ui-toolbar">{children}</div>;
}

/** Visually grouped set of controls inside a Toolbar. */
export function ToolbarGroup({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return <div className="dv-ui-toolbar-group">{children}</div>;
}
