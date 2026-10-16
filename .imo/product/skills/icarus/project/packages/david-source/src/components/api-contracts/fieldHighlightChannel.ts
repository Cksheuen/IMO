import type { ApiField } from "../../types/review";
import { applyFieldHighlight } from "../../lib/domTargets";
import { scrollAndPulse } from "../../lib/pulseHighlight";

/**
 * Flat API contract field -> page highlight bridge.
 *
 * Deliberately reuses the existing field-highlight channel instead of
 * inventing a new one:
 * - token matching is delegated to applyFieldHighlight (same whitespace
 *   token rule on data-api-field as api.fields[].target exact mode);
 * - the persistent class is `.field-highlight`, applied on `.page-frame`
 *   and `.component-dock` exactly like the App-level field effect;
 * - click locate/scroll reuses scrollAndPulse from pulseHighlight.
 *
 * The only addition over applyFieldHighlight is the "smallest element"
 * rule required by the contract panel: when nested nodes carry the same
 * field token, only the innermost matches stay highlighted.
 */

export const CONTRACT_FIELD_PREVIEW_EVENT = "david-contract-field-preview";

export type ContractFieldPreviewDetail = {
  name: string | null;
  /** true only for the click-selected (sticky) field; false for hover. */
  pinned: boolean;
};

export const CONTRACT_FIELD_LOCATE_EVENT = "david-contract-field-locate";

const FRAME_SELECTOR = ".page-frame, .component-dock";

let pulseCleanup: (() => void) | undefined;
// Click-selected ("sticky") field: hover preview clears back to this name
// instead of leaving the page without the clicked highlight.
let stickyField: ApiField | null = null;
const subscribers = new Set<() => void>();
export const subscribeFieldSelection = (listener: () => void) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};
export const getSelectedFieldName = (): string | undefined => stickyField?.name;
export const clearSelectedField = (): void => {
  releaseContractFieldHighlight();
};

/** One delegated bridge for both live source and cloned page controls. */
export function installPageFieldBridge(): () => void {
  const fieldAt = (target: EventTarget | null) => {
    if (!(target instanceof Element) || !target.closest(FRAME_SELECTOR))
      return null;
    return (
      target
        .closest<HTMLElement>("[data-api-field]")
        ?.dataset.apiField?.split(/\s+/)[0] ?? null
    );
  };
  const preview = (event: Event) => {
    const name = fieldAt(event.target);
    if (name) previewContractField(name);
  };
  const leave = (event: Event) => {
    if (!fieldAt(event.target)) return;
    previewContractField(fieldAt((event as MouseEvent).relatedTarget));
  };
  const click = (event: Event) => {
    const name = fieldAt(event.target);
    if (name) toggleContractField(name);
  };
  const handlers: [string, (event: Event) => void][] = [
    ["pointerover", preview],
    ["pointerout", leave],
    ["focusin", preview],
    ["focusout", leave],
    ["click", click],
  ];
  handlers.forEach(([type, handler]) =>
    document.addEventListener(type, handler),
  );
  return () =>
    handlers.forEach(([type, handler]) =>
      document.removeEventListener(type, handler),
    );
}

function highlightFrames(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const dock = document.querySelector<HTMLElement>(
    ".component-dock.is-visible",
  );
  const frame = document.querySelector<HTMLElement>(".page-frame");
  return [dock, frame].filter((el): el is HTMLElement => Boolean(el));
}

function clearHighlights(frames: HTMLElement[]): void {
  frames.forEach((frame) =>
    frame
      .querySelectorAll(".field-highlight")
      .forEach((element) => element.classList.remove("field-highlight")),
  );
}

/**
 * Read-only token lookup for the smallest nodes carrying `name`.
 * Tokenization mirrors applyFieldHighlight's exact mode in domTargets
 * (data-api-field split on whitespace, exact token equality); nested
 * matches are reduced to the innermost elements. Also used as the
 * scrollAndPulse current-target resolver after a dock clone rebuild.
 */
export function findContractFieldTargets(name: string): HTMLElement[] {
  if (typeof document === "undefined" || !name) return [];
  const scopes = [
    document.querySelector<HTMLElement>(".page-frame"),
    document.querySelector<HTMLElement>(".component-dock"),
    document.body,
  ].filter((element): element is HTMLElement => Boolean(element));
  const seen = new Set<HTMLElement>();
  const matches: HTMLElement[] = [];
  for (const scope of scopes) {
    scope
      .querySelectorAll<HTMLElement>("[data-api-field]")
      .forEach((element) => {
        if (seen.has(element)) return;
        const tokens = (element.dataset.apiField || "").split(/\s+/);
        if (tokens.includes(name)) {
          seen.add(element);
          matches.push(element);
        }
      });
  }
  return matches.filter(
    (element) =>
      !matches.some((other) => other !== element && element.contains(other)),
  );
}

/**
 * Mark the smallest token-bearing elements through the existing
 * `.field-highlight` channel. applyFieldHighlight performs the token
 * matching (and clears previous highlights first); we then strip the
 * class from outer nodes that also contain an inner match.
 * Returns the minimal highlighted elements, in frame document order.
 */
function markMinimalHighlights(field: ApiField): HTMLElement[] {
  const frames = highlightFrames();
  const minimal: HTMLElement[] = [];
  frames.forEach((frame) => {
    const result = applyFieldHighlight(frame, field);
    if (result.count === 0) return;
    const marked = Array.from(
      frame.querySelectorAll<HTMLElement>(".field-highlight"),
    );
    const innermost = marked.filter(
      (element) =>
        !marked.some((other) => other !== element && element.contains(other)),
    );
    marked.forEach((element) => {
      if (!innermost.includes(element)) {
        element.classList.remove("field-highlight");
      }
    });
    minimal.push(...innermost);
  });
  return minimal;
}

export function publishContractFieldPreview(
  name: string | null,
  pinned = false,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ContractFieldPreviewDetail>(CONTRACT_FIELD_PREVIEW_EVENT, {
      detail: { name, pinned },
    }),
  );
}

/**
 * Current click-pinned field. Used by freshly mounted panel instances
 * (e.g. the rich-detail dialog opened after a field was pinned in the
 * inspector cell) to initialize their active row without waiting for the
 * next event.
 */
export function getStickyContractField(): string | null {
  return stickyField?.name ?? null;
}

/**
 * Hover/focus preview. Pass null to clear. Mirrors the highlight
 * lifecycle the App field effect owns for api.fields buttons.
 */
export function previewContractField(name: string | null): void {
  const frames = highlightFrames();
  if (!name) {
    // Restore the sticky click highlight when a hover preview ends.
    if (stickyField) {
      markMinimalHighlights(stickyField);
      publishContractFieldPreview(stickyField.name, true);
      return;
    }
    clearHighlights(frames);
    publishContractFieldPreview(null);
    return;
  }
  markMinimalHighlights({ name });
  publishContractFieldPreview(name);
}

/**
 * Release the sticky click highlight (toggle-off when the same contract
 * field is clicked again).
 */
export function releaseContractFieldHighlight(): void {
  stickyField = null;
  subscribers.forEach((listener) => listener());
  clearHighlights(highlightFrames());
  publishContractFieldPreview(null, true);
}

/**
 * Click: persistent highlight + the same scroll/pulse locate behavior
 * reused from pulseHighlight. Returns whether a page node was located.
 */
export function locateContractField(value: string | ApiField): boolean {
  const field = typeof value === "string" ? { name: value } : value;
  const name = field.name;
  if (!name) return false;
  stickyField = field;
  subscribers.forEach((listener) => listener());
  const targets = markMinimalHighlights(field);
  publishContractFieldPreview(name, true);
  const dock = document.querySelector<HTMLElement>(
    ".component-dock.is-visible",
  );
  const first = dock
    ? targets.find((target) => dock.contains(target))
    : targets[0];
  if (!first) {
    window.dispatchEvent(
      new CustomEvent(CONTRACT_FIELD_LOCATE_EVENT, { detail: field }),
    );
    return false;
  }
  pulseCleanup?.();
  pulseCleanup = scrollAndPulse(first, () => {
    const candidates = findContractFieldTargets(field.target ?? name);
    const marked = dock
      ? candidates.find((target) => dock.contains(target))
      : candidates[0];
    return marked ?? (first.isConnected ? first : null);
  });
  return true;
}

/**
 * Field-button click with toggle semantics (same behavior as the existing
 * api.fields button: clicking the active field again clears it).
 * Returns "located" | "marked" | "cleared". The panel only needs the
 * resulting pinned name via the preview event.
 */
export function toggleContractField(
  value: string | ApiField,
): "located" | "marked" | "cleared" {
  const name = typeof value === "string" ? value : value.name;
  if (!name) return "cleared";
  if (stickyField?.name === name) {
    releaseContractFieldHighlight();
    pulseCleanup?.();
    pulseCleanup = undefined;
    return "cleared";
  }
  return locateContractField(value) ? "located" : "marked";
}

/** Reapply the same selection after a dock clone or page render. */
export function refreshFieldHighlight(locate = false): void {
  if (locate && stickyField) {
    locateContractField(stickyField);
    return;
  }
  previewContractField(null);
}
