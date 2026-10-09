import { createServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** SSR tests need the compiler only: never allocate HTTP or HMR sockets. */
export async function createSsrTestServer(options = {}) {
  // A child SSR compiler must not invalidate its live browser aggregator's
  // optimized dependencies, even though the HTTP/HMR sockets are disabled.
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "david-ssr-cache-"));
  try {
    const server = await createServer({
      ...options,
      cacheDir,
      server: {
        ...options.server,
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
    });
    const close = server.close.bind(server);
    let closing;
    server.close = () =>
      (closing ??= close().finally(() =>
        fs.rmSync(cacheDir, { recursive: true, force: true }),
      ));
    return server;
  } catch (error) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    throw error;
  }
}
