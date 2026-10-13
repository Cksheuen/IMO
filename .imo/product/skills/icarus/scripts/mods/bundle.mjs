import fs from "node:fs";
import path from "node:path";
import { init, parse } from "es-module-lexer";
const dataURL = (mime, bytes) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
/** Prebundle all local imports; never execute module code on the agent. */
export async function bundle(
  entry,
  root,
  allowed,
  { dynamicImports = false, dependencies = [] } = {},
) {
  await init;
  root = fs.realpathSync(root);
  const cache = new Map(),
    visiting = new Set();
  const visit = (file) => {
    file = fs.realpathSync(file);
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (
      rel.startsWith("../") ||
      path.isAbsolute(rel) ||
      (allowed && !allowed.has(rel))
    )
      throw new Error(`Undeclared / external module: ${rel}`);
    if (cache.has(file)) return cache.get(file);
    if (visiting.has(file))
      throw new Error(
        "Circular ESM imports must be prebundled by the mod author",
      );
    visiting.add(file);
    const bytes = fs.readFileSync(file),
      ext = path.extname(file);
    let code;
    if (ext === ".mjs") {
      code = bytes.toString("utf8");
      const [imports] = parse(code);
      for (const im of [...imports].reverse()) {
        if (dynamicImports && im.d >= 0 && !im.n) continue;
        if (im.n?.startsWith("icarus:")) {
          if (!dependencies.includes(im.n.slice(7)))
            throw new Error("Undeclared mod import: " + im.n);
          if (file !== path.resolve(root, entry))
            throw new Error(
              "Cross-mod imports must be prebundled into the entry",
            );
          continue;
        }
        if (im.d === -2)
          throw new Error(
            "import.meta is not portable; import local assets directly",
          );
        if (!im.n || !im.n.startsWith("."))
          throw new Error(
            "Only literal relative imports are supported; prebundle npm dependencies",
          );
        const replacement = visit(path.resolve(path.dirname(file), im.n));
        code =
          code.slice(0, im.s) +
          (im.d >= 0 ? JSON.stringify(replacement) : replacement) +
          code.slice(im.e);
      }
    } else if (ext === ".json")
      code = `export default ${JSON.stringify(JSON.parse(bytes))};`;
    else if (ext === ".css" || ext === ".txt")
      code = `export default ${JSON.stringify(bytes.toString("utf8"))};`;
    else {
      const mime = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
      }[ext];
      if (!mime) throw new Error(`Unsupported mod asset: ${rel}`);
      code = `export default ${JSON.stringify(dataURL(mime, bytes))};`;
    }
    const url = dataURL("text/javascript", code);
    if (url.length > 16 * 1024 * 1024)
      throw new Error("Bundled module exceeds limit");
    visiting.delete(file);
    cache.set(file, url);
    return url;
  };
  return visit(path.resolve(root, entry));
}
export async function bundleMod(mod) {
  await init;
  const [, exports] = parse(mod.files.get(mod.manifest.entry).toString("utf8"));
  if (!exports.some((x) => x.n === "default"))
    throw new Error("Mod entry must export default feature");
  return bundle(mod.manifest.entry, mod.dir, new Set(mod.manifest.files), {
    dependencies: Object.keys(mod.manifest.requires),
  });
}
