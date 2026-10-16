import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import "./ui.css";

/**
 * Square / compact icon-only action button. `label` is mandatory and doubles
 * as the accessible name. `pressed` maps to aria-pressed for toggle buttons.
 */
export function IconButton({
  label,
  onClick,
  disabled = false,
  pressed,
  expanded,
  controls,
  children,
}: {
  label: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Native buttons already activate on Enter/Space; stop propagation so
    // container-level keyboard shortcuts (e.g. Escape handling) stay intact.
    if (event.key === " " || event.key === "Enter") {
      event.stopPropagation();
    }
  };

  return (
    <button
      type="button"
      className="dv-ui-icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
    >
      {children}
    </button>
  );
}
