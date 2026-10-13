import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hash, readJSON, runtimeRoot } from "./store.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function ensureService(root = runtimeRoot()) {
  const model = hash(
    fs.readFileSync(new URL("../compat/david-model.mjs", import.meta.url)),
  );
  const channel = hash(
    fs.readFileSync(new URL("../compat/david-channel.mjs", import.meta.url)),
  );
  const compatible = (state) =>
    state.capabilities.includes("david-native-v1") &&
    state.capabilities.includes("feedback-tasks-v1") &&
    state.davidModel === model &&
    state.davidChannel === channel;
  const health = async () => {
    try {
      const state = readJSON(path.join(root, "service.json"));
      if (!state || new URL(state.baseUrl).hostname !== "127.0.0.1")
        return null;
      const data = await fetch(`${state.baseUrl}/health`, {
        signal: AbortSignal.timeout(700),
        redirect: "error",
      }).then((r) => r.json());
      return data.schema === "icarus-service/v1" &&
        data.runtimeId === hash(root)
        ? {
            ...state,
            capabilities: data.capabilities ?? [],
            davidModel: data.davidModel,
            davidChannel: data.davidChannel,
          }
        : null;
    } catch {
      return null;
    }
  };
  const current = await health();
  if (current) {
    if (!compatible(current))
      throw new Error(
        "Icarus service is outdated; run icarus service restart, then retry. Existing comments are preserved.",
      );
    return current;
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, "start.lock");
  let owns = false;
  const deadline = Date.now() + 12000;
  try {
    while (Date.now() < deadline) {
      try {
        fs.mkdirSync(lock);
        owns = true;
        fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const ready = await health();
      if (ready) {
        if (!compatible(ready))
          throw new Error("Restart the outdated Icarus service");
        return ready;
      }
      let pid;
      try {
        pid = Number(fs.readFileSync(path.join(lock, "pid"), "utf8"));
      } catch {}
      if (pid) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") {
            fs.rmSync(lock, { recursive: true, force: true });
            continue;
          }
        }
      }
      let lockAge = 0;
      try {
        lockAge = Date.now() - fs.statSync(lock).mtimeMs;
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!pid && lockAge > 3000) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      await delay(100);
    }
    if (!owns) throw new Error("Timed out waiting for Icarus service startup");
    const already = await health();
    if (already) {
      if (!compatible(already))
        throw new Error("Restart the outdated Icarus service");
      return already;
    }
    const log = fs.openSync(path.join(root, "service.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./server.mjs", import.meta.url))],
      {
        env: { ...process.env, ICARUS_RUNTIME_DIR: root },
        detached: true,
        stdio: ["ignore", log, log],
      },
    );
    child.unref();
    fs.closeSync(log);
    while (Date.now() < deadline) {
      const ready = await health();
      if (ready) {
        if (!compatible(ready))
          throw new Error("Restart the outdated Icarus service");
        return ready;
      }
      await delay(100);
    }
    throw new Error(
      "Icarus local service did not start; inspect its service.log",
    );
  } finally {
    if (owns) fs.rmSync(lock, { recursive: true, force: true });
  }
}
