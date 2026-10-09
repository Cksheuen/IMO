export const RICH_DETAIL_CLOSE_EVENT = "david:rich-detail-close";

export function closeOpenRichDetails(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RICH_DETAIL_CLOSE_EVENT));
  }
}
