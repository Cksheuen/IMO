import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));
const list = (...args) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-tests.mjs", ...args, "--list"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
for (const file of [
  "scripts/render-review.mjs",
  "../scripts/render-review.mjs",
  "src/components/deleted-control.tsx",
]) {
  const output = list("--files", file);
  assert.match(output, /widening to whole/);
  assert.match(output, /david-model/);
  assert.match(output, /change-block/);
}
const child = list(
  "--files",
  "scripts/test-dock-scale.mjs",
  "--layer",
  "browser",
);
assert.match(child, /browser \(\d+\):[^\n]*\bui-regressions\b/);
assert.doesNotMatch(child, /browser \(\d+\):[^\n]*\bdock-scale\b/);
for (const component of ["DockPanel", "CanvasViewport", "GraphOverlay"]) {
  const output = list("--component", component, "--layer", "browser");
  assert.match(output, /browser \(\d+\):/);
  assert.doesNotMatch(output, /no affected tests/);
}
const dedup = list(
  "--id",
  "ui-regressions",
  "fullpage-host",
  "--layer",
  "browser",
);
assert.match(dedup, /browser \(\d+\):[^\n]*\bui-regressions\b/);
assert.doesNotMatch(dedup, /browser \(\d+\):[^\n]*\bfullpage-host\b/);
assert.match(
  list("--id", "fullpage-host", "--layer", "browser"),
  /browser \(\d+\):[^\n]*\bfullpage-host\b/,
);
const browser = list("--layer", "browser");
assert.doesNotMatch(browser, / {2}(unit|ssr) \(\d+\):/);
assert.match(browser, /browser \(\d+\):/);
assert.equal(
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)))
    .scripts["test:browser"],
  "node scripts/run-tests.mjs --layer browser",
);
const aggregator = fs.readFileSync(
  new URL("test-ui-regressions.mjs", import.meta.url),
  "utf8",
);
assert.ok(!aggregator.includes('"scripts/test-presentation.mjs"'));
assert.ok(!aggregator.includes('"scripts/test-rich-review.mjs"'));
console.log(
  "runner: render entry points, deleted files, aggregator child edits, component closure, standalone selection and layer dedup passed",
);
