export const MATERIAL_IMAGE_LIMIT = 8 * 1024 * 1024;
export const MATERIAL_CSS_LIMIT = 1024 * 1024;
export type MaterialGroup = { id: string; label: string; pageId?: string };
export type ReviewMaterial = {
  id: string;
  groupId: string;
  title: string;
  kind: "png" | "css";
  sourceRef?: string;
  fileName: string;
  bytes: number;
  sha256: string;
  createdAt: string;
};
export type MaterialDocument = {
  schema: "david-materials/v1";
  slug: string;
  version: number;
  groups: MaterialGroup[];
  items: ReviewMaterial[];
};
export type MaterialInput = {
  id: string;
  group: MaterialGroup;
  title: string;
  kind: "png" | "css";
  content: string;
  sourceRef?: string;
};
export const materialToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number, empty = false): v is string =>
  typeof v === "string" && v.length <= max && (empty || v.trim().length > 0);
export function assertMaterialGroup(
  value: unknown,
): asserts value is MaterialGroup {
  if (
    !record(value) ||
    !materialToken(value.id) ||
    !text(value.label, 160) ||
    (value.pageId !== undefined && !text(value.pageId, 128)) ||
    Object.keys(value).some((k) => !["id", "label", "pageId"].includes(k))
  )
    throw new Error("资料分组格式无效");
}
export function assertMaterialInput(
  value: unknown,
): asserts value is MaterialInput {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value.id) ||
    !text(value.title, 160) ||
    !["png", "css"].includes(String(value.kind)) ||
    !text(value.content, 12 * 1024 * 1024) ||
    (value.sourceRef !== undefined && !text(value.sourceRef, 2048)) ||
    Object.keys(value).some(
      (k) =>
        !["id", "group", "title", "kind", "content", "sourceRef"].includes(k),
    )
  )
    throw new Error("设计资料格式无效，仅支持 PNG 或 CSS");
  assertMaterialGroup(value.group);
}
export function parseMaterialDocument(value: unknown): MaterialDocument {
  if (
    !record(value) ||
    value.schema !== "david-materials/v1" ||
    !materialToken(value.slug) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 0 ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.items) ||
    value.groups.length > 100 ||
    value.items.length > 200
  )
    throw new Error("设计资料索引格式无效");
  const ids = new Set<string>();
  for (const group of value.groups) {
    assertMaterialGroup(group);
    if (ids.has(group.id)) throw new Error("资料分组 id 重复");
    ids.add(group.id);
  }
  const itemIds = new Set<string>();
  for (const item of value.items) {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(item.id) ||
      itemIds.has(item.id) ||
      !ids.has(String(item.groupId)) ||
      !text(item.title, 160) ||
      !["png", "css"].includes(String(item.kind)) ||
      item.fileName !== `${item.id}.${item.kind}` ||
      !Number.isSafeInteger(item.bytes) ||
      Number(item.bytes) < 1 ||
      Number(item.bytes) >
        (item.kind === "png" ? MATERIAL_IMAGE_LIMIT : MATERIAL_CSS_LIMIT) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !text(item.createdAt, 64) ||
      (item.sourceRef !== undefined && !text(item.sourceRef, 2048))
    )
      throw new Error("设计资料条目格式无效");
    itemIds.add(item.id);
  }
  return value as MaterialDocument;
}
