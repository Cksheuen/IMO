const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isValidCodeAnnotations = (
  annotations: unknown,
  code: unknown,
): boolean => {
  if (!Array.isArray(annotations)) return false;
  const codeLineCount = typeof code === "string" ? code.split("\n").length : 0;
  let prevEnd = 0;
  for (const ann of annotations) {
    if (
      !isRecord(ann) ||
      typeof ann.startLine !== "number" ||
      typeof ann.endLine !== "number" ||
      typeof ann.title !== "string" ||
      !Number.isInteger(ann.startLine) ||
      !Number.isInteger(ann.endLine) ||
      ann.startLine < 1 ||
      ann.startLine > ann.endLine ||
      ann.endLine > codeLineCount ||
      ann.title.trim() === "" ||
      !Array.isArray(ann.bullets) ||
      ann.bullets.length === 0 ||
      ann.bullets.some((b) => typeof b !== "string" || b.trim() === "") ||
      ann.startLine <= prevEnd
    ) {
      return false;
    }
    prevEnd = ann.endLine;
  }
  return true;
};
