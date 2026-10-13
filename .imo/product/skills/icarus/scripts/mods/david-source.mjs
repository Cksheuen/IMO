import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function workspaceFor(start) {
  let dir = path.resolve(start);
  while (true) {
    const file = path.join(dir, "package.json");
    if (
      fs.existsSync(file) &&
      JSON.parse(fs.readFileSync(file)).name === "icarus-workspace"
    )
      return dir;
    const next = path.dirname(dir);
    if (next === dir)
      throw Error("David source builds require an Icarus workspace");
    dir = next;
  }
}
export function davidSource(start) {
  const workspace = workspaceFor(start),
    local = path.join(workspace, ".icarus-david.local.json");
  const requested = process.env.ICARUS_DAVID_SOURCE;
  const linked =
    requested && requested !== "snapshot"
      ? requested
      : requested === "snapshot"
        ? null
        : fs.existsSync(local)
          ? JSON.parse(fs.readFileSync(local)).sourceRoot
          : null;
  const root = fs.realpathSync(
    linked ?? path.join(workspace, "packages/david-source"),
  );
  if (!fs.existsSync(path.join(root, "src/app/App.tsx")))
    throw Error("David project/src/app/App.tsx is missing");
  return { workspace, root, mode: linked ? "linked" : "snapshot" };
}
export function sourceFiles(root) {
  const files = {};
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name),
        rel = path.relative(root, file).split(path.sep).join("/");
      if (item.isSymbolicLink())
        throw Error("Symlink inside David source: " + rel);
      if (item.isDirectory()) {
        if (item.name !== "samples") walk(file);
      } else if (!["src/main.tsx", "src/vite-env.d.ts"].includes(rel))
        files[rel] = sha(fs.readFileSync(file));
    }
  };
  walk(path.join(root, "src"));
  return Object.fromEntries(Object.entries(files).sort());
}
export function sourceState(root) {
  const files = sourceFiles(root);
  return {
    schema: "icarus-david-source/v2",
    sha256: sha(JSON.stringify(files)),
    files,
  };
}
export function davidPlugin(source, { portals = false } = {}) {
  const loaded = new Map();
  return {
    loaded,
    plugin: {
      name: "david-source",
      setup(build) {
        // Preserve the original transport implementation; replace only its daemon-start hint.
        build.onResolve({ filter: /feedbackTransport(?:\.ts)?$/ }, (args) => {
          if (
            args.importer.startsWith(source.root + path.sep) &&
            path.resolve(args.resolveDir, args.path).replace(/\.ts$/, "") ===
              path.join(source.root, "src/lib/feedbackTransport")
          )
            return {
              path: "transport-hint",
              namespace: "icarus-david-transport",
            };
        });
        build.onLoad(
          { filter: /.*/, namespace: "icarus-david-transport" },
          () => ({
            loader: "js",
            resolveDir: source.workspace,
            contents: `export * from ${JSON.stringify(path.join(source.root, "src/lib/feedbackTransport.ts"))};export const feedbackServeHint=()=>"Icarus 本机评论服务连接失败，请检查本页的服务并运行 icarus service restart；使用本页 document-id 读取评论，保留原数据目录。服务地址："+(globalThis.__ICARUS_DAVID__?.baseUrl??"当前 Icarus 通道");`,
          }),
        );
        build.onResolve({ filter: /^@david\// }, (args) => {
          const base = path.join(source.root, "src", args.path.slice(7));
          const file = ["", ".ts", ".tsx", ".css", "/index.ts", "/index.tsx"]
            .map((ext) => base + ext)
            .find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
          if (!file) throw Error("David export missing: " + args.path);
          return { path: file };
        });
        if (portals) {
          build.onResolve({ filter: /^react-dom$/ }, (args) =>
            args.importer.startsWith(source.root + path.sep)
              ? { path: "portal", namespace: "icarus-david-portal" }
              : undefined,
          );
          build.onLoad(
            { filter: /.*/, namespace: "icarus-david-portal" },
            () => ({
              loader: "js",
              resolveDir: source.workspace,
              contents: `export {createPortal} from ${JSON.stringify(path.join(source.workspace, "packages/david-shared/src/portal.tsx"))};export {flushSync} from 'icarus:react-runtime';`,
            }),
          );
        }
        build.onLoad({ filter: /\.(tsx?|css)$/ }, (args) => {
          if (!args.path.startsWith(source.root + path.sep)) return;
          const contents = fs.readFileSync(args.path, "utf8");
          loaded.set(args.path, sha(contents));
          const adapted =
            portals &&
            args.path === path.join(source.root, "src/lib/feedbackTransport.ts")
              ? `import {fetch} from ${JSON.stringify(path.join(source.workspace, "packages/david-shared/src/native-channel.ts"))};\n${contents}`
              : contents;
          return {
            contents: adapted,
            loader: args.path.endsWith(".tsx")
              ? "tsx"
              : args.path.endsWith(".css")
                ? "css"
                : "ts",
          };
        });
      },
    },
  };
}
export function verifyLoaded(loaded) {
  for (const [file, hash] of loaded)
    if (sha(fs.readFileSync(file)) !== hash)
      throw Error("David changed during build; retry: " + file);
}
