/** Native state is owned by the persistent source DOM; clones mirror it. */
const origins = new WeakMap<Element, Element>();

function copyControl(source: Element, target: Element): void {
  if (
    source instanceof HTMLInputElement &&
    target instanceof HTMLInputElement
  ) {
    if (source.type !== "file") target.value = source.value;
    target.checked = source.checked;
    target.indeterminate = source.indeterminate;
  } else if (
    source instanceof HTMLTextAreaElement &&
    target instanceof HTMLTextAreaElement
  ) {
    target.value = source.value;
  } else if (
    source instanceof HTMLSelectElement &&
    target instanceof HTMLSelectElement
  ) {
    Array.from(source.options).forEach((option, index) => {
      if (target.options[index])
        target.options[index].selected = option.selected;
    });
  } else if (
    source instanceof HTMLDetailsElement &&
    target instanceof HTMLDetailsElement
  ) {
    if (target.open !== source.open) target.open = source.open;
  }
}

export function bindNativeClone(source: HTMLElement, clone: HTMLElement): void {
  const sources = [source, ...source.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  sources.forEach((element, index) => {
    const copy = copies[index];
    if (!copy) return;
    origins.set(copy, origins.get(element) ?? element);
    copyControl(element, copy);
  });
}

/** Sync controls as a group: radio/select activation can change sibling state. */
export function syncNativeControls(
  surface: HTMLElement,
  dock: HTMLElement,
): void {
  const selector = "input, textarea, select, details";
  const elements = [surface, ...surface.querySelectorAll(selector)];
  if (surface === dock) {
    for (const element of elements) {
      const origin = origins.get(element);
      // An explicit drilldown details root is deliberately open only in dock.
      if (origin && !element.hasAttribute("data-david-drilldown-open"))
        copyControl(element, origin);
    }
  } else {
    for (const copy of dock.querySelectorAll(selector)) {
      const origin = origins.get(copy);
      if (
        origin &&
        surface.contains(origin) &&
        !copy.hasAttribute("data-david-drilldown-open")
      )
        copyControl(origin, copy);
    }
  }
}

/** Native keyboard activation emits its own click (including Space on keyup). */
export const isNativeActivation = (element: Element): boolean =>
  Boolean(
    element.closest(
      "button, input, textarea, select, summary, a[href], label, [contenteditable]",
    ),
  );
