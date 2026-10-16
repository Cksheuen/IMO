import { useLayoutEffect, useState, type ReactNode } from "react";
import { motionDuration } from "../../lib/flip";

/** Keep exiting content until its size transition finishes, including reversal. */
export function CodeFlowDetail({
  active,
  id,
  children,
}: {
  active: boolean;
  id: string;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(active);
  const [expanded, setExpanded] = useState(active);
  const duration = motionDuration(240);
  if (!duration) {
    if (expanded !== active) setExpanded(active);
    if (present !== active) setPresent(active);
  } else if (active && !present) setPresent(true);
  useLayoutEffect(() => {
    if (!duration) return;
    // Two frames give a newly mounted body a collapsed starting layout.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setExpanded(active));
    });
    const timer = active
      ? undefined
      : window.setTimeout(() => setPresent(false), duration + 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [active, duration]);
  return (
    <div
      className="trd-code-flow-presence"
      data-expanded={expanded}
      style={{ transitionDuration: `${duration}ms` }}
      inert={!active}
      aria-hidden={!active}
    >
      <div className="trd-code-flow-clip">
        {present && (
          <div
            className="trd-code-flow-detail"
            data-active-code-id={active ? id : undefined}
            data-code-id={id}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
