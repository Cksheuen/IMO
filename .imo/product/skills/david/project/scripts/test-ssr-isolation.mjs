import assert from "node:assert/strict";
import { createSsrTestServer } from "./ssr-test-server.mjs";

// Exercise the shared factory used by the actual SSR scripts concurrently.
const servers = await Promise.all(
  Array.from({ length: 4 }, () => createSsrTestServer({ logLevel: "silent" })),
);
try {
  assert.equal(
    new Set(servers.map((server) => server.config.cacheDir)).size,
    4,
  );
  const loaded = await Promise.all(
    servers.map((server) => server.ssrLoadModule("/src/lib/reviewSpec.ts")),
  );
  servers.forEach((server, index) => {
    assert.equal(server.httpServer, null);
    assert.equal(server.config.server.ws, false);
    assert.equal(server.config.server.hmr, false);
    assert.equal(typeof loaded[index].parseReviewSpec, "function");
  });
  console.log(
    "SSR isolation: 4 concurrent real Vite compilers, no HTTP or WebSocket listener",
  );
} finally {
  await Promise.all(servers.map((server) => server.close()));
}
