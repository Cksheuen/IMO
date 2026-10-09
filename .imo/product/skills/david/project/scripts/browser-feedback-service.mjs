import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

/** Real daemon, private disk and random port. Never reads the user's service. */
export async function startBrowserFeedbackService() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "david-browser-feedback-"),
  );
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  let failNextWrite = false;
  const daemon = spawn(
    process.execPath,
    [fileURLToPath(new URL("serve-feedback.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        IMO_GLOBAL_ROOT: root,
        DAVID_FEEDBACK_PORT: String(port),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const close = async () => {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const exited = once(daemon, "exit");
      daemon.kill("SIGTERM");
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    const deadline = Date.now() + 15000;
    while (true) {
      if (daemon.exitCode !== null)
        throw new Error(`feedback daemon exited: ${stderr}`);
      if (
        await fetch(`${baseUrl}/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      if (Date.now() > deadline)
        throw new Error(`feedback daemon timeout: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    await close();
    throw error;
  }
  const read = async (slug) => {
    const res = await fetch(`${baseUrl}/feedback/${encodeURIComponent(slug)}`);
    if (res.status === 404) return null;
    if (res.status === 422) return null;
    if (!res.ok)
      throw new Error(
        `feedback read failed: ${res.status} ${await res.text()}`,
      );
    return (await res.json()).doc;
  };
  const readAny = async () => {
    const index = await fetch(`${baseUrl}/index`).then((response) =>
      response.json(),
    );
    const item = index.items?.[0];
    return item ? read(item.slug) : null;
  };
  return {
    baseUrl,
    read,
    readAny,
    close,
    async attach(page) {
      // Re-route the app's loopback endpoint to this test's real daemon.
      await page.route(
        /^http:\/\/(127\.0\.0\.1|localhost):\d+\/(feedback(?:\/.*)?|health)$/,
        async (route) => {
          if (
            failNextWrite &&
            ["POST", "PUT", "PATCH"].includes(route.request().method())
          ) {
            failNextWrite = false;
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "test write failure" }),
            });
            return;
          }
          const request = new URL(route.request().url());
          const response = await route.fetch({
            url: `${baseUrl}${request.pathname}${request.search}`,
          });
          await route.fulfill({ response });
        },
      );
    },
    async waitFor(slug, predicate) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const doc = await read(slug);
        if (predicate(doc)) return doc;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`feedback service state did not converge for ${slug}`);
    },
    failNextWrite() {
      failNextWrite = true;
    },
    seed(slug, doc) {
      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new Error("invalid test slug");
      const file = path.join(root, "runtime/david/feedback", `${slug}.json`);
      fs.writeFileSync(
        file,
        typeof doc === "string" ? doc : JSON.stringify(doc),
      );
    },
  };
}
