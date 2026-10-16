/** Literal tokens keep authored semantic colors separate from code annotations. */
export type CodeHighlightRule = {
  kind: string;
  label: string;
  tone:
    "violet" | "blue" | "green" | "amber" | "rose" | "cyan" | "lime" | "coral";
  tokens: string[];
  match?: "literal" | "identifier";
  legend?: boolean;
};
export type CodeHighlightPart = { text: string; rule?: CodeHighlightRule };
export function isValidCodeHighlights(
  value: unknown,
): value is CodeHighlightRule[] {
  if (!Array.isArray(value) || value.length > 128) return false;
  const kinds = new Set<string>();
  return value.every((r) => {
    if (
      !r ||
      typeof r !== "object" ||
      typeof r.kind !== "string" ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(r.kind) ||
      kinds.has(r.kind) ||
      typeof r.label !== "string" ||
      !r.label.trim() ||
      r.label.length > 40 ||
      ![
        "violet",
        "blue",
        "green",
        "amber",
        "rose",
        "cyan",
        "lime",
        "coral",
      ].includes(r.tone) ||
      (r.match !== undefined && !["literal", "identifier"].includes(r.match)) ||
      (r.legend !== undefined && typeof r.legend !== "boolean") ||
      !Array.isArray(r.tokens) ||
      !r.tokens.length ||
      r.tokens.length > 24 ||
      r.tokens.some(
        (t: unknown) =>
          typeof t !== "string" ||
          !t.trim() ||
          t.length > 160 ||
          /[\r\n]/.test(t),
      )
    )
      return false;
    kinds.add(r.kind);
    return true;
  });
}
/** Earliest match wins; overlapping matches at the same offset prefer the longest token. */
export function highlightCode(
  text: string,
  rules: readonly CodeHighlightRule[],
): CodeHighlightPart[] {
  const out: CodeHighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let found:
      { index: number; token: string; rule: CodeHighlightRule } | undefined;
    for (const rule of rules)
      for (const token of rule.tokens) {
        if (!token) continue;
        let index = text.indexOf(token, cursor);
        // Complete identifiers only: Input must not color InputConfig or _Input.
        while (
          index >= 0 &&
          rule.match === "identifier" &&
          (/[\p{L}\p{N}_$]/u.test(text[index - 1] ?? "") ||
            /[\p{L}\p{N}_$]/u.test(text[index + token.length] ?? ""))
        )
          index = text.indexOf(token, index + token.length);
        if (
          index >= 0 &&
          (!found ||
            index < found.index ||
            (index === found.index && token.length > found.token.length))
        )
          found = { index, token, rule };
      }
    if (!found) {
      out.push({ text: text.slice(cursor) });
      break;
    }
    if (found.index > cursor)
      out.push({ text: text.slice(cursor, found.index) });
    out.push({ text: found.token, rule: found.rule });
    cursor = found.index + found.token.length;
  }
  return out;
}
