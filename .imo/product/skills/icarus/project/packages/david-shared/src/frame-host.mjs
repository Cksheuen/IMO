export function frameMod(id, frameBundle, title) {
  return {
    id: id,
    apiVersion: 1,
    requires: [],
    async mount(context, options = {}) {
      const slots = [
        ...context.root.querySelectorAll(
          options.selector ?? `[data-icarus-${id}]`,
        ),
      ];
      if (slots.length !== 1)
        throw Error(
          "David workbench needs one root slot; use pages inside its original App",
        );
      if (!context.david)
        throw Error("Upgrade Icarus core for the original David workbench");
      const slot = slots[0],
        config = slot.querySelector(":scope > script[data-icarus-props]");
      const data = options.props ?? JSON.parse(config?.textContent ?? "{}");
      const frame = document.createElement("iframe");
      frame.title = title;
      frame.dataset.icarusDavidRoot = id;
      frame.dataset.davidSource = frameBundle.source;
      frame.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147482000;background:#efe2c7";
      let dispose;
      context.onCleanup(() => {
        dispose?.();
        frame.remove();
      });
      const release = context.david.present();
      context.onCleanup(release);
      await new Promise((resolve, reject) => {
        frame.onload = resolve;
        frame.onerror = reject;
        frame.srcdoc =
          '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
          frameBundle.css.replaceAll("</style", "<\\/style") +
          '</style></head><body><div id="review-root"></div></body></html>';
        slot.append(frame);
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("David App did not mount")),
          10000,
        );
        context.onCleanup(() => clearTimeout(timer));
        const bridge = {
          spec: data.spec ?? data,
          baseUrl: context.david.baseUrl,
          source: frameBundle.source,
          request: (suffix, init) =>
            context.david.request(suffix, { ...init, signal: context.signal }),
          ready: () => {
            clearTimeout(timer);
            resolve();
          },
          failed: (message) => {
            clearTimeout(timer);
            reject(Error(message));
          },
        };
        frame.contentWindow.addEventListener(
          "error",
          (event) => bridge.failed(event.message),
          { once: true },
        );
        frame.contentWindow.__ICARUS_DAVID__ = bridge;
        dispose = () => bridge.dispose?.();
        const script = frame.contentDocument.createElement("script");
        script.textContent = frameBundle.code;
        frame.contentDocument.body.append(script);
      });
    },
  };
}
