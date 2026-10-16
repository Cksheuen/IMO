/**
 * feedback 模块内部共用的小守卫（纯函数，不触碰 DOM）。
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const rejectUnknownKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${path} 包含未知或危险字段: ${key}`);
    }
  }
};
