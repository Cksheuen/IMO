import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import semver from "semver";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readMod, readProject, idOK } from "./manifest.mjs";
import { bundleMod } from "./bundle.mjs";
import { unpack, packZip } from "./archive.mjs";
export const skillRoot = fileURLToPath(new URL("../../", import.meta.url));
export const bundledModsRoot = path.join(skillRoot, "mods");
export const modsRoot = () =>
  path.resolve(
    process.env.ICARUS_MODS_DIR || path.join(os.homedir(), ".icarus/mods"),
  );
export const workspaceRoot = fileURLToPath(
  new URL("../../../../", import.meta.url),
);
export function catalog() {
  const f = path.join(skillRoot, "mod-catalog.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).mods : [];
}
export function localMods() {
  const found = new Map();
  found.errors = [];
  const roots = [bundledModsRoot, modsRoot()];
  const marker = path.join(workspaceRoot, "package.json");
  if (
    fs.existsSync(marker) &&
    JSON.parse(fs.readFileSync(marker, "utf8")).name === "icarus-workspace" &&
    path.resolve(workspaceRoot, "skills/icarus") === path.resolve(skillRoot)
  )
    roots.unshift(path.join(workspaceRoot, "mods"));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs
      .readdirSync(root, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        !entry.isDirectory() ||
        !idOK(entry.name) ||
        !fs.existsSync(path.join(root, entry.name, "mod.json"))
      )
        continue;
      try {
        const mod =
          root === modsRoot() || root === bundledModsRoot
            ? readMod(path.join(root, entry.name))
            : readProject(path.join(root, entry.name));
        if (mod.manifest.id !== entry.name)
          throw new Error("Mod directory must match its id");
        found.set(entry.name, mod);
      } catch (error) {
        found.errors.push({ id: entry.name, error: error.message });
      }
    }
  }
  return found;
}
export function npm(args, cwd) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    args,
    {
      cwd,
      encoding: "utf8",
      shell: false,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120000,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `npm ${args[0]} failed: ${(result.stderr || result.error?.message || "").slice(-1500)}`,
    );
  return result.stdout;
}
function withLock(root, fn) {
  fs.mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".install-lock");
  try {
    fs.mkdirSync(lock);
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error("Another mod installation is active; retry later");
    throw e;
  }
  try {
    return fn();
  } finally {
    fs.rmdirSync(lock);
  }
}
export function copyMod(mod, destination, { replace = false } = {}) {
  const root = path.dirname(destination);
  return withLock(root, () => {
    if (fs.existsSync(destination)) {
      const old = readMod(destination);
      if (old.integrity === mod.integrity) return { unchanged: true };
      if (!replace)
        throw new Error(
          "Mod already exists; use --replace for an intentional upgrade",
        );
      if (old.manifest.version === mod.manifest.version)
        throw new Error("Changed mod content requires a new version");
    }
    const staged = path.join(root, ".new-" + randomUUID()),
      backup = path.join(root, ".old-" + randomUUID());
    fs.mkdirSync(staged);
    try {
      for (const [rel, data] of mod.files) {
        const out = path.join(staged, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, data);
      }
      const existed = fs.existsSync(destination);
      if (existed) fs.renameSync(destination, backup);
      try {
        fs.renameSync(staged, destination);
      } catch (e) {
        if (existed) fs.renameSync(backup, destination);
        throw e;
      }
      if (existed) fs.rmSync(backup, { recursive: true });
      return { unchanged: false };
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  });
}
export async function install(
  input,
  { replace = false, registry, chain = [] } = {},
) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-mod-install-"));
  try {
    let folder = path.resolve(input),
      expected;
    if (!fs.existsSync(folder)) {
      expected = catalog().find((m) => m.id === input);
      const bundled = path.join(bundledModsRoot, input);
      if (expected && idOK(input) && fs.existsSync(path.join(bundled, "mod.json")))
        folder = bundled;
    }
    if (!fs.existsSync(folder)) {
      const spec = expected ? expected.package + "@" + expected.version : input;
      if (
        !/^(@[a-z0-9-]+\/)?[a-z0-9-]+@\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(
          spec,
        )
      )
        throw new Error(
          "Use a catalog id, local folder/archive, or an exact npm package@version",
        );
      const report = JSON.parse(
        npm(
          [
            "pack",
            spec,
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            temp,
            "--registry",
            registry || expected?.registry || "https://registry.npmjs.org",
          ],
          temp,
        ),
      );
      const filename = path.basename(report[0].filename);
      folder = path.join(temp, filename);
    }
    let archive = false;
    if (fs.statSync(folder).isFile()) {
      archive = true;
      const target = path.join(temp, "unpacked");
      fs.mkdirSync(target);
      await unpack(folder, target);
      folder = target;
    }
    const mod = archive ? readMod(folder) : readProject(folder);
    await bundleMod(mod);
    if (
      expected &&
      (mod.integrity !== expected.integrity ||
        mod.manifest.id !== expected.id ||
        mod.manifest.version !== expected.version)
    )
      throw new Error("Downloaded mod does not match catalog integrity");
    if (chain.includes(mod.manifest.id))
      throw new Error(
        "Cyclic mod dependencies: " + [...chain, mod.manifest.id].join(" -> "),
      );
    const dependencies = [];
    for (const [id, range] of Object.entries(mod.manifest.requires)) {
      const installed = path.join(modsRoot(), id);
      if (
        fs.existsSync(installed) &&
        semver.satisfies(readMod(installed).manifest.version, range)
      )
        continue;
      const local = localMods().get(id),
        entry = catalog().find((x) => x.id === id);
      const candidate =
        local && semver.satisfies(local.manifest.version, range)
          ? local.dir
          : entry && semver.satisfies(entry.version, range)
            ? id
            : null;
      if (!candidate)
        throw new Error(`Install dependency ${id}@${range} first`);
      dependencies.push(
        await install(candidate, {
          replace,
          registry,
          chain: [...chain, mod.manifest.id],
        }),
      );
    }
    const dest = path.join(modsRoot(), mod.manifest.id);
    const result = copyMod(mod, dest, { replace });
    return {
      id: mod.manifest.id,
      version: mod.manifest.version,
      integrity: mod.integrity,
      path: dest,
      dependencies,
      ...result,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
export async function pack(folder, output) {
  const mod = readProject(folder);
  await bundleMod(mod);
  return {
    path: packZip(mod, output),
    id: mod.manifest.id,
    version: mod.manifest.version,
    integrity: mod.integrity,
  };
}
export async function updateCatalog(
  workspace = workspaceRoot,
  { check = false } = {},
) {
  const mods = [];
  for (const name of fs.readdirSync(path.join(workspace, "mods")).sort()) {
    const dir = path.join(workspace, "mods", name);
    if (
      !fs.statSync(dir).isDirectory() ||
      !fs.existsSync(path.join(dir, "mod.json"))
    )
      continue;
    const mod = readProject(dir);
    if (name !== mod.manifest.id)
      throw new Error("Folder name and mod id differ");
    await bundleMod(mod);
    mods.push({
      ...mod.manifest,
      package: mod.package.name,
      registry: mod.package.publishConfig?.registry || "https://registry.npmjs.org",
      integrity: mod.integrity,
    });
  }
  const text =
    JSON.stringify({ schema: "icarus-catalog/v1", mods }, null, 2) + "\n";
  for (const file of [
    path.join(workspace, "mods/catalog.json"),
    path.join(workspace, "skills/icarus/mod-catalog.json"),
  ]) {
    if (check) {
      if (fs.readFileSync(file, "utf8") !== text)
        throw new Error("Catalog stale: run npm run catalog");
    } else fs.writeFileSync(file, text);
  }
  return { mods: mods.map((x) => x.id) };
}

/** Materialize only validated runtime files; npm must never pack authoring scripts. */
export function preparePackage(mod) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-prepared-"));
  try {
    for (const [rel, data] of mod.files) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    }
    readMod(dir);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
/** Keep editable source in the repository, distribute only prepared runtime bytes. */
export async function contributeProject(mod, destination, options = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(mod.dir, "package.json")));
  if (!pkg.icarusBuild) return copyMod(mod, destination, options);
  if (path.resolve(mod.dir) === path.resolve(destination))
    return { unchanged: true };
  if (fs.existsSync(destination)) {
    const previous = readProject(destination);
    if (previous.integrity === mod.integrity) return { unchanged: true };
    if (!options.replace) throw new Error("Mod already exists; use --replace");
    if (previous.manifest.version === mod.manifest.version)
      throw new Error("Changed mod content requires a new version");
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-source-"));
  const backup = destination + ".backup-" + randomUUID();
  let existed = false;
  try {
    // Source contribution uses the explicit src tree. Never copy local node_modules or credentials.
    const copy = (from, to) => {
      if (fs.lstatSync(from).isSymbolicLink())
        throw new Error("Symlink source is not portable");
      if (fs.statSync(from).isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        for (const name of fs.readdirSync(from)) {
          if (name.startsWith("."))
            throw new Error("Hidden source files are not portable");
          copy(path.join(from, name), path.join(to, name));
        }
      } else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
    };
    for (const rel of ["src", "mod.json", "package.json"])
      copy(path.join(mod.dir, rel), path.join(temp, rel));
    for (const rel of ["README.md", "LICENSE", "tsconfig.json"])
      if (fs.existsSync(path.join(mod.dir, rel)))
        copy(path.join(mod.dir, rel), path.join(temp, rel));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    existed = fs.existsSync(destination);
    if (existed) fs.renameSync(destination, backup);
    fs.renameSync(temp, destination);
    const { buildMod } = await import("./build.mjs");
    await buildMod(destination);
    if (readProject(destination).integrity !== mod.integrity)
      throw new Error(
        "Contribution is not reproducible in destination workspace; include required source dependencies",
      );
    if (existed) fs.rmSync(backup, { recursive: true });
    return { unchanged: false };
  } catch (error) {
    if (fs.existsSync(backup)) {
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(backup, destination);
    } else if (!fs.existsSync(temp))
      fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
