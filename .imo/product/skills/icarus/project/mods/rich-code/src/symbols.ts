import type { CodeHighlightRule } from "@david/lib/codeHighlights";
/** Append names to preserve existing palette assignments across related blocks. */
export const symbolPalette = [
  "green",
  "amber",
  "rose",
  "cyan",
  "lime",
  "coral",
] as const;
export function isValidCodeSymbols(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    new Set(value).size === value.length &&
    value.every(
      (v) =>
        typeof v === "string" &&
        v.length <= 80 &&
        /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(v),
    )
  );
}
export function symbolHighlights(symbols: string[]): CodeHighlightRule[] {
  if (!isValidCodeSymbols(symbols)) throw Error("Invalid code symbols");
  let color = 0;
  return symbols.map((name, i) => ({
    kind: `symbol-${i}`,
    label: name.slice(0, 40),
    tokens: [name],
    match: "identifier",
    legend: false,
    tone:
      name === "Input"
        ? "violet"
        : name === "Output"
          ? "blue"
          : symbolPalette[color++ % symbolPalette.length],
  }));
}
