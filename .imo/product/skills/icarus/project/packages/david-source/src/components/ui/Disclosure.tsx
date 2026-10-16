import type { ReactNode } from "react";
import "./ui.css";

/**
 * Styled native <details>/<summary> wrapper, collapsed by default.
 * Uses the native disclosure element so open/close state works without JS
 * and survives DOM cloning; only presentation is customized.
 */
export function Disclosure({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <details className="dv-ui-disclosure" open={defaultOpen || undefined}>
      <summary>
        <span className="dv-ui-disclosure-marker" aria-hidden="true">
          ▶
        </span>
        <span className="dv-ui-disclosure-summary">{summary}</span>
      </summary>
      <div className="dv-ui-disclosure-body">{children}</div>
    </details>
  );
}
