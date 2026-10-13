import fs from "node:fs";
import {
  davidSource,
  davidPlugin,
  verifyLoaded,
  sourceState,
} from "./david-source.mjs";
import { buildDavidFrame } from "./david-frame.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { validateManifest, safePath, readProject } from "./manifest.mjs";
import { compositionSources } from "./composition.mjs";
const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export function scopeCss(css, id) {
  const scope = `:where([data-icarus-david-root="${id}"])`;
  const tree = postcss.parse(css);
  const names = new Map();
  tree.walkAtRules((rule) => {
    if (/keyframes$/i.test(rule.name)) {
      const name = rule.params.trim();
      const replacement = "icarus-" + id + "-" + name;
      names.set(name, replacement);
      rule.params = replacement;
    }
  });
  tree.walkDecls((decl) => {
    if (!/^(?:-webkit-)?animation(?:-name)?$/.test(decl.prop)) return;
    decl.value = decl.value.replace(
      /[a-zA-Z_][a-zA-Z0-9_-]*/g,
      (word) => names.get(word) ?? word,
    );
  });
  tree.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      return;
    rule.selector = selectorParser((list) => {
      list.each((selector) => {
        let rewroteRoot = false;
        selector.walkTags((n) => {
          if (n.value === "html" || n.value === "body") {
            rewroteRoot = true;
            n.replaceWith(selectorParser.pseudo({ value: scope }));
          }
        });
        selector.walkPseudos((n) => {
          if (n.value === ":root") {
            rewroteRoot = true;
            n.value = scope;
          }
        });
        // html/body are two document ancestors but one mod host. Do not emit
        // a selector requiring two nested hosts for `html body .content`.
        while (
          selector.nodes[0]?.toString() === scope &&
          selector.nodes[1]?.type === "combinator" &&
          selector.nodes[1]?.value.trim() === "" &&
          selector.nodes[2]?.toString() === scope
        ) {
          selector.nodes[2].remove();
          selector.nodes[1].remove();
        }
        if (!selector.toString().includes(scope)) {
          selector.prepend(selectorParser.combinator({ value: " " }));
          selector.prepend(selectorParser.pseudo({ value: scope }));
        }
        if (rewroteRoot) {
          // Root references inside :is/:not, or before a sibling combinator,
          // do not prove that the selector's *subject* belongs to the mod.
          const guard = selectorParser.pseudo({
            value: `:where(${scope}, ${scope} *)`,
          });
          const pseudoElement = selector.nodes.find(
            (n) =>
              n.type === "pseudo" &&
              /^(::|:(before|after|first-line|first-letter)$)/.test(n.value),
          );
          if (pseudoElement) selector.insertBefore(pseudoElement, guard);
          else selector.append(guard);
        }
      });
    }).processSync(rule.selector);
  });
  return tree.toString();
}
export async function buildMod(directory) {
  const dir = fs.realpathSync(directory),
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"))),
    manifest = validateManifest(
      JSON.parse(fs.readFileSync(path.join(dir, "mod.json"))),
    );
  const config = pkg.icarusBuild;
  if (
    !config ||
    Object.keys(config).some(
      (k) =>
        ![
          "entry",
          "sharedReact",
          "sharedModules",
          "davidSource",
          "davidFrame",
          "publicEntry",
          "composes",
        ].includes(k),
    )
  )
    throw new Error("Missing / invalid package.icarusBuild");
  safePath(config.entry);
  if (config.publicEntry) safePath(config.publicEntry);
  const composition = compositionSources(dir, pkg);
  if (config.sharedReact && !manifest.requires["react-runtime"])
    throw new Error("Shared React requires react-runtime in mod.json");
  const plugins = [];
  const source =
    config.davidSource || config.davidFrame ? davidSource(dir) : null;
  const sourcePlugin = source
    ? davidPlugin(source, { portals: !config.davidFrame })
    : null;
  if (sourcePlugin) plugins.push(sourcePlugin.plugin);
  let native;
  if (config.davidFrame) {
    native = await buildDavidFrame(dir, source);
    plugins.push({
      name: "native-frame",
      setup(b) {
        b.onResolve({ filter: /^icarus:frame$/ }, () => ({
          path: "frame",
          namespace: "native-frame",
        }));
        b.onLoad({ filter: /.*/, namespace: "native-frame" }, () => ({
          contents:
            "export default " +
            JSON.stringify({
              code: native.code,
              css: native.css,
              source: native.source,
            }),
          loader: "js",
        }));
      },
    });
  }

  if (config.sharedModules) {
    const shared = new Map(
      Object.entries(config.sharedModules).map(([file, id]) => {
        if (!manifest.requires[id])
          throw new Error("Shared module requires " + id);
        return [path.resolve(dir, file), id];
      }),
    );
    plugins.push({
      name: "shared-modules",
      setup(b) {
        b.onResolve({ filter: /^\./ }, (args) => {
          const absolute = path.resolve(args.resolveDir, args.path);
          const id =
            shared.get(absolute) ??
            shared.get(absolute + ".ts") ??
            shared.get(absolute + ".tsx");
          if (id) return { path: "icarus:" + id, external: true };
        });
      },
    });
  }
  if (config.sharedReact)
    plugins.push({
      name: "shared-react",
      setup(b) {
        b.onResolve(
          { filter: /^react(?:-dom)?(?:\/client|\/jsx-runtime)?$/ },
          (a) => ({ path: a.path, namespace: "icarus-react" }),
        );
        b.onLoad({ filter: /.*/, namespace: "icarus-react" }, (a) => ({
          loader: "js",
          contents:
            a.path === "react"
              ? `import {React} from 'icarus:react-runtime';export default React;export const {Children,Component,Fragment,Profiler,PureComponent,StrictMode,Suspense,cache,cloneElement,createContext,createElement,createRef,forwardRef,isValidElement,lazy,memo,startTransition,use,useActionState,useCallback,useContext,useDebugValue,useDeferredValue,useEffect,useEffectEvent,useId,useImperativeHandle,useInsertionEffect,useLayoutEffect,useMemo,useOptimistic,useReducer,useRef,useState,useSyncExternalStore,useTransition,version}=React;`
              : a.path === "react/jsx-runtime"
                ? `import {JSXRuntime} from 'icarus:react-runtime';export const {jsx,jsxs,Fragment}=JSXRuntime;`
                : `export {${a.path === "react-dom/client" ? "createRoot,hydrateRoot" : "createPortal,flushSync"}} from 'icarus:react-runtime';`,
        }));
      },
    });
  const result = await build({
    absWorkingDir: dir,
    entryPoints: [config.entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    outfile: "dist/index.mjs",
    metafile: true,
    minify: true,
    legalComments: "inline",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": "{}",
      ICARUS_CSS: '"__ICARUS_COMPILED_CSS__"',
    },
    external: Object.keys(manifest.requires).map((id) => "icarus:" + id),
    plugins,
  });
  if (sourcePlugin) verifyLoaded(sourcePlugin.loaded);
  let js = result.outputFiles.find((f) => f.path.endsWith(".mjs"))?.text;
  if (!js) throw new Error("Missing module output");
  const css =
    result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
  const notice = path.join(dir, "src/NOTICE.txt");
  if (fs.existsSync(notice))
    js +=
      "\n/*! " +
      fs.readFileSync(notice, "utf8").replaceAll("*/", "* /") +
      " */\n";
  js = js.replaceAll(
    '"__ICARUS_COMPILED_CSS__"',
    JSON.stringify(scopeCss(css, manifest.id)),
  );
  if (
    manifest.entry !== "dist/index.mjs" ||
    JSON.stringify(manifest.files) !== JSON.stringify(["dist/index.mjs"])
  )
    throw new Error("Built mods publish only dist/index.mjs");
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, manifest.entry), js);
  const inputs = {};
  for (const name of [
    ...Object.keys(result.metafile.inputs).filter(
      (n) => !n.startsWith("icarus-react:"),
    ),
    "mod.json",
    "package.json",
    "src/NOTICE.txt",
    ...(native?.inputs ?? []),
    ...composition.files,
  ]) {
    const file = path.resolve(dir, name);
    if (fs.existsSync(file))
      inputs[
        source && file.startsWith(source.root + path.sep)
          ? "@david/" + path.relative(path.join(source.root, "src"), file)
          : path.relative(dir, file)
      ] = digest(file);
  }
  fs.writeFileSync(
    path.join(dir, "dist/build.json"),
    JSON.stringify(
      {
        schema: "icarus-build/v1",
        compiler: digest(new URL(import.meta.url)),
        toolchain: Object.fromEntries(
          [
            "david-source.mjs",
            "david-frame.mjs",
            "manifest.mjs",
            "composition.mjs",
          ].map((file) => [file, digest(new URL(file, import.meta.url))]),
        ),
        inputs,
        composedMods: composition.versions,
        ...(source
          ? {
              david: {
                mode: source.mode,
                source: native?.source ?? sourceState(source.root).sha256,
              },
            }
          : {}),
        output: digest(path.join(dir, manifest.entry)),
      },
      null,
      2,
    ) + "\n",
  );
  const mod = readProject(dir);
  return {
    id: manifest.id,
    version: manifest.version,
    bytes: Buffer.byteLength(js),
    source: config.entry,
    output: manifest.entry,
    integrity: mod.integrity,
  };
}
