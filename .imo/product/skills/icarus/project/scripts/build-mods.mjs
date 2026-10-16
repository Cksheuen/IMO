import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMod } from "../../scripts/mods/build.mjs";
import { readProject } from "../../scripts/mods/manifest.mjs";

// A source-checkout build always uses the committed snapshot, never a local link.
process.env.ICARUS_DAVID_SOURCE = "snapshot";
const root = fileURLToPath(new URL("../", import.meta.url));
const selected = new Set(process.argv.slice(2));
const known = fs.readdirSync(path.join(root, "mods")).sort();
for (const id of selected)
  if (!known.includes(id)) throw new Error(`Unknown source mod: ${id}`);
const built = [];
for (const id of known) {
  const dir = path.join(root, "mods", id);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json")));
  if (selected.size && !selected.has(id)) continue;
  if (pkg.icarusBuild) {
    await buildMod(dir);
    built.push({ id, version: pkg.version });
  }
  readProject(dir);
}
console.log(JSON.stringify({ ok: true, built, output: "project/mods/*/dist", runtimeUpdated: false }));
