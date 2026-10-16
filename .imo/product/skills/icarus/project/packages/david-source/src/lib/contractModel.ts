import type { ApiContract, ApiContractField } from "../types/review";

/**
 * 扁平 API 契约（apiContracts）运行时校验（reviewSpec 唯一数据源校验的一部分）。
 * 纯逻辑、无 React/DOM 依赖，可被 src/lib/reviewSpec.ts 与 node 测试脚本直接引用。
 * 风格对齐 changeModel.ts：validate* 返回 string[] 错误信息（空数组 = 合法），
 * assert* 供接线层使用；id 全局唯一在 assert 层保证；
 * mapping.api.contractIds 的跨引用命中由 assertContractIds 校验，
 * 已知 id 表由接线层（reviewSpec）传入。
 */

export const API_CONTRACT_STATUSES = ["proposed", "confirmed"] as const;

export const MAX_API_CONTRACT_FIELD_NAME_LENGTH = 120;
export const MAX_API_CONTRACT_FIELD_TYPE_LENGTH = 120;
export const MAX_API_CONTRACT_FIELD_MEANING_LENGTH = 400;
export const MAX_API_CONTRACT_TITLE_LENGTH = 160;
export const MAX_API_CONTRACT_ENDPOINT_LENGTH = 400;
export const MAX_API_CONTRACT_METHOD_LENGTH = 40;
export const MAX_API_CONTRACT_NOTES_LENGTH = 2000;

export const API_CONTRACT_PROVISIONS = [
  "backend-defined",
  "existing",
  "missing",
] as const;
export const API_CONTRACT_PROVISION_LABELS = {
  "backend-defined": "本次后端定义",
  existing: "已有协议",
  missing: "后端未提供",
} as const;

const FIELD_KEYS = new Set([
  "name",
  "type",
  "required",
  "meaning",
  "provision",
]);
const CONTRACT_KEYS = new Set([
  "id",
  "status",
  "provision",
  "title",
  "endpoint",
  "method",
  "request",
  "response",
  "notes",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * 校验单个契约字段：
 * - 未知字段拒绝
 * - name 必填非空白 <= 120；type 可选非空白 <= 120
 * - required 必须为布尔值；meaning 可选非空白 <= 400
 */
export function validateApiContractField(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["contractField 必须是对象"];
  }
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!FIELD_KEYS.has(key)) {
      errors.push(`contractField.${key} 非法字段`);
    }
  }

  if (
    value.provision !== undefined &&
    !API_CONTRACT_PROVISIONS.includes(value.provision as never)
  ) {
    errors.push(
      "contractField.provision 必须为 backend-defined | existing | missing",
    );
  }

  if (typeof value.name !== "string" || value.name.trim() === "") {
    errors.push("contractField.name 必填且为非空字符串");
  } else if (value.name.length > MAX_API_CONTRACT_FIELD_NAME_LENGTH) {
    errors.push(
      `contractField.name 长度不能超过 ${MAX_API_CONTRACT_FIELD_NAME_LENGTH} 字符（当前 ${value.name.length}）`,
    );
  }

  if (value.type !== undefined) {
    if (typeof value.type !== "string" || value.type.trim() === "") {
      errors.push("contractField.type 必须为非空字符串");
    } else if (value.type.length > MAX_API_CONTRACT_FIELD_TYPE_LENGTH) {
      errors.push(
        `contractField.type 长度不能超过 ${MAX_API_CONTRACT_FIELD_TYPE_LENGTH} 字符（当前 ${value.type.length}）`,
      );
    }
  }

  if (value.required !== undefined && typeof value.required !== "boolean") {
    errors.push("contractField.required 必须为布尔值");
  }

  if (value.meaning !== undefined) {
    if (typeof value.meaning !== "string" || value.meaning.trim() === "") {
      errors.push("contractField.meaning 必须为非空字符串");
    } else if (value.meaning.length > MAX_API_CONTRACT_FIELD_MEANING_LENGTH) {
      errors.push(
        `contractField.meaning 长度不能超过 ${MAX_API_CONTRACT_FIELD_MEANING_LENGTH} 字符（当前 ${value.meaning.length}）`,
      );
    }
  }

  return errors;
}

/** 校验字段列表（request/response）：必须是数组，逐项严格校验。 */
function validateFieldList(
  list: unknown,
  label: string,
  errors: string[],
): void {
  if (!Array.isArray(list)) {
    errors.push(`apiContract.${label} 必须是数组`);
    return;
  }
  list.forEach((field, index) => {
    for (const message of validateApiContractField(field)) {
      errors.push(
        message.replace(/^contractField\b/, `apiContract.${label}[${index}]`),
      );
    }
  });
}

/**
 * 校验单条扁平 API 契约：
 * - 未知字段拒绝
 * - id 必填非空白；status 必填且仅允许 proposed | confirmed
 * - title <= 160；endpoint <= 400；method <= 40（不强制枚举，兼容 RPC 方法名）
 * - request/response 必须是字段数组；notes <= 2000
 */
export function validateApiContract(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["apiContract 必须是对象"];
  }
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!CONTRACT_KEYS.has(key)) {
      errors.push(`apiContract.${key} 非法字段`);
    }
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push("apiContract.id 必填且为非空字符串");
  }

  if (
    typeof value.status !== "string" ||
    !API_CONTRACT_STATUSES.includes(value.status as never)
  ) {
    errors.push("apiContract.status 必须为 proposed | confirmed");
  }

  if (
    value.provision !== undefined &&
    !API_CONTRACT_PROVISIONS.includes(value.provision as never)
  ) {
    errors.push(
      "apiContract.provision 必须为 backend-defined | existing | missing",
    );
  }

  const optionalStringChecks: ReadonlyArray<readonly [string, number]> = [
    ["title", MAX_API_CONTRACT_TITLE_LENGTH],
    ["endpoint", MAX_API_CONTRACT_ENDPOINT_LENGTH],
    ["method", MAX_API_CONTRACT_METHOD_LENGTH],
    ["notes", MAX_API_CONTRACT_NOTES_LENGTH],
  ];
  for (const [key, maxLength] of optionalStringChecks) {
    const content = value[key];
    if (content === undefined) continue;
    if (typeof content !== "string" || content.trim() === "") {
      errors.push(`apiContract.${key} 必须为非空字符串`);
    } else if (content.length > maxLength) {
      errors.push(
        `apiContract.${key} 长度不能超过 ${maxLength} 字符（当前 ${content.length}）`,
      );
    }
  }

  if (value.request !== undefined) {
    validateFieldList(value.request, "request", errors);
  }
  if (value.response !== undefined) {
    validateFieldList(value.response, "response", errors);
  }

  return errors;
}

/** 类型守卫：运行时校验通过后可作为 ApiContract 使用。 */
export function isValidApiContract(value: unknown): value is ApiContract {
  return validateApiContract(value).length === 0;
}

/**
 * 断言式入口（供 reviewSpec 接入）：
 * - undefined 合法（字段整体可选，旧 JSON 零改动）
 * - 必须是数组；每条通过 validateApiContract
 * - id 全局唯一
 * path 为调用方字段路径（如 "apiContracts"）。
 */
export function assertApiContracts(
  value: unknown,
  path: string,
): asserts value is ApiContract[] {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${path} 必须是数组`);
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const errors = validateApiContract(item);
    if (errors.length > 0) {
      throw new Error(
        errors
          .map((message) => message.replace(/^apiContract\b/, itemPath))
          .join("；"),
      );
    }
    const id = (item as ApiContract).id;
    if (ids.has(id)) {
      throw new Error(`${itemPath}.id 重复: ${id}`);
    }
    ids.add(id);
  });
}

/**
 * 校验 mapping 行上的 contractIds 跨引用（在 mapping 遍历处调用）：
 * - undefined 合法；必须是非空字符串数组
 * - 不允许重复（严格风格：重复项直接拒绝，不静默去重）
 * - 每项必须命中接线层传入的顶层 apiContracts id 表
 */
export function assertContractIds(
  value: unknown,
  path: string,
  knownContractIds: Set<string>,
): asserts value is string[] {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${path} 必须是字符串数组`);
  }
  const seen = new Set<string>();
  value.forEach((id, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`${itemPath} 必须为非空字符串`);
    }
    if (seen.has(id)) {
      throw new Error(`${itemPath} 重复: ${id}`);
    }
    if (!knownContractIds.has(id)) {
      throw new Error(`${itemPath} 引用未知 apiContracts id: ${id}`);
    }
    seen.add(id);
  });
}

export type { ApiContract, ApiContractField };
