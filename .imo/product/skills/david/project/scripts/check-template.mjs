import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = fs.readFileSync(path.join(root, "dist/template.html"), "utf8");
for (const token of ["{{BUNDLED_CSS}}", "{{BUNDLED_JS}}"])
  if (bundle.includes(token)) throw new Error(`unresolved ${token}`);
for (const token of [
  "{{TITLE}}",
  "{{SOURCE_SHA256}}",
  "{{PAGE_HTML}}",
  "{{REVIEW_DATA_JSON}}",
])
  if (!bundle.includes(token)) throw new Error(`missing ${token}`);
for (const token of [
  "preview-shell",
  "preview-chrome",
  "来源：",
  "生成：",
  "startViewTransition",
  "view-transition-name",
  // HARD-GATE 24: bundle must ship without network APIs. NOTE: never ban
  // the `fetch` literal — React bundles fetchPriority/prefetchDNS, false positives.
  "XMLHttpRequest",
  "new WebSocket",
  "EventSource(",
  "sendBeacon",
])
  if (bundle.includes(token)) throw new Error(`forbidden ${token}`);
for (const token of [
  "david-agent-feedback",
  "component-dock",
  "flip-morph",
  "is-leaving",
  "app-header",
  "inspector",
  "data-api-field",
  "prefers-reduced-motion",
  "comment-rail-list",
  "is-mode-all",
  // HARD-GATE 25: reply authorship must be structured & visible, older data default to user.
  "david-feedback-paste",
  "comment-rail-reply-author",
  "100dvh",
  "safe-area-inset",
  "focus-visible",
  "clamp(",
])
  if (!bundle.includes(token)) throw new Error(`missing feature ${token}`);
console.log(
  JSON.stringify({ ok: true, bytes: Buffer.byteLength(bundle) }, null, 2),
);
