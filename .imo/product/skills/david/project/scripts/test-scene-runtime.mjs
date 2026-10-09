#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const server = await createSsrTestServer({
  root: projectRoot,
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const runtime = await server.ssrLoadModule("/src/lib/sceneRuntime.ts");
  const page = {
    id: "p1",
    label: "P1",
    pageHtml: "",
    interactions: [
      { source: "open", action: "show", targetElementId: "modal" },
      {
        source: "open",
        trigger: "keyboard",
        action: "hide",
        targetElementId: "modal",
      },
      {
        source: "open",
        trigger: "click",
        action: "navigate",
        targetPageId: "p2",
      },
    ],
  };
  const sceneElement = {
    closest(selector) {
      if (selector === "[data-scene-id]")
        return { dataset: { sceneId: "open" } };
      return null;
    },
  };
  assert.equal(
    runtime.sceneInteractionForElement(page, sceneElement, "keyboard")?.action,
    "hide",
  );
  assert.equal(
    runtime.sceneInteractionForElement(page, sceneElement, "click")?.action,
    "navigate",
  );
  assert.equal(runtime.nextOverlayId(null, "show", "modal"), "modal");
  assert.equal(runtime.nextOverlayId("modal", "toggle", "modal"), null);
  assert.equal(runtime.nextOverlayId("modal", "close"), null);
  const html = runtime.renderSceneHtml({
    components: [{ id: "modal", role: "modal" }],
  });
  assert.match(html, /david-scene-modal/);
  assert.match(html, /data-review-overlay-close/);
  console.log("scene runtime OK");
} finally {
  await server.close();
}
