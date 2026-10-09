import type { ReviewData } from "../types/review";
export type AuthoringFinding = { path: string; code: string; message: string };

/** Advisory authoring checks. Source/API existence still requires explicit evidence. */
export function auditReviewAuthoring(data: ReviewData): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  const flag = (path: string, code: string, message: string) =>
    findings.push({ path, code, message });
  const seen = new Set<object>();
  const visit = (value: unknown, path: string, key = "") => {
    if (key === "pageHtml" && typeof value === "string") {
      const copy = value
        .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<[^>]*>/g, " ");
      if (
        /(?:评审|预览).{0,8}(?:演示|示例)|(?:可定位|可交互)\s*HTML|开关操作不写入/.test(
          copy,
        )
      )
        flag(
          path,
          "preview-internal-copy",
          "业务预览只呈现产品界面；演示、渲染机制与接入说明放到对应设计或来源信息中。",
        );
      return;
    }
    if (key === "code" || key === "pseudoCode") return;
    if (typeof value === "string") {
      if (/[☐□]|＿{3,}|_{5,}/.test(value))
        flag(
          path,
          "fake-control",
          "待办或输入占位应迁移到 preparation 的真实控件。",
        );
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (
      typeof record.id === "string" &&
      typeof record.change === "string" &&
      record.change.length > 350
    )
      flag(
        `${path}.change`,
        "dense-summary",
        "长段落应缩为摘要，并用有序列表或代码注释承载细节。",
      );
    if (
      typeof record.pseudoCode === "string" &&
      Array.isArray(record.bullets) &&
      record.bullets.length
    )
      flag(
        path,
        "duplicate-code-explanation",
        "检查代码外 bullets：代码解读应归入行级 hover 注释。",
      );
    if (
      typeof record.name === "string" &&
      (record.type === "array" || record.type === "object")
    )
      flag(
        path,
        "vague-data-type",
        "使用明确的元素或对象类型，并列出必要子字段。",
      );
    const code = record.pseudoCode ?? record.code;
    if (
      typeof code === "string" &&
      code.split("\n").length >= 12 &&
      Array.isArray(record.codeAnnotations)
    ) {
      const annotations = record.codeAnnotations as Array<{
        startLine: number;
        endLine: number;
        bullets?: unknown[];
      }>;
      if (
        annotations.some(
          (a) =>
            a.endLine - a.startLine + 1 >= code.split("\n").length * 0.85 &&
            (a.bullets?.length ?? 0) > 1,
        )
      )
        flag(
          path,
          "broad-code-annotation",
          "整块代码包含多项说明；按实际校验、转换、调用与结果处理划分语义范围。",
        );
    }
    if (
      Array.isArray(record.techPoints) &&
      !record.codeFlow &&
      record.techPoints.filter((p) => p?.pseudoCode || p?.changeBlock).length >
        1
    )
      flag(
        path,
        "missing-code-flow",
        "多个独立代码块应明确调用/引用关系，用 codeFlow 选择下方代码；无关联时说明独立组合关系。",
      );
    Object.entries(record).forEach(([childKey, child]) =>
      visit(child, `${path}.${childKey}`, childKey),
    );
  };
  visit(data, "review");
  return findings;
}

/** Enumerate every mapping, including inline child mappings. This is an inventory,
 * not a semantic pass: callers must justify prose-only rows and inspect code bodies. */
export function inventoryImplementation(data: ReviewData) {
  const rows: Array<{
    path: string;
    id: string;
    codeBlocks: number;
    graphs: number;
  }> = [];
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    const object = value as Record<string, unknown>;
    if (
      typeof object.id === "string" &&
      typeof object.change === "string" &&
      typeof object.requirement === "string"
    ) {
      let codeBlocks = 0;
      let graphs = 0;
      const count = (v: unknown, key = "") => {
        if (
          typeof v === "string" &&
          ["pseudoCode", "code"].includes(key) &&
          v.trim()
        )
          codeBlocks++;
        else if (Array.isArray(v)) v.forEach((x) => count(x));
        else if (v && typeof v === "object")
          Object.entries(v).forEach(([k, x]) => {
            if (k === "graph" || k === "codeFlow") graphs++;
            else count(x, k);
          });
      };
      const trd = object.trd as Record<string, unknown> | undefined;
      count(trd?.technical);
      count(object.changeBlock);
      rows.push({ path, id: object.id, codeBlocks, graphs });
    }
    Object.entries(object).forEach(([key, v]) => {
      if (key !== "pageHtml") visit(v, `${path}.${key}`);
    });
  };
  visit(data, "review");
  return rows;
}
