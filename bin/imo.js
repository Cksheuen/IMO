#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { existsSync, realpathSync } = require("node:fs");
const { dirname, join } = require("node:path");

const packageRoot = join(dirname(realpathSync(__filename)), "..");
const entrypoint = join(packageRoot, "imo");

if (!existsSync(entrypoint)) {
  console.error(`[imo package] missing package entrypoint: ${entrypoint}`);
  process.exit(1);
}

const child = spawn(entrypoint, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`[imo package] failed to start entrypoint: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
