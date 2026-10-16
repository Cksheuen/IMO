import { isValidCodeAnnotations } from "./codeAnnotations.ts";
import type { ChangeBlock, ChangeKind, ChangeSide } from "../types/review";

/**
 * change block 运行时校验（reviewSpec 唯一数据源校验的一部分）。
 * 纯逻辑、无 React 依赖，可被 src/lib/reviewSpec.ts 与 node 测试脚本直接引用。
 * 风格对齐 reviewSpec.ts：返回 string[] 错误信息（空数组 = 合法），
 * 由调用方决定抛错路径前缀。
 */

export const CHANGE_KINDS: readonly ChangeKind[] = [
  "add",
  "modify",
  "migrate",
  "remove",
];

/** rationale 最长字符数（与 SKILL / schema 文档口径一致）。 */
export const MAX_CHANGE_RATIONALE_LENGTH = 800;

const BLOCK_KEYS = new Set(["kind", "rationale", "before", "after", "impact"]);
const SIDE_KEYS = new Set(["lang", "code", "text", "codeAnnotations"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * 校验单侧内容：对象；lang 可选非空字符串；code/text 必须且只能二选一，
 * 值为非空白字符串。返回错误信息数组（空数组 = 合法）。
 */
export function validateChangeSide(side: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!isRecord(side)) {
    errors.push(`${path} 必须是对象`);
    return errors;
  }
  for (const key of Object.keys(side)) {
    if (!SIDE_KEYS.has(key)) errors.push(`${path}.${key} 非法字段`);
  }
  if (
    side.lang !== undefined &&
    (typeof side.lang !== "string" || side.lang.trim() === "")
  ) {
    errors.push(`${path}.lang 必须为非空字符串`);
  }
  const hasCode = side.code !== undefined;
  const hasText = side.text !== undefined;
  if (hasCode && typeof side.code !== "string") {
    errors.push(`${path}.code 必须为字符串`);
  }
  if (hasText && typeof side.text !== "string") {
    errors.push(`${path}.text 必须为字符串`);
  }
  if (hasCode && hasText) {
    errors.push(`${path} 的 code 与 text 只能二选一，不能同时提供`);
  } else if (!hasCode && !hasText) {
    errors.push(`${path} 必须提供 code 或 text（二者选一）`);
  } else if (typeof (hasCode ? side.code : side.text) === "string") {
    const content = (hasCode ? side.code : side.text) as string;
    if (content.trim() === "") {
      errors.push(`${path}.${hasCode ? "code" : "text"} 不能为空`);
    }
  }
  if (
    side.codeAnnotations !== undefined &&
    (!hasCode || !isValidCodeAnnotations(side.codeAnnotations, side.code))
  ) {
    errors.push(`${path}.codeAnnotations 必须是有效且不重叠的代码行注释`);
  }
  return errors;
}

/**
 * 校验改动块的一致性规则：
 * - kind 必须为 add | modify | migrate | remove
 * - rationale 必填、非空白、<= 800 字符
 * - impact 可选，若提供必须为非空白字符串
 * - add：禁 before，必须 after
 * - remove：禁 after，必须 before
 * - modify/migrate：before 与 after 都必须提供
 * 未知顶层字段一律拒绝，避免作者拼错字段后静默丢失改动表达。
 */
export function validateChangeBlock(block: unknown): string[] {
  if (!isRecord(block)) {
    return ["changeBlock 必须是对象"];
  }
  const errors: string[] = [];
  for (const key of Object.keys(block)) {
    if (!BLOCK_KEYS.has(key)) {
      errors.push(`changeBlock.${key} 非法字段`);
    }
  }

  const kind: unknown = block.kind;
  const kindValid =
    typeof kind === "string" && CHANGE_KINDS.includes(kind as ChangeKind);
  if (!kindValid) {
    errors.push("changeBlock.kind 必须为 add | modify | migrate | remove");
  }

  if (typeof block.rationale !== "string" || block.rationale.trim() === "") {
    errors.push("changeBlock.rationale 必填且为非空字符串");
  } else if (block.rationale.length > MAX_CHANGE_RATIONALE_LENGTH) {
    errors.push(
      `changeBlock.rationale 长度不能超过 ${MAX_CHANGE_RATIONALE_LENGTH} 字符（当前 ${block.rationale.length}）`,
    );
  }

  if (
    block.impact !== undefined &&
    (typeof block.impact !== "string" || block.impact.trim() === "")
  ) {
    errors.push("changeBlock.impact 必须为非空字符串");
  }

  if (block.before !== undefined) {
    errors.push(...validateChangeSide(block.before, "changeBlock.before"));
  }
  if (block.after !== undefined) {
    errors.push(...validateChangeSide(block.after, "changeBlock.after"));
  }

  // 侧别一致性：kind 非法时无法判断侧别规则，跳过避免产生次生噪音。
  if (kindValid) {
    const k = kind as ChangeKind;
    if (k === "add") {
      if (block.before !== undefined) {
        errors.push(
          "changeBlock.kind=add 时禁止提供 before（新增内容无改动前）",
        );
      }
      if (block.after === undefined) {
        errors.push("changeBlock.kind=add 时必须提供 after");
      }
    } else if (k === "remove") {
      if (block.after !== undefined) {
        errors.push(
          "changeBlock.kind=remove 时禁止提供 after（删除内容无改动后）",
        );
      }
      if (block.before === undefined) {
        errors.push("changeBlock.kind=remove 时必须提供 before");
      }
    } else {
      if (block.before === undefined) {
        errors.push(`changeBlock.kind=${k} 时必须提供 before`);
      }
      if (block.after === undefined) {
        errors.push(`changeBlock.kind=${k} 时必须提供 after`);
      }
    }
  }

  return errors;
}

/** 类型守卫：运行时校验通过后可作为 ChangeBlock 使用。 */
export function isValidChangeBlock(block: unknown): block is ChangeBlock {
  return validateChangeBlock(block).length === 0;
}

/**
 * 断言式入口（供 reviewSpec 接入）：非法时按现有风格抛出，
 * path 为调用方所在字段路径（如 components[0].mapping[1].changeBlock）。
 */
export function assertChangeBlock(
  block: unknown,
  path: string,
): asserts block is ChangeBlock {
  const errors = validateChangeBlock(block);
  if (errors.length > 0) {
    throw new Error(`${path} 校验失败：${errors.join("；")}`);
  }
}

/** kind 中文徽标文案（ChangeRationale 等渲染层共用）。 */
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  add: "新增",
  modify: "改动",
  migrate: "迁移",
  remove: "删除",
};

export type { ChangeBlock, ChangeKind, ChangeSide };
