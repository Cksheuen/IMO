import type { ReviewComponent, ReviewNode } from "../types/review";

export const injectMappingIds = (
  markup: string,
  components: ReviewComponent[],
) => {
  const anchorToTokens = new Map<string, Set<string>>();
  const addToken = (anchor: string, token: string) => {
    if (!anchor || !token) return;
    if (!anchorToTokens.has(anchor)) anchorToTokens.set(anchor, new Set());
    anchorToTokens.get(anchor)!.add(token);
  };

  const visit = (node: ReviewNode, componentId: string) => {
    const anchor = node.target || node.id;
    if (Array.isArray(node.mappingIds)) {
      node.mappingIds.forEach((rowId) =>
        addToken(anchor, `${componentId}:${rowId}`),
      );
    } else if (Array.isArray(node.mapping)) {
      node.mapping.forEach((row) =>
        addToken(anchor, `${componentId}:${row.id}`),
      );
    }
    (node.children ?? []).forEach((child) => visit(child, componentId));
  };

  for (const component of components) {
    (component.children ?? []).forEach((child) => visit(child, component.id));
  }

  let injected = 0;
  let out = markup;
  for (const [anchor, tokens] of anchorToTokens) {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tagPattern = new RegExp(
      `(<[a-zA-Z][^>]*?data-review-node-id=["']${escaped}["'][^>]*?)(\\s*/?>)`,
      "g",
    );
    out = out.replace(tagPattern, (full, head, tail) => {
      const existing = head.match(/data-review-mapping-id=["']([^"']*)["']/);
      injected += 1;
      if (existing) {
        const merged = new Set([
          ...existing[1].split(/\s+/).filter(Boolean),
          ...tokens,
        ]);
        return `${head.replace(
          /data-review-mapping-id=["'][^"']*["']/,
          `data-review-mapping-id="${Array.from(merged).join(" ")}"`,
        )}${tail}`;
      }
      return `${head} data-review-mapping-id="${Array.from(tokens).join(" ")}"${tail}`;
    });
  }
  return { markup: out, injected };
};
