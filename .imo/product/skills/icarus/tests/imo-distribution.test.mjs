import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catalog, localMods, install } from "../scripts/mods/registry.mjs";
import { buildPlan } from "../scripts/mods/plan.mjs";

test("fresh IMO install uses bundled mods and resolves dependencies without npm", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-imo-portable-"));
  const keys = ["ICARUS_MODS_DIR", "ICARUS_RUNTIME_DIR", "PATH"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.ICARUS_MODS_DIR = path.join(root, "mods");
  process.env.ICARUS_RUNTIME_DIR = path.join(root, "runtime");
  process.env.PATH = path.join(root, "no-executables");
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const mods = localMods();
  assert.deepEqual(mods.errors, []);
  assert.equal(mods.size, 19);
  assert.deepEqual([...mods.keys()].sort(), catalog().map((m) => m.id).sort());
  for (const entry of catalog()) assert.equal(mods.get(entry.id).integrity, entry.integrity);
  const source = path.join(root, "source.html");
  fs.writeFileSync(source, '<div data-icarus-research-workbench></div>');
  const plan = await buildPlan(source);
  assert.deepEqual(plan.missing, []);
  assert.ok(plan.specs.some((m) => m.id === "research-workbench"));
  const installed = await install("research-workbench");
  assert.equal(installed.id, "research-workbench");
  await install("api-contracts");
  assert.ok(fs.existsSync(path.join(root, "mods/react-runtime/mod.json")));
  assert.equal(localMods().get(installed.id).dir, fs.realpathSync(installed.path));
  assert.equal((await install("research-workbench")).unchanged, true);
  const pkgFile = path.join(installed.path, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile));
  pkg.description = "User-owned runtime package";
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  await assert.rejects(install("research-workbench"), /already exists/);
  assert.equal(JSON.parse(fs.readFileSync(pkgFile)).description, pkg.description);
});
