import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceState } from "../../scripts/mods/david-source.mjs";
import { readProject } from "../../scripts/mods/manifest.mjs";

process.env.ICARUS_DAVID_SOURCE = "snapshot";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "packages/david-source");
const state = sourceState(source);
assert.deepEqual(state, JSON.parse(fs.readFileSync(path.join(source, "source-manifest.json"))),
  "David source snapshot differs from its manifest");
let builtMods = 0;
let sourceMods = 0;
for (const id of fs.readdirSync(path.join(root, "mods")).sort()) {
  const dir = path.join(root, "mods", id);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "mod.json")));
  assert.equal(pkg.version, manifest.version);
  if (pkg.icarusBuild) {
    assert.ok(fs.existsSync(path.join(dir, pkg.icarusBuild.entry)), `Missing entry for ${id}`);
    if (fs.existsSync(path.join(dir, "dist/build.json"))) {
      readProject(dir);
      builtMods++;
    }
  } else readProject(dir);
  sourceMods++;
}
console.log(JSON.stringify({ ok: true, sourceMods, snapshotFiles: Object.keys(state.files).length, builtMods }));
