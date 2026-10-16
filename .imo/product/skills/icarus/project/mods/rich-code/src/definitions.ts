/** Links are local to one source block; duplicates never silently choose a different definition. */
export type CodeDefinitions = Record<string, number>;
export function codeDefinitionLinks(
  code: string,
  symbols: readonly string[],
  explicit: CodeDefinitions = {},
) {
  const lines = code.split("\n").map((line) => line.replace(/^[+~] /, ""));
  // Mask comments and strings while retaining line numbers; quoted examples are not declarations.
  let blockComment = false,
    quote = "";
  const searchable = lines.map((line) => {
    let result = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i],
        next = line[i + 1];
      if (blockComment) {
        if (c === "*" && next === "/") {
          blockComment = false;
          i++;
        }
        result += " ";
        continue;
      }
      if (quote) {
        if (c === "\\" && quote !== "`") {
          i++;
          result += "  ";
          continue;
        }
        if (c === quote) quote = "";
        result += " ";
        continue;
      }
      if (c === "/" && next === "/") break;
      if (c === "/" && next === "*") {
        blockComment = true;
        i++;
        result += "  ";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        result += " ";
        continue;
      }
      result += c;
    }
    if (quote !== "`") quote = "";
    return result;
  });
  const candidates = new Map<string, number[]>();
  searchable.forEach((line, i) => {
    const match =
      /^\s*(?:export\s+)?(?:declare\s+)?(?:type|interface|class|enum|const|let|var|function)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u.exec(
        line,
      );
    if (match)
      candidates.set(match[1], [...(candidates.get(match[1]) ?? []), i + 1]);
  });
  const declared = new Map(
    [...candidates]
      .filter(([, positions]) => positions.length === 1)
      .map(([name, positions]) => [name, positions[0]]),
  );
  const fields = new Map<string, { line: number; label: string }[]>();
  searchable.forEach((line, i) => {
    const match =
      /^\s+([\p{L}_$][\p{L}\p{N}_$]*)\??(?:\s*:\s*|\s+)([^\n]+)/u.exec(line);
    if (!match || !symbols.includes(match[1]) || declared.has(match[1])) return;
    const expression = match[2].replace(/`.*$/, "").replace(/\/\/.*$/, "");
    const names = [
      ...new Set(expression.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []),
    ].filter((name) => declared.has(name));
    const type = names.length === 1 ? names[0] : undefined;
    const value = {
      line: type ? declared.get(type)! : i + 1,
      label: type ?? match[1],
    };
    fields.set(match[1], [...(fields.get(match[1]) ?? []), value]);
  });
  const links: Record<string, { line: number; label?: string }> =
    Object.create(null);
  for (const name of symbols) {
    if (declared.has(name))
      links[name] = { line: declared.get(name)!, label: name };
    else {
      const values = fields.get(name);
      if (values?.length && values.every((v) => v.line === values[0].line))
        links[name] = values[0];
    }
  }
  for (const [name, line] of Object.entries(explicit)) {
    if (
      !symbols.includes(name) ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      line > lines.length
    )
      throw Error("Invalid code definition: " + name);
    links[name] = { line, label: name };
  }
  return links;
}
