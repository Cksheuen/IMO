import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { compositionSources } from "../../scripts/mods/composition.mjs";
// UI primitives, theme, types and the default comment bridge are shared. Features have one owner.
export const featureOwners = [
  ["@david/components/canvas/LogicCanvas", ["logic-canvas"]],
  ["@david/lib/logicGraph", ["logic-canvas", "code-flow"]],
  ["@david/components/CodeBlock", ["rich-code"]],
  ["@david/lib/codeAnnotations", ["rich-code"]],
  ["@david/lib/codeHighlights", ["rich-code"]],
  ["@david/components/details/CodeFlow", ["code-flow"]],
  ["@david/components/api-contracts/", ["api-contracts"]],
  ["@david/components/change-block/", ["code-diff"]],
  ["@david/components/materials/", ["design-materials"]],
  ["@david/components/open-questions/", ["open-questions"]],
  ["@david/components/preparation/", ["preparation"]],
  ["@david/lib/richContent", ["rich-content"]],
  ["@david/app/", ["review-workbench"]],
];
export function checkImport(
  owner,
  specifier,
  importer,
  workspace,
  config = {},
) {
  const normalized = specifier.replace(/\.(?:tsx?|jsx?)$/, "");
  const feature = featureOwners.find(
    ([prefix]) =>
      normalized === prefix ||
      normalized.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
  );
  if (feature && !feature[1].includes(owner))
    throw Error(
      `${owner} bypasses ${feature[1].join("/")} public entry: ${specifier}`,
    );
  if (!specifier.startsWith(".")) return;
  const target = path.resolve(path.dirname(importer), specifier),
    relative = path
      .relative(path.join(workspace, "mods"), target)
      .split(path.sep);
  if (relative[0] === ".." || relative[0] === owner) return;
  const dependency = relative[0];
  const pkg = JSON.parse(
    fs.readFileSync(path.join(workspace, "mods", dependency, "package.json")),
  );
  const entry = pkg.icarusBuild?.publicEntry;
  const expected = entry && path.join(workspace, "mods", dependency, entry);
  if (
    !(config.composes ?? []).includes(dependency) ||
    !expected ||
    target.replace(/\.tsx?$/, "") !== expected.replace(/\.tsx?$/, "")
  )
    throw Error(
      `${owner} must declare composes and use ${dependency}'s public entry: ${specifier}`,
    );
}
export function checkModBoundaries(workspace = process.cwd()) {
  let checked = 0;
  const walk = (dir, visit) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file, visit);
      else visit(file);
    }
  };
  for (const item of fs.readdirSync(path.join(workspace, "mods"), {
    withFileTypes: true,
  })) {
    if (!item.isDirectory()) continue;
    const dir = path.join(workspace, "mods", item.name),
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json")));
    compositionSources(dir, pkg);
    if (!fs.existsSync(path.join(dir, "src"))) continue;
    walk(path.join(dir, "src"), (file) => {
      if (!/\.(tsx?|mjs)$/.test(file)) return;
      const ast = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) &&
                node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined;
        if (specifier && ts.isStringLiteral(specifier))
          checkImport(
            item.name,
            specifier.text,
            file,
            workspace,
            pkg.icarusBuild,
          );
        ts.forEachChild(node, visit);
      };
      visit(ast);
      checked++;
    });
  }
  // Optional renderers must never become dependencies of the no-mod comment kernel.
  for (const dir of [
    "../assets/runtime",
    "../scripts/local",
  ])
    walk(path.join(workspace, dir), (file) => {
      if (!/\.mjs$/.test(file)) return;
      const ast = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) &&
                node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined;
        if (
          specifier &&
          ts.isStringLiteral(specifier) &&
          specifier.text.startsWith(".")
        ) {
          const target = path.resolve(path.dirname(file), specifier.text);
          if (
            ["mods", "packages/david-source"].some((root) =>
              target.startsWith(path.join(workspace, root) + path.sep),
            )
          )
            throw Error(`Core imports an optional mod: ${file}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    });
  return { ok: true, checked };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(checkModBoundaries()));
