#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const [command, ...args] = process.argv.slice(2);
if (command === "--version") {
  console.log(
    JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)))
      .version,
  );
} else if (!command || ["--help", "help"].includes(command)) {
  console.log(
    "icarus attach <source.html> <review.html> [--mods ids] [--no-auto]\n" +
      "icarus feedback get|list|context|maintain|restore|reply <document> [entry-id|status] [body]\n" +
      "icarus feedback task list|queue-all|next|queue|cancel|claim|heartbeat|finish|fail <document> [entry] [session] [task-id] [result]\n" +
      "icarus mod list|recommend|init|validate|pack|install|enable|disable|contribute|publish\n" +
      "icarus service start|restart\n" +
      "icarus whiteboard export <source.html|spec.json> --out <dir> [--all]\n" +
      "icarus whiteboard sync <source.html|spec.json> --page <id> --view <id> [--question <id>] --doc <doc> --create [--dry-run]\n" +
      "icarus whiteboard sync <source.html|spec.json> --page <id> --view <id> --whiteboard-token <token> --overwrite|--append [--dry-run]",
  );
} else {
  const file = {
    attach: "attach.mjs",
    feedback: "feedback.mjs",
    mod: "mod.mjs",
    service: "service.mjs",
    whiteboard: "whiteboard.mjs",
  }[command];
  if (!file) throw new Error("Unknown Icarus command");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(file, import.meta.url)), ...args],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = result.status ?? 1;
}
