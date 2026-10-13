import fs from "node:fs";
import { davidSource } from "./david-source.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import semver from "semver";
export const MAX_BYTES = 8 * 1024 * 1024;
export const reserved = new Set([
  "core",
  "comments",
  "transport",
  "local-channel",
]);
export const idOK = (id) =>
  typeof id === "string" &&
  /^[a-z][a-z0-9-]{0,63}$/.test(id) &&
  !reserved.has(id);
export function safePath(name) {
  if (
    typeof name !== "string" ||
    name.length > 240 ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.split("/").some((x) => !x || x.startsWith("."))
  )
    throw new Error(`Unsafe mod path: ${name}`);
  return name;
}
export function validateManifest(m) {
  const allowed = [
    "schema",
    "id",
    "version",
    "apiVersion",
    "entry",
    "description",
    "files",
    "requires",
    "detect",
  ];
  if (
    !m ||
    Object.getPrototypeOf(m) !== Object.prototype ||
    Object.keys(m).some((k) => !allowed.includes(k)) ||
    m.schema !== "icarus-mod/v1" ||
    !idOK(m.id) ||
    !semver.valid(m.version) ||
    m.apiVersion !== 1
  )
    throw new Error("Invalid mod manifest / API version");
  if (typeof m.description !== "string" || m.description.length > 1000)
    throw new Error("Invalid mod description");
  if (
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 128 ||
    new Set(m.files).size !== m.files.length ||
    !m.files.includes(m.entry) ||
    !m.entry.endsWith(".mjs")
  )
    throw new Error("Mod files must include an .mjs entry");
  m.files.forEach(safePath);
  if (m.files.some((x) => x === "mod.json" || x === "package.json"))
    throw new Error("Metadata files are implicit");
  if (
    !m.requires ||
    Object.getPrototypeOf(m.requires) !== Object.prototype ||
    Object.entries(m.requires).some(
      ([id, range]) =>
        !idOK(id) ||
        id === m.id ||
        typeof range !== "string" ||
        !semver.validRange(range),
    )
  )
    throw new Error("Invalid mod dependencies");
  if (
    !Array.isArray(m.detect) ||
    m.detect.length > 16 ||
    m.detect.some(
      (rule) =>
        !rule ||
        Object.keys(rule).some((k) => !["tag", "attributes"].includes(k)) ||
        !/^[a-z][a-z0-9-]*$/.test(rule.tag) ||
        !Array.isArray(rule.attributes) ||
        !rule.attributes.length ||
        rule.attributes.some((a) => !/^data-[a-z][a-z0-9-]*$/.test(a)),
    )
  )
    throw new Error("Invalid declarative detection rules");
  return m;
}
export function readMod(dir, { development = false } = {}) {
  dir = path.resolve(dir);
  if (fs.lstatSync(dir).isSymbolicLink())
    throw new Error("Symlink mod directories are not portable");
  const base = fs.realpathSync(dir);
  const read = (name) => {
    safePath(name);
    let current = base;
    for (const part of name.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Symlink in mod: ${name}`);
    }
    const stat = fs.statSync(current);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("Invalid or oversized mod file");
    return fs.readFileSync(current);
  };
  const m = validateManifest(JSON.parse(read("mod.json")));
  const files = new Map([
    ["mod.json", Buffer.from(JSON.stringify(m, null, 2) + "\n")],
  ]);
  for (const name of m.files) files.set(name, read(name));
  let pkg = JSON.parse(read("package.json"));
  if (development && pkg.icarusBuild) {
    const record = JSON.parse(read("dist/build.json"));
    if (
      record.schema !== "icarus-build/v1" ||
      record.output !== createHash("sha256").update(read(m.entry)).digest("hex")
    )
      throw new Error("Build output changed: run icarus mod build");
    if (
      record.compiler !==
      createHash("sha256")
        .update(fs.readFileSync(new URL("./build.mjs", import.meta.url)))
        .digest("hex")
    )
      throw new Error("Build compiler changed: run icarus mod build");
    for (const file of [
      "david-source.mjs",
      "david-frame.mjs",
      "manifest.mjs",
      "composition.mjs",
    ]) {
      if (
        record.toolchain?.[file] !==
        createHash("sha256")
          .update(fs.readFileSync(new URL(file, import.meta.url)))
          .digest("hex")
      )
        throw new Error("Build toolchain changed: run icarus mod build");
    }
    for (const [input, expected] of Object.entries(record.inputs)) {
      const file = input.startsWith("@david/")
        ? path.join(davidSource(base).root, "src", input.slice(7))
        : path.resolve(base, input);
      if (
        !fs.existsSync(file) ||
        createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
          expected
      )
        throw new Error(`Source changed (${input}): run icarus mod build`);
    }
    pkg = {
      name: pkg.name,
      version: pkg.version,
      type: "module",
      description: pkg.description,
      files: ["mod.json", ...m.files],
      exports: "./" + m.entry,
      publishConfig: pkg.publishConfig,
      license: pkg.license,
    };
  }
  if (pkg.icarusBuild)
    throw new Error(
      "Install a prepared mod package; authoring metadata must be removed before distribution",
    );
  if (
    !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(pkg.name) ||
    pkg.version !== m.version ||
    pkg.type !== "module" ||
    pkg.scripts ||
    pkg.dependencies ||
    pkg.optionalDependencies ||
    pkg.bin
  )
    throw new Error(
      "Mod package must be prebundled ESM, matching version, without scripts or runtime npm dependencies",
    );
  if (
    !Array.isArray(pkg.files) ||
    JSON.stringify([...pkg.files].sort()) !==
      JSON.stringify(["mod.json", ...m.files].sort())
  )
    throw new Error("package.files must match mod.json files");
  files.set("package.json", Buffer.from(JSON.stringify(pkg, null, 2) + "\n"));
  if ([...files.values()].reduce((n, b) => n + b.length, 0) > MAX_BYTES)
    throw new Error("Mod exceeds size limit");
  const h = createHash("sha256");
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    h.update(name + "\0")
      .update(bytes)
      .update("\0");
  return {
    dir: base,
    manifest: m,
    package: pkg,
    files,
    integrity: h.digest("hex"),
  };
}

export const readProject = (dir) => readMod(dir, { development: true });
