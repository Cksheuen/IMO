export type Preparation = {
  id: string;
  title: string;
  tasks: Array<{ id: string; label: string; detail?: string }>;
  fields: Array<{
    id: string;
    label: string;
    placeholder?: string;
    value?: string;
    required?: boolean;
  }>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const short = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 500;
export function assertPreparation(
  value: unknown,
  path: string,
): asserts value is Preparation {
  if (
    !record(value) ||
    !short(value.id) ||
    !short(value.title) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.fields) ||
    value.tasks.length + value.fields.length === 0 ||
    value.tasks.length + value.fields.length > 60
  )
    throw new Error(`${path} 必须包含 id/title/tasks/fields`);
  if (
    Object.keys(value).some(
      (key) => !["id", "title", "tasks", "fields"].includes(key),
    )
  )
    throw new Error(`${path} 存在未知字段`);
  const ids = new Set<string>();
  for (const [kind, items] of [
    ["tasks", value.tasks],
    ["fields", value.fields],
  ] as const) {
    for (const item of items) {
      const keys =
        kind === "tasks"
          ? ["id", "label", "detail"]
          : ["id", "label", "placeholder", "value", "required"];
      if (
        !record(item) ||
        typeof item.id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(item.id) ||
        ids.has(item.id) ||
        !short(item.label) ||
        Object.keys(item).some((key) => !keys.includes(key))
      )
        throw new Error(`${path}.${kind} 条目或 id 非法`);
      ids.add(item.id);
      for (const key of ["detail", "placeholder", "value"])
        if (
          item[key] !== undefined &&
          (typeof item[key] !== "string" || (item[key] as string).length > 1000)
        )
          throw new Error(`${path}.${kind}.${key} 必须为短字符串`);
      if (item.required !== undefined && typeof item.required !== "boolean")
        throw new Error(`${path}.${kind}.required 必须为布尔值`);
    }
  }
}
