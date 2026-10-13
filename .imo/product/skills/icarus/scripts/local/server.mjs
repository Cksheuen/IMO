import { taskView, changeTask } from "./feedback-tasks.mjs";
import { readModState, writeModState, MOD_STATE_LIMIT } from "./mod-state.mjs";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  atomicJSON,
  configuration,
  hash,
  mutate,
  runtimeRoot,
  snapshot,
  readJSON,
} from "./store.mjs";
import { readPlan } from "../mods/plan.mjs";
export async function startService(root = runtimeRoot()) {
  const { upgradeLegacyProjections } =
    await import("../compat/david-channel.mjs");
  upgradeLegacyProjections(root);
  let baseUrl = "";
  const runtimeId = hash(root);
  const davidModel = hash(
    fs.readFileSync(new URL("../compat/david-model.mjs", import.meta.url)),
  );
  const davidChannel = hash(
    fs.readFileSync(new URL("../compat/david-channel.mjs", import.meta.url)),
  );
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (value?.feedbackTasks) {
        const { feedbackTasks: _tasks, ...visible } = value;
        value = visible;
      }
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.host !== new URL(baseUrl).host) {
        send(403, { error: "Invalid Host" });
        return;
      }
      const origin = req.headers.origin;
      // File previews use the opaque "null" origin; all API reads/writes additionally require a document token.
      let localOrigin = false;
      try {
        const parsed = new URL(origin);
        localOrigin =
          parsed.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
          !parsed.username &&
          !parsed.password;
      } catch {}
      if (origin && origin !== "null" && origin !== baseUrl && !localOrigin) {
        send(403, { error: "Origin not allowed" });
        return;
      }
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url, baseUrl);
      if (url.pathname === "/health" && req.method === "GET") {
        send(200, {
          schema: "icarus-service/v1",
          runtimeId,
          davidModel,
          davidChannel,
          pid: process.pid,
          capabilities: [
            "mods-v1",
            "mod-storage-v1",
            "comment-workflow-v1",
            "feedback-tasks-v1",
            "feedback-batch-v1",
            "david-native-v1",
          ],
        });
        return;
      }
      const native = /^\/david\/([a-f0-9]{32})(\/.*)$/.exec(url.pathname);
      if (native) {
        const config = configuration(native[1], root);
        if (req.headers.authorization !== `Bearer ${config.token}`) {
          send(403, { error: "Document token required" });
          return;
        }
        let body;
        if (!["GET", "HEAD"].includes(req.method)) {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 32 * 1024 * 1024) {
              send(413, { error: "David payload exceeds limit" });
              return;
            }
            chunks.push(chunk);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            send(422, { error: "Invalid JSON" });
            return;
          }
        }
        const { handleDavid } = await import("../compat/david-channel.mjs");
        send(200, handleDavid(config, native[2], req.method, body, root));
        return;
      }
      const preview = /^\/review\/([a-f0-9]{32})\/$/.exec(url.pathname);
      if (preview && req.method === "GET") {
        const config = configuration(preview[1], root);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(fs.readFileSync(config.output));
        return;
      }
      const asset = /^\/review\/([a-f0-9]{32})\/(.+)$/.exec(url.pathname);
      if (asset && req.method === "GET") {
        const config = configuration(asset[1], root);
        const relative = decodeURIComponent(asset[2]);
        if (relative.split(/[\\/]/).some((part) => part.startsWith("."))) {
          send(403, { error: "Invalid asset path" });
          return;
        }
        const directory = fs.realpathSync(path.dirname(config.source.path));
        let file;
        try {
          file = fs.realpathSync(path.resolve(directory, relative));
        } catch {
          send(404, { error: "Asset missing" });
          return;
        }
        if (
          !file.startsWith(directory + path.sep) ||
          !fs.statSync(file).isFile()
        ) {
          send(403, { error: "Asset outside source directory" });
          return;
        }
        const types = {
          ".css": "text/css",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".woff2": "font/woff2",
          ".woff": "font/woff",
          ".html": "text/html",
          ".json": "application/json",
        };
        const type = types[path.extname(file).toLowerCase()];
        if (!type) {
          send(403, { error: "Unsupported asset type" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-store",
        });
        res.end(fs.readFileSync(file));
        return;
      }
      const stateRoute =
        /^\/mod-data\/([a-f0-9]{32})\/([a-z][a-z0-9-]{0,63})$/.exec(
          url.pathname,
        );
      if (stateRoute) {
        const config = configuration(stateRoute[1], root);
        if (req.headers.authorization !== `Bearer ${config.token}`) {
          send(403, { error: "Document token required" });
          return;
        }
        if (req.method === "GET") {
          send(200, readModState(config.id, stateRoute[2], root));
          return;
        }
        if (req.method !== "POST") {
          send(405, { error: "Method not allowed" });
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MOD_STATE_LIMIT + 1024) {
            send(413, { error: "Mod data too large" });
            return;
          }
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          send(422, { error: "Invalid JSON" });
          return;
        }
        send(200, writeModState(config.id, stateRoute[2], body, root));
        return;
      }
      const modRoute = /^\/mods\/([a-f0-9]{32})$/.exec(url.pathname);
      if (modRoute && req.method === "GET") {
        const config = configuration(modRoute[1], root);
        if (req.headers.authorization !== `Bearer ${config.token}`) {
          send(403, { error: "Document token required" });
          return;
        }
        send(200, readPlan(config.id, root));
        return;
      }
      const route =
        /^\/feedback\/([a-f0-9]{32})(?:\/(entries|replies|updates|tasks))?$/.exec(
          url.pathname,
        );
      if (!route) {
        send(404, { error: "Unknown route" });
        return;
      }
      const config = configuration(route[1], root);
      if (req.headers.authorization !== `Bearer ${config.token}`) {
        send(403, { error: "Document token required" });
        return;
      }
      if (req.method === "GET" && route[2] === "tasks") {
        send(200, taskView(config, root));
        return;
      }
      if (req.method === "GET" && !route[2]) {
        send(200, snapshot(config, root));
        return;
      }
      if (req.method !== "POST" || !route[2]) {
        send(405, { error: "Method not allowed" });
        return;
      }
      let raw = "";
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) {
          send(413, { error: "Request too large" });
          return;
        }
        raw += chunk;
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        send(422, { error: "Invalid JSON" });
        return;
      }
      // Mutation is synchronous through atomic rename: no lost-update await gap.
      send(
        200,
        route[2] === "tasks"
          ? changeTask(config, body, root)
          : mutate(config, route[2], body, root),
      );
    } catch (error) {
      send(error.status ?? 500, {
        error: error.message,
        conflict: error.conflict,
        ...(error.currentDoc ? { currentDoc: error.currentDoc } : {}),
        ...(error.currentVersion !== undefined
          ? { currentVersion: error.currentVersion }
          : {}),
      });
    }
  });
  const prior = readJSON(path.join(root, "service.json"));
  const preferredPort =
    prior?.runtimeId === runtimeId ? Number(new URL(prior.baseUrl).port) : 0;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const state = {
    schema: "icarus-service/v1",
    baseUrl,
    pid: process.pid,
    runtimeId,
  };
  atomicJSON(path.join(root, "service.json"), state);
  return {
    ...state,
    async close() {
      // A browser preconnect or incomplete HTTP request can otherwise block restart forever.
      const deadline = setTimeout(() => server.closeAllConnections(), 1000);
      try {
        await new Promise((resolve) => server.close(resolve));
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await startService();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await service.close();
      process.exit(0);
    });
}
