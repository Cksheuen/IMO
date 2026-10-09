import type {
  PageSpec,
  ReviewSceneComponent,
  ReviewPageInteraction,
} from "../types/review";

export type OverlayAction = Extract<
  ReviewPageInteraction["action"],
  "show" | "hide" | "toggle" | "close"
>;

export const isOverlayAction = (
  action: ReviewPageInteraction["action"],
): action is OverlayAction =>
  action === "show" ||
  action === "hide" ||
  action === "toggle" ||
  action === "close";

/** React 持有的 overlay 状态转移；不让 agent 在 pageHtml 内编写 JS。 */
export const nextOverlayId = (
  current: string | null,
  action: OverlayAction,
  targetId?: string,
): string | null => {
  if (action === "close") return null;
  if (!targetId) return current;
  if (action === "show") return targetId;
  if (action === "hide") return current === targetId ? null : current;
  return current === targetId ? null : targetId;
};

/** 结构化 scene 的通用兜底渲染器；业务项目可继续通过 pageHtml 提供高保真视觉。 */
export const renderSceneHtml = (scene: PageSpec["scene"]): string => {
  if (!scene) return "";
  return `<div class="david-scene-renderer" data-review-target="scene" data-review-label="结构化画板">${scene.components
    .map(
      (component) =>
        `<section class="david-scene-component${component.role === "modal" ? " david-scene-modal" : ""}" data-scene-id="${escapeHtml(component.id)}" data-review-element-id="${escapeHtml(component.id)}" data-review-target="${escapeHtml(component.id)}" data-review-label="${escapeHtml(component.id)}"${component.role === "modal" ? ` role="dialog" aria-modal="true" aria-hidden="true"` : ""}${component.componentId ? ` data-component-id="${escapeHtml(component.componentId)}"` : ""}${component.nodeId ? ` data-review-node-id="${escapeHtml(component.nodeId)}"` : ""}><span class="david-scene-component-label">${escapeHtml(component.id)}</span><span class="david-scene-component-meta">${escapeHtml(component.role)}${component.source?.file ? ` · ${escapeHtml(component.source.file)}` : ""}</span>${
          component.state && Object.keys(component.state).length > 0
            ? `<span class="david-scene-component-state">${escapeHtml(
                Object.entries(component.state)
                  .map(([key, value]) => `${key}=${String(value)}`)
                  .join(" · "),
              )}</span>`
            : ""
        }${component.role === "modal" ? `<button type="button" data-review-overlay-close aria-label="关闭弹窗">关闭</button>` : ""}</section>`,
    )
    .join("")}</div>`;
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

/** 从画板元素解析结构化 scene component，兼容旧 data-review-interaction-source。 */
export const sceneIdForElement = (
  element: Element | null,
): string | undefined => {
  if (!element) return undefined;
  const scene =
    element.closest<HTMLElement>("[data-scene-id]")?.dataset.sceneId;
  if (scene?.trim()) return scene.trim();
  const legacy = element.closest<HTMLElement>(
    "[data-review-interaction-source]",
  )?.dataset.reviewInteractionSource;
  return legacy?.trim() || undefined;
};

export const sceneComponentForElement = (
  page: PageSpec,
  element: Element | null,
): ReviewSceneComponent | undefined => {
  const id = sceneIdForElement(element);
  return id
    ? page.scene?.components.find((component) => component.id === id)
    : undefined;
};

export const sceneInteractionForElement = (
  page: PageSpec,
  element: Element | null,
  trigger: ReviewPageInteraction["trigger"] = "click",
): ReviewPageInteraction | undefined => {
  const id = sceneIdForElement(element);
  if (!id) return undefined;
  const interactions = page.interactions ?? [];
  // 精确 trigger 优先，未声明 trigger 只作为兼容 fallback，避免一个通用
  // highlight 声明排在 click navigate 前面而吞掉真正的点击行为。
  const exact = interactions.find(
    (interaction) =>
      interaction.source === id && interaction.trigger === trigger,
  );
  if (exact) return exact;
  // 旧 spec 的无 trigger 交互按 click 兼容；keyboard/hover 必须显式声明，
  // 避免键盘事件与原生 click 事件对 toggle 执行两次。
  return trigger === "click"
    ? interactions.find(
        (interaction) =>
          interaction.source === id && interaction.trigger === undefined,
      )
    : undefined;
};
