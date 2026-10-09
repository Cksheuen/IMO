import type { ApiField } from "../types/review";

export const prepareReviewTargets = (frame: HTMLElement) => {
  frame.querySelectorAll<HTMLElement>("*").forEach((element, index) => {
    if (element.tagName === "SCRIPT") return;
    element.dataset.autoReviewTarget ||= `auto:${index}`;
    element.dataset.reviewLabel ||=
      element.textContent?.replace(/\s+/g, " ").trim().slice(0, 42) ||
      element.tagName.toLowerCase();
  });
};

export const componentIdFromElement = (element: HTMLElement) =>
  element.closest<HTMLElement>("[data-component-id]")?.dataset.componentId;

export type FieldHighlightResult = {
  mode: "exact" | "target" | "none";
  count: number;
};

export const applyFieldHighlight = (
  frame: HTMLElement,
  field: ApiField,
): FieldHighlightResult => {
  frame
    .querySelectorAll(".field-highlight")
    .forEach((element) => element.classList.remove("field-highlight"));

  const mark = (
    elements: HTMLElement[],
    mode: FieldHighlightResult["mode"],
  ) => {
    elements.forEach((element) => element.classList.add("field-highlight"));
    return { mode, count: elements.length };
  };

  // 优先精确匹配 data-api-field（字段级锚点，只高亮字段对应的具体元素）
  if (field.name) {
    // 不把字段名插入 CSS selector：后端字段可能包含 []、.、/ 等字符，
    // 直接按空白分隔的 data-api-field token 比 selector 插值更稳健。
    const exact = Array.from(
      frame.querySelectorAll<HTMLElement>("[data-api-field]"),
    ).filter((element) =>
      (element.dataset.apiField || "").split(/\s+/).includes(field.name),
    );
    if (exact.length > 0) return mark(exact, "exact");
  }

  // 兜底：只按显式 target token 匹配 data-review-target，避免把复合字段名
  // 拆成无意义的片段后误命中其他节点。
  const tokens = (field.target || "").split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { mode: "none", count: 0 };
  const targetMatches = Array.from(
    frame.querySelectorAll<HTMLElement>(
      "[data-api-field],[data-review-target]",
    ),
  ).filter((element) => {
    const values = (element.dataset.apiField || "").split(/\s+/);
    const reviewTarget = element.dataset.reviewTarget || "";
    return tokens.some(
      (token) => values.includes(token) || token === reviewTarget,
    );
  });
  return mark(targetMatches, targetMatches.length > 0 ? "target" : "none");
};
