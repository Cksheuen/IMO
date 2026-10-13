#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { args, list, known } from "./mods/args.mjs";
import { readProject, idOK } from "./mods/manifest.mjs";
import { bundleMod } from "./mods/bundle.mjs";
import {
  install,
  pack,
  catalog,
  localMods,
  contributeProject,
  preparePackage,
  updateCatalog,
  npm,
} from "./mods/registry.mjs";
import { enable, recommend, readPlan, writePlan } from "./mods/plan.mjs";
import { documentId, hash } from "./local/store.mjs";
const [command, ...rest] = process.argv.slice(2),
  { positional: p, opts: o } = args(rest, [
    "replace",
    "auto",
    "stage",
    "all",
    "execute",
  ]);
const print = (value) => console.log(JSON.stringify(value, null, 2));
const target = () => {
  if (!p[0]) throw new Error("Missing source path / mod");
  return p[0];
};
switch (command) {
  case "build": {
    known(o, []);
    const { buildMod } = await import("./mods/build.mjs");
    print(await buildMod(target()));
    break;
  }
  case "data": {
    known(o, []);
    const { configuration } = await import("./local/store.mjs");
    const { ensureService } = await import("./local/service.mjs");
    const source = target(),
      id = /^[a-f0-9]{32}$/.test(source) ? source : documentId(source);
    if (!idOK(p[1]))
      throw new Error("Usage: mod data <source.html|document-id> <mod-id>");
    const config = configuration(id),
      service = await ensureService();
    const response = await fetch(`${service.baseUrl}/mod-data/${id}/${p[1]}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error);
    print({ documentId: id, mod: p[1], ...state });
    break;
  }
  case "list":
    known(o, []);
    print({
      invalid: localMods().errors,
      installed: [...localMods().values()].map((m) => ({
        id: m.manifest.id,
        version: m.manifest.version,
        path: m.dir,
      })),
      available: catalog().map(
        ({ id, version, description, package: pkg }) => ({
          id,
          version,
          description,
          package: pkg,
        }),
      ),
    });
    break;
  case "recommend":
    known(o, []);
    print(recommend(target()));
    break;
  case "init": {
    known(o, ["out"]);
    const id = target();
    if (!idOK(id) || !o.out)
      throw new Error("Usage: mod init my-mod --out ./my-mod");
    const dir = path.resolve(o.out);
    fs.mkdirSync(dir, { recursive: false });
    const m = {
      schema: "icarus-mod/v1",
      id,
      version: "0.1.0",
      apiVersion: 1,
      description: `Enhance [data-${id}] elements`,
      entry: "index.mjs",
      files: ["index.mjs"],
      requires: {},
      detect: [{ tag: "div", attributes: ["data-" + id] }],
    };
    fs.writeFileSync(
      path.join(dir, "mod.json"),
      JSON.stringify(m, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@imo/icarus-mod-" + id,
          version: m.version,
          type: "module",
          files: ["mod.json", "index.mjs"],
          exports: "./index.mjs",
          publishConfig: { registry: "https://registry.npmjs.org" },
          license: "MIT",
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "index.mjs"),
      `export default {\n  id: ${JSON.stringify(id)}, apiVersion: 1, requires: [],\n  mount({root,onCleanup}) {\n    for(const target of root.querySelectorAll('[data-${id}]')) {\n      const note=document.createElement('span');note.textContent='${id}';note.dataset.icarusMod='${id}';target.append(note);\n      onCleanup(()=>note.remove());\n    }\n  },\n};\n`,
    );
    print({ created: dir });
    break;
  }
  case "validate": {
    known(o, []);
    const m = readProject(target());
    await bundleMod(m);
    print({
      valid: true,
      id: m.manifest.id,
      version: m.manifest.version,
      integrity: m.integrity,
    });
    break;
  }
  case "pack":
    known(o, ["out"]);
    if (!o.out) throw new Error("pack requires --out file.zip");
    print(await pack(target(), o.out));
    break;
  case "install":
    known(o, ["replace", "registry"]);
    print(await install(target(), o));
    break;
  case "enable":
    known(o, ["mods", "auto", "exclude", "options"]);
    print(
      await enable(target(), {
        ids: list(o.mods),
        auto: o.auto || o.mods === undefined,
        exclude: list(o.exclude),
        options: o.options
          ? JSON.parse(fs.readFileSync(o.options, "utf8"))
          : {},
      }),
    );
    break;
  case "disable": {
    known(o, ["mods", "all"]);
    if (!o.all && !o.mods)
      throw new Error("disable requires --mods id or --all");
    const source = target(),
      id = /^[a-f0-9]{32}$/.test(source) ? source : documentId(source);
    const plan = readPlan(id);
    if (!plan) throw new Error("No mod plan");
    const removed = new Set(o.all ? plan.specs.map((x) => x.id) : list(o.mods));
    for (const id of removed)
      if (!idOK(id)) throw new Error("Core capabilities cannot be disabled");
    const specs = plan.specs.filter((x) => !removed.has(x.id));
    if (specs.some((x) => x.requires.some((id) => removed.has(id))))
      throw new Error("Another active mod depends on this mod");
    const next = {
      ...plan,
      specs,
      decisions: plan.decisions.filter((x) => !removed.has(x.id)),
    };
    delete next.revision;
    next.revision = hash(JSON.stringify(next));
    writePlan(id, next);
    print({
      documentId: id,
      mods: specs.map((x) => x.id),
      revision: next.revision,
    });
    break;
  }
  case "contribute": {
    known(o, ["repo", "replace", "stage"]);
    if (!o.repo)
      throw new Error("contribute requires --repo /path/to/marketplace");
    const root = path.resolve(o.repo),
      workspace = path.join(root, "plugins/icarus");
    if (!fs.existsSync(path.join(workspace, "package.json")))
      throw new Error("Repository has no Icarus workspace");
    const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
    });
    if (
      git.status !== 0 ||
      fs.realpathSync(git.stdout.trim()) !== fs.realpathSync(root)
    )
      throw new Error("--repo must be the Git root");
    const mod = readProject(target());
    await bundleMod(mod);
    const destination = path.join(workspace, "mods", mod.manifest.id);
    await contributeProject(mod, destination, o);
    await updateCatalog(workspace);
    npm(
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
      ],
      workspace,
    );
    const paths = [
      `plugins/icarus/mods/${mod.manifest.id}`,
      "plugins/icarus/mods/catalog.json",
      "plugins/icarus/skills/icarus/mod-catalog.json",
      "plugins/icarus/package-lock.json",
    ];
    if (o.stage) {
      const result = spawnSync("git", ["add", "--", ...paths], {
        cwd: root,
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr);
    }
    print({
      ready: true,
      path: destination,
      staged: !!o.stage,
      paths,
      next: "Review the staged diff, then commit and push using your normal repository workflow. No commit or push was performed.",
    });
    break;
  }
  case "publish": {
    known(o, ["registry", "execute"]);
    const mod = readProject(target());
    await bundleMod(mod);
    const registry = o.registry || mod.package.publishConfig?.registry;
    if (!registry) throw new Error("Specify --registry");
    if (o.execute) {
      const prepared = preparePackage(mod);
      try {
        print({
          published: true,
          output: npm(
            [
              "publish",
              prepared.dir,
              "--ignore-scripts",
              "--registry",
              registry,
            ],
            prepared.dir,
          ),
        });
      } finally {
        prepared.close();
      }
    } else
      print({
        published: false,
        package: mod.package,
        integrity: mod.integrity,
        command: [
          "icarus",
          "mod",
          "publish",
          mod.dir,
          "--registry",
          registry,
          "--execute",
        ],
        next: "Review the normalized package, then repeat with --execute to publish.",
      });
    break;
  }
  default:
    throw new Error(
      "Commands: list | recommend | init | build | data | validate | pack | install | enable | disable | contribute | publish",
    );
}
