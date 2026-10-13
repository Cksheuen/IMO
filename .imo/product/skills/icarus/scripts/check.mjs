import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bundledModsRoot, skillRoot, catalog } from "./mods/registry.mjs";
import { readMod } from "./mods/manifest.mjs";
import { bundleMod } from "./mods/bundle.mjs";

const entries = [];
for (const name of fs.readdirSync(bundledModsRoot).sort()) {
  const mod = readMod(path.join(bundledModsRoot, name));
  assert.equal(mod.manifest.id, name);
  await bundleMod(mod);
  entries.push({ ...mod.manifest, package: mod.package.name,
    registry: mod.package.publishConfig?.registry || "https://registry.npmjs.org",
    integrity: mod.integrity });
}
const catalogFile = path.join(skillRoot, "mod-catalog.json");
if (process.argv.includes("--write-catalog"))
  fs.writeFileSync(catalogFile, JSON.stringify({ schema: "icarus-catalog/v1", mods: entries }, null, 2) + "\n");
assert.deepEqual(catalog(), entries, "Bundled mod catalog is stale");
let syntaxFiles = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      syntaxFiles++;
    }
  }
}
walk(skillRoot);
console.log(JSON.stringify({ ok: true, mods: entries.length, syntaxFiles }));
