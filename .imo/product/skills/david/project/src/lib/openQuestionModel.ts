import type { OpenQuestion } from "../types/review";

/**
 * 待澄清问题（openQuestions）运行时校验（reviewSpec 唯一数据源校验的一部分）。
 * 纯逻辑、无 React/DOM 依赖，可被 src/lib/reviewSpec.ts 与 node 测试脚本直接引用。
 * 风格对齐 changeModel.ts：validate* 返回 string[] 错误信息（空数组 = 合法），
 * assert* 供接线层使用；id 全局唯一在 assert 层保证。
 */

export const OPEN_QUESTION_STATUSES = ["open", "resolved"] as const;

export const MAX_OPEN_QUESTION_TOPIC_LENGTH = 120;
export const MAX_OPEN_QUESTION_LONGTEXT_LENGTH = 2000;
export const MAX_OPEN_QUESTION_REF_LENGTH = 400;
export const MAX_OPEN_QUESTION_OPTIONS = 8;
export const MAX_OPEN_QUESTION_OPTION_LENGTH = 400;
export const MAX_OPEN_QUESTION_RECOMMENDATION_LENGTH = 1000;

const OPEN_QUESTION_KEYS = new Set([
  "id",
  "topic",
  "status",
  "prd",
  "prdRef",
  "design",
  "designRef",
  "conflict",
  "options",
  "recommendation",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 校验可选长文本字段：缺省合法；提供时必须为非空白字符串且不超长。 */
const checkOptionalString = (
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
  errors: string[],
): void => {
  const content = value[key];
  if (content === undefined) return;
  if (typeof content !== "string" || content.trim() === "") {
    errors.push(`openQuestion.${key} 必须为非空字符串`);
    return;
  }
  if (content.length > maxLength) {
    errors.push(
      `openQuestion.${key} 长度不能超过 ${maxLength} 字符（当前 ${content.length}）`,
    );
  }
};

/**
 * 校验单条待澄清问题：
 * - 未知字段一律拒绝，避免作者拼错字段后静默丢失
 * - id / topic 必填且为非空白字符串；topic <= 120
 * - status 仅允许 open | resolved（缺省 open 由消费侧处理）
 * - prd/design/conflict <= 2000；prdRef/designRef <= 400
 * - options 最多 8 项，每项非空 <= 400；recommendation <= 1000
 */
export function validateOpenQuestion(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["openQuestion 必须是对象"];
  }
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!OPEN_QUESTION_KEYS.has(key)) {
      errors.push(`openQuestion.${key} 非法字段`);
    }
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push("openQuestion.id 必填且为非空字符串");
  }

  if (typeof value.topic !== "string" || value.topic.trim() === "") {
    errors.push("openQuestion.topic 必填且为非空字符串");
  } else if (value.topic.length > MAX_OPEN_QUESTION_TOPIC_LENGTH) {
    errors.push(
      `openQuestion.topic 长度不能超过 ${MAX_OPEN_QUESTION_TOPIC_LENGTH} 字符（当前 ${value.topic.length}）`,
    );
  }

  if (
    value.status !== undefined &&
    (typeof value.status !== "string" ||
      !OPEN_QUESTION_STATUSES.includes(value.status as never))
  ) {
    errors.push("openQuestion.status 必须为 open | resolved");
  }

  checkOptionalString(value, "prd", MAX_OPEN_QUESTION_LONGTEXT_LENGTH, errors);
  checkOptionalString(value, "prdRef", MAX_OPEN_QUESTION_REF_LENGTH, errors);
  checkOptionalString(
    value,
    "design",
    MAX_OPEN_QUESTION_LONGTEXT_LENGTH,
    errors,
  );
  checkOptionalString(value, "designRef", MAX_OPEN_QUESTION_REF_LENGTH, errors);
  checkOptionalString(
    value,
    "conflict",
    MAX_OPEN_QUESTION_LONGTEXT_LENGTH,
    errors,
  );
  checkOptionalString(
    value,
    "recommendation",
    MAX_OPEN_QUESTION_RECOMMENDATION_LENGTH,
    errors,
  );

  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) {
      errors.push("openQuestion.options 必须是字符串数组");
    } else {
      if (value.options.length > MAX_OPEN_QUESTION_OPTIONS) {
        errors.push(
          `openQuestion.options 最多 ${MAX_OPEN_QUESTION_OPTIONS} 项（当前 ${value.options.length}）`,
        );
      }
      value.options.forEach((option, index) => {
        if (typeof option !== "string" || option.trim() === "") {
          errors.push(`openQuestion.options[${index}] 必须为非空字符串`);
        } else if (option.length > MAX_OPEN_QUESTION_OPTION_LENGTH) {
          errors.push(
            `openQuestion.options[${index}] 长度不能超过 ${MAX_OPEN_QUESTION_OPTION_LENGTH} 字符（当前 ${option.length}）`,
          );
        }
      });
    }
  }

  return errors;
}

/** 类型守卫：运行时校验通过后可作为 OpenQuestion 使用。 */
export function isValidOpenQuestion(value: unknown): value is OpenQuestion {
  return validateOpenQuestion(value).length === 0;
}

/**
 * 断言式入口（供 reviewSpec 接入）：
 * - undefined 合法（字段整体可选，旧 JSON 零改动）
 * - 必须是数组；每条通过 validateOpenQuestion
 * - id 全局唯一
 * path 为调用方字段路径（如 "openQuestions"）。
 */
export function assertOpenQuestions(
  value: unknown,
  path: string,
): asserts value is OpenQuestion[] {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${path} 必须是数组`);
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const errors = validateOpenQuestion(item);
    if (errors.length > 0) {
      throw new Error(
        errors
          .map((message) => message.replace(/^openQuestion\b/, itemPath))
          .join("；"),
      );
    }
    const id = (item as OpenQuestion).id;
    if (ids.has(id)) {
      throw new Error(`${itemPath}.id 重复: ${id}`);
    }
    ids.add(id);
  });
}

export type { OpenQuestion };
