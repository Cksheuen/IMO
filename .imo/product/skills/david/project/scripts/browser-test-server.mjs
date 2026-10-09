import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Shared helpers for browser (Playwright) test scripts.
 *
 * Every browser test gets its own kernel-assigned loopback port: vite is
 * started with --port 0 (CLI) / port: 0 (JS API) and the real URL is read
 * back from the server, so tests neither collide with a developer's running
 * dev server nor with each other when run concurrently.
 */

export const HOST = "127.0.0.1";

/** Reserve a free loopback port: bind 0, read the port, release immediately. */
export function freePort(host = HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Assert nothing is listening on the port (connecting must be refused).
 * Offline browser cases use this to prove their feedback-service target is
 * deterministically unreachable before pointing the page at it.
 */
export function assertPortUnused(
  port,
  { host = HOST, timeoutMs = 1_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`port ${port} probe timed out`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(
        new Error(
          `expected ${host}:${port} to have no listener, but it accepts connections`,
        ),
      );
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error?.code === "ECONNREFUSED") {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Resolve the vite CLI entry inside `root`'s node_modules. Invoking it directly
 * with the current Node binary avoids the npx -> node grandchild layer: the
 * spawned process IS vite, so its lifecycle and process-group cleanup stay
 * deterministic.
 */
function resolveViteBin(root) {
  const bin = path.join(root, "node_modules/vite/bin/vite.js");
  if (!fs.existsSync(bin)) {
    throw new Error(`cannot locate vite CLI at ${bin}`);
  }
  return bin;
}

/**
 * Start vite on a kernel-assigned free port (--port 0 + strictPort) and parse
 * the real Local URL from vite's output. Returns the child, the port and the
 * baseUrl. The child is spawned in its own process group so callers can kill
 * the whole group on cleanup.
 */
export async function startViteCli(root, { host = HOST, extraEnv = {} } = {}) {
  const child = spawn(
    process.execPath,
    [resolveViteBin(root), "--host", host, "--port", "0", "--strictPort"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, ...extraEnv },
    },
  );
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error("vite did not print its local URL within 60s"));
    }, 60_000);
    const onChunk = (chunk) => {
      output += chunk.toString();
      const match = output.match(
        /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//,
      );
      if (match) {
        clearTimeout(timer);
        // Drain the rest of vite's output for the lifetime of the long-running
        // test instead of buffering it all in `output`.
        child.stdout.removeListener("data", onChunk);
        child.stderr.removeListener("data", onChunk);
        child.stdout.resume();
        child.stderr.resume();
        resolve(Number(match[1]));
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vite exited before serving (code ${code})`));
    });
  });
  const baseUrl = `http://${host}:${port}/`;
  return { child, port, baseUrl };
}

/** Poll the dev server's root URL until it answers. */
export async function waitForServer(
  child,
  baseUrl,
  { timeoutMs = 60_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`vite exited before serving (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status === 304) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`vite did not start within ${timeoutMs}ms`);
}

/**
 * Stop the vite process group: SIGTERM first (vite closes watchers/sockets),
 * then SIGKILL the whole group if it has not exited shortly after. Detached
 * spawn put vite in its own process group, so negative-pid signalling also
 * reaps any helper children instead of leaving orphaned dev servers.
 */
export async function stopViteCli(child, { waitMs = 3_000 } = {}) {
  if (!child || child.exitCode !== null) return;
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  };
  signalGroup("SIGTERM");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, waitMs)),
  ]);
  if (child.exitCode === null) signalGroup("SIGKILL");
}

/**
 * Start an in-process vite dev server (JS API) on a kernel-assigned free port.
 * Used by scripts that run inside the aggregator process. Returns the server,
 * the resolved port, the baseUrl and a close() handle.
 */
export async function startViteServer(root, { host = HOST } = {}) {
  const { createServer } = await import("vite");
  const server = await createServer({
    root,
    server: { host, port: 0, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port =
    address && typeof address === "object" ? address.port : undefined;
  if (!port) {
    await server.close();
    throw new Error("vite server did not report a bound port");
  }
  const baseUrl = `http://${host}:${port}/`;
  return { server, port, baseUrl, close: () => server.close() };
}
