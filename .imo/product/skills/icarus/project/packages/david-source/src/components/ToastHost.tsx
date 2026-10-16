import { useEffect, useState } from "react";

type ToastMessage = {
  id: number;
  kind: "success" | "error";
  message: string;
};

export function ToastHost() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let nextId = 0;
    let timer: number | undefined;

    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<Omit<ToastMessage, "id">>).detail;
      window.clearTimeout(timer);
      setToast({ ...detail, id: ++nextId });
      timer = window.setTimeout(() => setToast(null), 2400);
    };

    window.addEventListener("david-toast", onToast);
    return () => {
      window.removeEventListener("david-toast", onToast);
      window.clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="toast-host" aria-live="polite">
      <div
        key={toast.id}
        className={`toast toast-${toast.kind}`}
        role={toast.kind === "error" ? "alert" : "status"}
      >
        {toast.message}
      </div>
    </div>
  );
}
