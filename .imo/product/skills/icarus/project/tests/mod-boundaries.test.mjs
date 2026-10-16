import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkImport,
  checkModBoundaries,
} from "../scripts/check-mod-boundaries.mjs";
import { compositionSources } from "../../scripts/mods/composition.mjs";
const root = process.cwd(),
  importer = path.join(
    root,
    "mods/research-workbench/src/ResearchWorkbench.tsx",
  );
test("a composite uses declared public feature entries and cannot reach sibling internals", () => {
  assert.ok(checkModBoundaries(root).checked > 20);
  assert.throws(
    () =>
      checkImport(
        "research-workbench",
        "@david/components/CodeBlock.tsx",
        importer,
        root,
      ),
    /bypasses rich-code/,
  );
  assert.throws(
    () =>
      checkImport(
        "research-workbench",
        "@david/components/CodeBlock",
        importer,
        root,
      ),
    /bypasses rich-code/,
  );
  assert.throws(
    () =>
      checkImport(
        "research-workbench",
        "../../rich-code/src/index",
        importer,
        root,
        { composes: ["rich-code"] },
      ),
    /public entry/,
  );
  assert.throws(
    () =>
      checkImport(
        "research-workbench",
        "../../rich-code/src/public",
        importer,
        root,
      ),
    /declare composes/,
  );
  assert.doesNotThrow(() =>
    checkImport(
      "research-workbench",
      "../../rich-code/src/public",
      importer,
      root,
      { composes: ["rich-code"] },
    ),
  );
  assert.doesNotThrow(() =>
    checkImport(
      "research-workbench",
      "@david/components/comment/CommentRail",
      importer,
      root,
    ),
  );
});
test("composition records dependency metadata and rejects cycles before bundling", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-composition-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(temp, "package.json"),
    JSON.stringify({ name: "icarus-workspace" }),
  );
  const pkg = (composes) => ({
    version: "0.1.0",
    icarusBuild: { publicEntry: "src/public.ts", composes },
  });
  for (const [id, deps] of [
    ["a", ["b"]],
    ["b", []],
  ]) {
    const dir = path.join(temp, "mods", id);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg(deps)));
    fs.writeFileSync(path.join(dir, "mod.json"), "{}");
    fs.writeFileSync(path.join(dir, "src/public.ts"), "export const value=1;");
  }
  const found = compositionSources(path.join(temp, "mods/a"), pkg(["b"]));
  assert.equal(found.versions.b, "0.1.0");
  assert.ok(found.files.includes(path.join(temp, "mods/b/package.json")));
  fs.writeFileSync(
    path.join(temp, "mods/b/package.json"),
    JSON.stringify(pkg(["a"])),
  );
  assert.throws(
    () => compositionSources(path.join(temp, "mods/a"), pkg(["b"])),
    /Cyclic mod composition/,
  );
});
