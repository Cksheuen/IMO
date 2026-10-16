import type { AppearanceSelection } from "./globalSelection";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export function preferredSelection(
  selections: readonly AppearanceSelection[],
): AppearanceSelection | undefined {
  const score = (selection: AppearanceSelection) =>
    (selection.detail ? 8 : 0) +
    (selection.context?.mapping ? 4 : 0) +
    (selection.context?.anchorChain?.apiFields?.length ? 2 : 0);
  return selections.reduce<AppearanceSelection | undefined>(
    (best, item) => (!best || score(item) > score(best) ? item : best),
    undefined,
  );
}
/** Scope text matching to a known mapping column; only expand native disclosure ancestors of the hit. */
export function focusWithinSelection(
  root: HTMLElement,
  selection: AppearanceSelection,
): HTMLElement {
  const fields = selection.context?.anchorChain?.apiFields ?? [];
  for (const field of fields) {
    const hit = root.querySelector<HTMLElement>(
      `[data-contract-field="${CSS.escape(field)}"],[data-api-field~="${CSS.escape(field)}"]`,
    );
    if (hit) return reveal(hit, root);
  }
  const snippet = normalize(selection.context?.textSnippet ?? "");
  const heading = normalize(selection.context?.heading ?? "");
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      "button,summary,p,li,code,span,h4,h5,.trd-sub-title,.trd-tech-title",
    ),
  ]
    .filter((el) => {
      const text = normalize(el.textContent ?? "");
      return (
        text &&
        (text === snippet ||
          text === heading ||
          (el.matches("h4,h5") &&
            Boolean(heading || snippet) &&
            text.endsWith(heading || snippet)) ||
          (snippet.length >= 12 && text.startsWith(snippet)))
      );
    })
    .sort(
      (a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0),
    );
  return reveal(candidates[0] ?? root, root);
}
function reveal(target: HTMLElement, root: HTMLElement): HTMLElement {
  let ancestor: HTMLElement | null = target.parentElement;
  while (ancestor && root.contains(ancestor)) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  return target;
}
