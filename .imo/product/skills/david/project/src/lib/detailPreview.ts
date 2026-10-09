export const DETAIL_PREVIEW_START = "david-detail-preview-start";
export const DETAIL_PREVIEW_END = "david-detail-preview-end";
export type DetailPreview = { token: string; overlayId: string };
export function startDetailPreview(overlayId: string): () => void {
  const token = crypto.randomUUID();
  window.dispatchEvent(
    new CustomEvent<DetailPreview>(DETAIL_PREVIEW_START, {
      detail: { token, overlayId },
    }),
  );
  return () =>
    window.dispatchEvent(
      new CustomEvent(DETAIL_PREVIEW_END, { detail: { token } }),
    );
}
export function isValidDetailPreview(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).length === 1 &&
    typeof item.overlayId === "string" &&
    item.overlayId.trim().length > 0 &&
    item.overlayId.length <= 120
  );
}
