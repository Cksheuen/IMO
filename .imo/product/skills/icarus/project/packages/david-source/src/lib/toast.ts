export type ToastKind = "success" | "error";

export function showToast(kind: ToastKind, message: string): void {
  window.dispatchEvent(
    new CustomEvent("david-toast", {
      detail: { kind, message },
    }),
  );
}
