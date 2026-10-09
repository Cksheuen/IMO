import { scrollAndPulse } from "./pulseHighlight";

export function findMappingTargets(
  scope: ParentNode | null | undefined,
  token: string,
): HTMLElement[] {
  const matches = Array.from(
    scope?.querySelectorAll<HTMLElement>(
      `[data-review-mapping-id~="${CSS.escape(token)}"]`,
    ) ?? [],
  );
  return matches.filter(
    (el) => !matches.some((other) => other !== el && el.contains(other)),
  );
}

let cleanup: (() => void) | undefined;
export function highlightMapping(componentId: string, rowId: string): void {
  document
    .querySelectorAll(".david-mapping-selected")
    .forEach((el) => el.classList.remove("david-mapping-selected"));
  const scope =
    document.querySelector(".component-dock.is-visible") ??
    document.querySelector(".page-frame");
  const targets = findMappingTargets(scope, `${componentId}:${rowId}`);
  const fallback = scope?.querySelector<HTMLElement>(
    `[data-component-id="${CSS.escape(componentId)}"]`,
  );
  if (!targets.length && fallback) targets.push(fallback);
  targets.forEach((el) => el.classList.add("david-mapping-selected"));
  cleanup?.();
  cleanup = targets[0] ? scrollAndPulse(targets[0]) : undefined;
}
