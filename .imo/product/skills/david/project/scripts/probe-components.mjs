#!/usr/bin/env node
/**
 * Probe review spec component sources before claiming high fidelity.
 * It is intentionally read-only: it never edits the review spec or source repo.
 */
import fs from "node:fs";
import path from "node:path";

const [specPath, ...args] = process.argv.slice(2);
if (!specPath) {
  console.error(
    "usage: node probe-components.mjs <review.json> [--out report.json]",
  );
  process.exit(2);
}
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const specDir = path.dirname(path.resolve(specPath));
const declaredSource = spec.sourcePath
  ? path.resolve(specDir, spec.sourcePath)
  : specDir;
const sourceRoot =
  spec.sourcePath &&
  fs.existsSync(declaredSource) &&
  fs.statSync(declaredSource).isFile()
    ? path.dirname(declaredSource)
    : declaredSource;
const components = [];
for (const component of spec.components ?? []) {
  const source = component.source;
  if (!source) {
    components.push({
      id: component.id,
      status: "unconfigured",
      kind: "unknown",
      paths: [],
    });
    continue;
  }
  const paths = Array.isArray(source.codePaths) ? source.codePaths : [];
  const probes = paths.map((file) => {
    const absolute = path.resolve(sourceRoot, file);
    const exists = fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    return { path: file, absolute, exists };
  });
  const matched =
    source.kind === "component" &&
    probes.length > 0 &&
    probes.every((p) => p.exists);
  components.push({
    id: component.id,
    kind: source.kind,
    fidelity: source.fidelity ?? null,
    status: matched
      ? "matched"
      : source.kind === "css-art"
        ? "css-art"
        : "missing",
    paths: probes,
    suggestedRecipe: matched ? `component-snapshot:${component.id}` : null,
  });
}
const report = {
  schema: "david-component-probe/v1",
  spec: path.resolve(specPath),
  sourceRoot,
  checkedAt: new Date().toISOString(),
  components,
  ok: components.every((c) => c.status === "matched" || c.status === "css-art"),
};
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
