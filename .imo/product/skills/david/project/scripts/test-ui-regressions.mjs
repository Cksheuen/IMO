#!/usr/bin/env node

import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startViteServer } from "./browser-test-server.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGRESSION_SCRIPTS = [
  "scripts/test-code-annotations.mjs",
  "scripts/test-global-appearance.mjs",
  "scripts/test-scene-transitions.mjs",
  "scripts/test-feedback-rail.mjs",
  "scripts/test-dock-scale.mjs",
  "scripts/test-fullpage-host.mjs",
];

async function runScript(script, baseUrl) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: { ...process.env, BASE_URL: baseUrl },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${script} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  // 内核分配空闲端口并把真实 BASE_URL 传给每个子测试：并发回归、本机已开
  // dev server 都不会再撞固定端口。调用方显式给了 BASE_URL 时直接复用。
  let baseUrl = process.env.BASE_URL;
  let vite;
  try {
    if (!baseUrl) {
      vite = await startViteServer(PROJECT_ROOT);
      baseUrl = vite.baseUrl;
    }

    for (const script of REGRESSION_SCRIPTS) {
      await runScript(script, baseUrl);
    }
  } finally {
    await vite?.close();
  }
}

main().catch((error) => {
  console.error("[test-ui-regressions] FAILED:", error);
  process.exit(1);
});
