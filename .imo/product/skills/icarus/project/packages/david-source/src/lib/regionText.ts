/** Framework-free viewport text capture. No selection/DOM mutation or form values. */
export type RegionText = { text: string; truncated: boolean };
export type ViewRect = { x: number; y: number; width: number; height: number };
export const REGION_TEXT_MAX = 20000;
const PROBE_MAX = 100000;
const NODE_MAX = 20000;
const IGNORE =
  "script, style, noscript, template, input, textarea, select, [data-david-global-capture], [data-icarus-ui], [data-review-text-ignore]";

/** Include graphemes whose visible Range box intersects the rectangle.
 * DOM reading order, with line/gap separators; ordinary clipping and foreground
 * occlusion are checked per glyph. Canvas, pseudo text, frames and shadow trees
 * need a surface adapter; this is deliberately not OCR.
 */
export function collectRegionText(
  rect: ViewRect,
  root: HTMLElement = document.body,
  onElement?: (element: Element) => void,
): RegionText {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const left = Math.max(0, Math.min(rect.x, rect.x + rect.width));
  const right = Math.min(win.innerWidth, Math.max(rect.x, rect.x + rect.width));
  const top = Math.max(0, Math.min(rect.y, rect.y + rect.height));
  const bottom = Math.min(
    win.innerHeight,
    Math.max(rect.y, rect.y + rect.height),
  );
  let text = "";
  let truncated = false;
  let probes = 0;
  let nodes = 0;
  let previous: DOMRect | undefined;
  const range = doc.createRange();
  const intersects = (r: DOMRect) =>
    r.width > 0 &&
    r.height > 0 &&
    r.right > left &&
    r.left < right &&
    r.bottom > top &&
    r.top < bottom;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  if (left >= right || top >= bottom) return { text, truncated };

  outer: for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (++nodes > NODE_MAX) {
      truncated = true;
      break;
    }
    const node = n as Text;
    const element = node.parentElement;
    if (!element || !node.data.trim() || element.closest(IGNORE)) continue;
    let usable = true;
    const clip = { left, right, top, bottom };
    const pointerThrough =
      win.getComputedStyle(element).pointerEvents === "none";
    for (
      let ancestor: Element | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = win.getComputedStyle(ancestor);
      if (
        ancestor.hasAttribute("hidden") ||
        ancestor.hasAttribute("inert") ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number(style.opacity) === 0
      ) {
        usable = false;
        break;
      }
      const bounds = ancestor.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left);
        clip.right = Math.min(clip.right, bounds.right);
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top);
        clip.bottom = Math.min(clip.bottom, bounds.bottom);
      }
    }
    if (!usable) continue;
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some(intersects)) continue;
    let reported = false;
    let lastBlock = -1;
    let blockVisible = false;
    for (const { segment, index } of segmenter.segment(node.data)) {
      if (++probes > PROBE_MAX) {
        truncated = true;
        break outer;
      }
      // Skip offscreen spans in large single text nodes before per-glyph hits.
      const block = Math.floor(index / 128);
      if (block !== lastBlock) {
        lastBlock = block;
        range.setStart(node, block * 128);
        range.setEnd(node, Math.min(node.length, (block + 1) * 128 + 2));
        blockVisible = [...range.getClientRects()].some(intersects);
      }
      if (!blockVisible) continue;
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const box = [...range.getClientRects()].find((r) => {
        if (
          !intersects(r) ||
          r.right <= clip.left ||
          r.left >= clip.right ||
          r.bottom <= clip.top ||
          r.top >= clip.bottom ||
          clip.left >= clip.right ||
          clip.top >= clip.bottom
        )
          return false;
        const x =
          (Math.max(clip.left, r.left) + Math.min(clip.right, r.right)) / 2;
        const y =
          (Math.max(clip.top, r.top) + Math.min(clip.bottom, r.bottom)) / 2;
        const foreground = doc
          .elementsFromPoint(x, y)
          .find(
            (hit) =>
              !hit.closest("[data-david-global-capture], [data-icarus-ui]"),
          );
        // An ancestor may receive hits when the text has pointer-events:none.
        return Boolean(
          foreground &&
          (element === foreground ||
            (pointerThrough && foreground.contains(element))),
        );
      });
      if (!box) continue;
      const separator =
        previous &&
        Math.abs(box.top - previous.top) >
          Math.min(box.height, previous.height) / 2
          ? "\n"
          : previous && box.left - previous.right > 2
            ? " "
            : "";
      const addition = separator + segment;
      if (text.length + addition.length > REGION_TEXT_MAX) {
        truncated = true;
        break outer;
      }
      text += addition;
      previous = box;
      if (!reported) {
        onElement?.(element);
        reported = true;
      }
    }
  }
  return {
    text: text
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim(),
    truncated,
  };
}
