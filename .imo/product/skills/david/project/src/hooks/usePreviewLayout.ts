import { useLayoutEffect, type RefObject } from "react";

/** Match the reading column to the actual fitted preview, without per-frame state. */
export function usePreviewLayout(preview: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const dock = preview.current;
    const stage = dock?.closest<HTMLElement>(".stage");
    if (!dock || !stage) return;
    const sync = () => {
      const right = dock.classList.contains("is-visible")
        ? Number(dock.dataset.previewRight) + 16
        : 0;
      if (right) stage.style.setProperty("--david-preview-end", `${right}px`);
      else stage.style.removeProperty("--david-preview-end");
    };
    const mutations = new MutationObserver(sync);
    const resize = new ResizeObserver(sync);
    mutations.observe(dock, {
      attributes: true,
      attributeFilter: ["class", "data-preview-right"],
    });
    resize.observe(dock);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", sync);
      stage.style.removeProperty("--david-preview-end");
    };
  }, [preview]);
}
