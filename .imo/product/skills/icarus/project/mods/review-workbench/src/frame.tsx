import { createRoot } from "react-dom/client";
import { App } from "@david/app/App";
import { parseReviewSpec } from "@david/lib/reviewSpec";
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
const payload = parseReviewSpec(bridge.spec);
payload.data.service = { baseUrl: bridge.baseUrl };
// Avoid importing unrelated David-origin localStorage history into this Icarus document.
localStorage.setItem(`david:${payload.data.slug}:migrated-to-service`, "1");
const root = createRoot(document.getElementById("review-root")!, {
  onUncaughtError: (error) => bridge.failed(String(error)),
});
root.render(<App {...payload} />);
bridge.dispose = () => root.unmount();
window.__DAVID_SOURCE__ = bridge.source;
requestAnimationFrame(() => requestAnimationFrame(() => bridge.ready()));
