import type { MappingRow, TrdColumnContent } from "../types/review";

export type DisclosureColumn = "requirement" | "change" | "api";

/** 浅层 API 列必须由作者给出简短摘要，不能从完整字段表反推。 */
export function hasOverviewApiSummary(row: MappingRow): boolean {
  return (
    row.api?.changed !== false && Boolean(row.overviewSummary?.api?.trim())
  );
}

export function columnContent(
  row: MappingRow,
  column: DisclosureColumn,
): TrdColumnContent | undefined {
  if (column === "requirement") return row.trd?.productDesign;
  if (column === "change") return row.trd?.technical;
  return row.trd?.apiChange;
}

export function legacySummary(
  row: MappingRow,
  column: DisclosureColumn,
): string {
  if (column === "requirement") return row.requirement;
  if (column === "change") return row.change;
  return row.api?.summary ?? "";
}

export function getDisclosureSummary(
  row: MappingRow,
  column: DisclosureColumn,
  level: "overview" | "component" | "node",
): string {
  if (level === "overview" && column === "api")
    return row.overviewSummary?.api ?? "";
  const content = columnContent(row, column);
  const overviewSummary =
    level === "overview" ? row.overviewSummary?.[column] : undefined;
  const summary =
    overviewSummary ?? content?.summary ?? legacySummary(row, column);
  return typeof summary === "string" ? summary : "";
}

export function normalizeDetailText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isExtraDetailValue(value: unknown, summaryText: string): boolean {
  if (Array.isArray(value))
    return value.some((item) => isExtraDetailValue(item, summaryText));
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 && normalizeDetailText(text) !== summaryText;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.total === "number") return record.total > 0;
    return Object.values(record).some((item) =>
      isExtraDetailValue(item, summaryText),
    );
  }
  return value !== null && value !== undefined && value !== false;
}

/**
 * 唯一的“是否有详情”判据：DisclosureCell 与 App 反馈定位共用。
 * 只有该列自身的增量内容才产生详情入口；codePaths 仅 change 列、
 * api.fields 仅 api 列；与显示摘要同文的字符串不算新增。
 */
export function hasDisclosureDetail(
  row: MappingRow,
  column: DisclosureColumn,
  level: "overview" | "component" | "node",
): boolean {
  if (column === "api" && row.api?.changed === false) return false;
  const summaryText = normalizeDetailText(
    getDisclosureSummary(row, column, level),
  );
  const content = columnContent(row, column);
  const detailSource = (content ?? {}) as Record<string, unknown>;
  const rowSource = row as Record<string, unknown>;
  const columnDetailKeys = [
    "sections",
    "points",
    "bullets",
    "code",
    "techPoints",
    "items",
    "fields",
    "modules",
    "pseudoCode",
    "positioning",
  ];
  return (
    isExtraDetailValue(content?.summary, summaryText) ||
    isExtraDetailValue(legacySummary(row, column), summaryText) ||
    columnDetailKeys.some((key) =>
      isExtraDetailValue(detailSource[key], summaryText),
    ) ||
    (column === "change" &&
      isExtraDetailValue(rowSource.codePaths, summaryText)) ||
    (column === "change" && Boolean(rowSource.changeBlock)) ||
    (column === "change" && Boolean(row.preparation)) ||
    (column === "api" &&
      isExtraDetailValue(
        (rowSource.api as Record<string, unknown> | undefined)?.fields,
        summaryText,
      ))
  );
}

/** Compact prose and small lists belong in the current surface; code/diagrams keep scoped details. */
export function shouldInlineDisclosure(
  row: MappingRow,
  column: DisclosureColumn,
  level: "overview" | "component" | "node" = "node",
): boolean {
  if (
    column === "api" ||
    (column === "change" && Boolean(row.preparation)) ||
    (column === "change" && (row.changeBlock || row.codePaths?.length))
  )
    return false;
  const content = columnContent(row, column);
  if (
    content?.pseudoCode ||
    content?.modules?.length ||
    content?.items?.length ||
    content?.fields?.length ||
    content?.techPoints?.some(
      (point) =>
        point.pseudoCode || point.changeBlock || point.preview || point.graph,
    )
  )
    return false;
  const texts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  };
  collect(content);
  collect(legacySummary(row, column));
  const unique = [...new Set(texts.filter(Boolean))];
  const maxItems = level === "overview" ? 3 : 12;
  const maxChars = level === "overview" ? 120 : 600;
  return unique.length <= maxItems && unique.join("").length <= maxChars;
}
