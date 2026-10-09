// Browser-only test entry, loaded by Vite; the production entry never imports it.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { HoverPopover } from "../src/components/HoverPopover.tsx";

export function mountLayerPopover() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    createElement(
      HoverPopover,
      {
        open: true,
        anchor: () => document.querySelector(".rich-detail-title"),
        onClose: () => {},
      },
      "Layer probe",
    ),
  );
  return () => {
    root.unmount();
    host.remove();
  };
}
