// Static HTML ranges only: never execute scripts, styles or load resources.
const voidTags = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(
    " ",
  ),
);
const decode = (value) =>
  value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (raw, entity) => {
    const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
    if (named[entity]) return named[entity];
    const n = entity.startsWith("#x")
      ? parseInt(entity.slice(2), 16)
      : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  });

export function htmlRanges(html) {
  const ranges = [];
  const stack = [];
  const tags =
    /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
  let match;
  while ((match = tags.exec(html))) {
    const token = match[0];
    if (token.startsWith("<!")) continue;
    const closing = token.startsWith("</");
    const tag = /^<\/?([\w:-]+)/.exec(token)?.[1].toLowerCase();
    if (closing) {
      const at = stack.findLastIndex((entry) => entry.tag === tag);
      if (at < 0) continue;
      for (const entry of stack.splice(at)) entry.end = tags.lastIndex;
      continue;
    }
    const attrs = {};
    const rest = token.replace(/^<[^\s/>]+/, "");
    for (const attr of rest.matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      attrs[attr[1].toLowerCase()] = decode(
        attr[2] ?? attr[3] ?? attr[4] ?? "",
      );
    }
    const entry = {
      tag,
      attrs,
      start: match.index,
      openEnd: tags.lastIndex,
      end: tags.lastIndex,
    };
    ranges.push(entry);
    if (["script", "style", "textarea", "title"].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "gi");
      close.lastIndex = tags.lastIndex;
      const end = close.exec(html);
      entry.contentEnd = end?.index ?? html.length;
      entry.end = end ? close.lastIndex : html.length;
      tags.lastIndex = entry.end;
    } else if (!voidTags.has(tag) && !token.endsWith("/>")) {
      stack.push(entry);
    }
  }
  for (const entry of stack) entry.end = html.length;
  return ranges;
}

export function embeddedJson(html, id, required = true) {
  const entries = htmlRanges(html).filter(
    (entry) =>
      entry.tag === "script" &&
      entry.attrs.id === id &&
      entry.attrs.type === "application/json",
  );
  if (!entries.length && !required) return null;
  if (entries.length !== 1)
    throw new Error(
      `Expected one application/json script#${id}; found ${entries.length}`,
    );
  const entry = entries[0];
  return JSON.parse(html.slice(entry.openEnd, entry.contentEnd));
}

export const hasAnchor = (html, attribute, token) =>
  htmlRanges(html).some((entry) =>
    (entry.attrs[attribute] ?? "").split(/\s+/).includes(token),
  );

export function previewFragments(page, anchors) {
  const html = page.pageHtml ?? "";
  const ranges = htmlRanges(html);
  const matched = ranges.filter((entry) =>
    anchors.some(({ attribute, token }) =>
      (entry.attrs[attribute] ?? "").split(/\s+/).includes(token),
    ),
  );
  // Do not repeat nested selections. Styles are evidence, not executable content.
  const roots = matched.filter(
    (entry) =>
      !matched.some(
        (other) =>
          other !== entry &&
          other.start < entry.start &&
          other.end >= entry.end,
      ),
  );
  return {
    pageId: page.id,
    fragments: roots.map((entry) => html.slice(entry.start, entry.end)),
    styles: ranges
      .filter((entry) => entry.tag === "style")
      .map((entry) => html.slice(entry.start, entry.end)),
    matched: roots.length,
  };
}

export function declaredActions(page, anchor) {
  const html = page.pageHtml ?? "";
  const ranges = htmlRanges(html);
  const roots = anchor
    ? ranges.filter((entry) =>
        (entry.attrs[anchor.attribute] ?? "")
          .split(/\s+/)
          .includes(anchor.token),
      )
    : [];
  return ranges
    .filter(
      (entry) =>
        !anchor ||
        roots.some(
          (root) => entry.start >= root.start && entry.end <= root.end,
        ),
    )
    .flatMap((entry) => {
      const actions = Object.fromEntries(
        Object.entries(entry.attrs).filter(([name]) =>
          [
            "data-review-page",
            "data-review-overlay",
            "data-review-overlay-close",
            "data-review-overlay-backdrop",
            "data-review-target",
            "data-review-node-id",
            "id",
          ].includes(name),
        ),
      );
      if (
        !Object.keys(actions).some(
          (name) =>
            name.startsWith("data-review-page") ||
            name.startsWith("data-review-overlay"),
        )
      )
        return [];
      return [{ pageId: page.id, ...actions }];
    });
}
