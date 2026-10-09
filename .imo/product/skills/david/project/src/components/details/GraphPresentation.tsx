import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GraphPresentationContext } from "./graphPresentationContext";

/** Relocate the existing graph, preserving row ancestry and React callbacks. */
export function GraphPresentation({
  children,
  title,
  target,
}: {
  children: ReactNode;
  title?: ReactNode;
  target?: string;
}) {
  const host = useContext(GraphPresentationContext);
  if (!host) return children;
  return createPortal(
    <section className="rich-detail-graph-entry" data-review-target={target}>
      {title && <h4 className="trd-sub-title">{title}</h4>}
      {children}
    </section>,
    host,
  );
}
