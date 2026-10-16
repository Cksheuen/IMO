import { createRoot } from "react-dom/client";
import { ResearchWorkbench } from "./ResearchWorkbench";
import { validateResearch } from "./schema";
import "@david/styles/index.css";
import "@david/styles/track-mark.css";

declare global {
  interface Window {
    __ICARUS_DAVID__: any;
    __DAVID_SOURCE__?: string;
  }
}
const bridge = window.__ICARUS_DAVID__;
const originalFetch = window.fetch.bind(window);
// The original FeedbackTransport and hooks stay intact; only their I/O endpoint is adapted.
window.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.startsWith(bridge.baseUrl + "/")) {
    const result = await bridge.request(
      url.slice(bridge.baseUrl.length),
      init ?? {},
    );
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(input, init);
};
const showValidationError = (error: unknown) => {
  const host = document.getElementById("review-root");
  if (!host) return;
  host.replaceChildren();
  const panel = document.createElement("main");
  panel.style.cssText =
    "box-sizing:border-box;min-height:100vh;padding:48px;background:#efe2c7;color:#3c2d22;font:16px/1.6 system-ui,sans-serif";
  const title = document.createElement("h1");
  title.textContent = "研究页面数据校验失败";
  title.style.cssText = "margin:0 0 12px;font-size:28px";
  const message = document.createElement("p");
  message.textContent = error instanceof Error ? error.message : String(error);
  message.style.cssText =
    "max-width:900px;padding:16px;border:1px solid #bd7047;border-radius:10px;background:#fff8ed;white-space:pre-wrap";
  const hint = document.createElement("p");
  hint.textContent =
    "请修复 research-spec.json 的节点、代码归属或契约后重新生成；原评论数据仍保存在 Icarus 本机服务中。";
  panel.append(title, message, hint);
  host.append(panel);
};
let payload;
try {
  payload = validateResearch(bridge.spec);
} catch (error) {
  showValidationError(error);
  bridge.ready();
}
if (!payload) {
  // Keep the iframe mounted with a visible diagnostic instead of leaving the
  // user with a blank TRD while the outer comment kernel continues to work.
} else {
  // Avoid importing unrelated David-origin localStorage history into this Icarus document.
  localStorage.setItem(`david:${payload.slug}:migrated-to-service`, "1");
  const root = createRoot(document.getElementById("review-root")!, {
    onUncaughtError: (error) => bridge.failed(String(error)),
  });
  root.render(<ResearchWorkbench data={payload} baseUrl={bridge.baseUrl} />);
  bridge.dispose = () => root.unmount();
  window.__DAVID_SOURCE__ = bridge.source;
  requestAnimationFrame(() => requestAnimationFrame(() => bridge.ready()));
}
