#!/usr/bin/env node
import path from "node:path";
import { hash, readJSON, runtimeRoot } from "./local/store.mjs";
import { ensureService } from "./local/service.mjs";
const command = process.argv[2];
if (!["start", "restart"].includes(command))
  throw new Error("Usage: icarus service start|restart");
if (command === "restart") {
  const root = runtimeRoot(),
    state = readJSON(path.join(root, "service.json"));
  if (state) {
    const url = new URL(state.baseUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new Error("Invalid stored service URL");
    let health;
    try {
      health = await fetch(url.origin + "/health", {
        redirect: "error",
        signal: AbortSignal.timeout(1500),
      }).then((r) => r.json());
    } catch {}
    if (health) {
      if (
        health.schema !== "icarus-service/v1" ||
        health.runtimeId !== hash(root) ||
        health.pid !== state.pid
      )
        throw new Error(
          "Service identity changed; refusing to stop an unrelated process",
        );
      process.kill(state.pid, "SIGTERM");
      const deadline = Date.now() + 8000;
      while (true) {
        try {
          process.kill(state.pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") break;
          throw e;
        }
        if (Date.now() > deadline)
          throw new Error("Service did not exit; no replacement started");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
}
console.log(JSON.stringify(await ensureService()));
