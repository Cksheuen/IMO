import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { parse } from "parse5";
import { init, parse as parseModule } from "es-module-lexer";
import { catalog, localMods } from "./registry.mjs";
import { bundleMod } from "./bundle.mjs";
import {
  atomicJSON,
  configuration,
  documentId,
  hash,
  runtimeRoot,
} from "../local/store.mjs";
/** HTML data is matched structurally; it cannot provide code URLs or install requests. */
export function detect(html, manifests) {
  const nodes = [];
  const walk = (n) => {
    if (n.tagName && !["script", "style", "template"].includes(n.tagName))
      nodes.push(n);
    if (["script", "style", "template"].includes(n.tagName)) return;
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(parse(html));
  return manifests
    .filter((m) =>
      m.detect.some((rule) =>
        nodes.some(
          (n) =>
            n.tagName === rule.tag &&
            rule.attributes.every((a) => n.attrs.some((x) => x.name === a)),
        ),
      ),
    )
    .map((m) => ({
      id: m.id,
      reason:
        "HTML matches " +
        m.detect
          .map((x) => x.tag + x.attributes.map((a) => `[${a}]`).join(""))
          .join(" or "),
    }));
}
export function recommend(source) {
  const local = localMods(),
    known = new Map(catalog().map((m) => [m.id, m]));
  for (const [id, m] of local) known.set(id, m.manifest);
  return detect(fs.readFileSync(source, "utf8"), [...known.values()]).map(
    (m) => ({ ...m, installed: local.has(m.id) }),
  );
}
export async function buildPlan(
  source,
  { ids = [], auto = true, exclude = [], options = {} } = {},
) {
  const local = localMods(),
    selected = new Set(ids),
    decisions = ids.map((id) => ({ id, reason: "explicit" })),
    missing = [];
  if (auto)
    for (const match of recommend(source)) {
      if (exclude.includes(match.id)) continue;
      if (match.installed) {
        selected.add(match.id);
        decisions.push(match);
      } else missing.push(match);
    }
  for (const id of exclude) selected.delete(id);
  const ordered = [],
    visiting = new Set(),
    visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Cyclic mod dependencies");
    const mod = local.get(id);
    if (!mod)
      throw new Error(
        `Mod ${id} is not installed; run icarus mod install ${id}`,
      );
    visiting.add(id);
    for (const [dep, range] of Object.entries(mod.manifest.requires)) {
      if (exclude.includes(dep))
        throw new Error(`${id} needs excluded mod ${dep}`);
      const dependency = local.get(dep);
      if (!dependency || !semver.satisfies(dependency.manifest.version, range))
        throw new Error(
          `${id} requires ${dep}@${range}; install a compatible version`,
        );
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(mod);
  };
  [...selected].sort().forEach(visit);
  const specs = [];
  await init;
  for (const mod of ordered) {
    const url = await bundleMod(mod);
    const code = Buffer.from(url.split(",")[1], "base64").toString("utf8");
    const imports = parseModule(code)[0]
      .filter((x) => x.n?.startsWith("icarus:"))
      .map((x) => ({
        id: x.n.slice(7),
        start: x.s,
        end: x.e,
        dynamic: x.d >= 0,
      }));
    specs.push({
      id: mod.manifest.id,
      version: mod.manifest.version,
      apiVersion: 1,
      requires: Object.keys(mod.manifest.requires),
      url,
      imports,
      options: options[mod.manifest.id] ?? {},
      integrity: mod.integrity,
    });
  }
  const payload = {
    schema: "icarus-mod-plan/v1",
    specs,
    decisions,
    missing,
    warnings: local.errors,
  };
  const revision = hash(JSON.stringify(payload));
  return { ...payload, revision };
}
export function writePlan(id, plan, root = runtimeRoot()) {
  configuration(id, root);
  atomicJSON(path.join(root, "mod-plans", id + ".json"), plan);
}
export function readPlan(id, root = runtimeRoot()) {
  configuration(id, root);
  const file = path.join(root, "mod-plans", id + ".json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
}
export async function enable(source, options) {
  const id = /^[a-f0-9]{32}$/.test(source) ? source : documentId(source);
  const config = configuration(id);
  const plan = await buildPlan(config.source.path, options);
  writePlan(id, plan);
  return {
    documentId: id,
    revision: plan.revision,
    mods: plan.specs.map((m) => m.id),
    decisions: plan.decisions,
    missing: plan.missing,
  };
}
