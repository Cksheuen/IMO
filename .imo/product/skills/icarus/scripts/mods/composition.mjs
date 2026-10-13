import fs from "node:fs";
import path from "node:path";
import { workspaceFor } from "./david-source.mjs";

/** Build-time composition owns no React roots or runtime registry state. */
export function compositionSources(directory, pkg) {
  const files = [],
    versions = {};
  const visiting = new Set(),
    visited = new Set();
  const visit = (dir, current) => {
    const id = path.basename(dir);
    if (visiting.has(id)) throw Error(`Cyclic mod composition: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const children = current.icarusBuild?.composes ?? [];
    if (
      !Array.isArray(children) ||
      new Set(children).size !== children.length ||
      children.some(
        (x) => typeof x !== "string" || !/^[a-z][a-z0-9-]*$/.test(x),
      )
    )
      throw Error("Invalid icarusBuild.composes");
    for (const child of children) {
      const target = path.join(workspaceFor(directory), "mods", child);
      const metadata = path.join(target, "package.json");
      const dependency = JSON.parse(fs.readFileSync(metadata, "utf8"));
      const entry = dependency.icarusBuild?.publicEntry;
      if (
        typeof entry !== "string" ||
        !/^src\/public\.tsx?$/.test(entry) ||
        !fs.existsSync(path.join(target, entry))
      )
        throw Error(`Missing public entry for composed mod: ${child}`);
      files.push(
        metadata,
        path.join(target, "mod.json"),
        path.join(target, entry),
      );
      versions[child] = dependency.version;
      visit(target, dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  visit(directory, pkg);
  return { files: [...new Set(files)], versions };
}
