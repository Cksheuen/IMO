import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { davidPlugin, sourceState, verifyLoaded } from "./david-source.mjs";
export async function buildDavidFrame(dir, source) {
  const loader = davidPlugin(source),
    require = createRequire(path.join(source.workspace, "package.json"));
  const result = await build({
    absWorkingDir: dir,
    entryPoints: ["src/frame.tsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    write: false,
    metafile: true,
    outfile: "frame.js",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [
      loader.plugin,
      {
        name: "workspace-react",
        setup(b) {
          b.onResolve(
            { filter: /^react(?:-dom)?(?:\/client|\/jsx-runtime)?$/ },
            (a) => ({ path: require.resolve(a.path) }),
          );
        },
      },
    ],
  });
  verifyLoaded(loader.loaded);
  return {
    code: result.outputFiles.find((f) => f.path.endsWith(".js")).text,
    css: result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "",
    source: sourceState(source.root).sha256,
    inputs: Object.keys(result.metafile.inputs).map((f) =>
      path.resolve(dir, f),
    ),
  };
}
