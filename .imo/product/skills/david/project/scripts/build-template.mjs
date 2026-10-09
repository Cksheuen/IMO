import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skillRoot = path.resolve(projectRoot, "..");
const publicScripts = ["render-review.mjs", "david-feedback.mjs"];

const assertInsideSkillRoot = (target) => {
  const relativePath = path.relative(skillRoot, target);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside skill root: ${target}`);
  }
};

const shell = fs.readFileSync(
  path.join(projectRoot, "src/template/template.shell.html"),
  "utf8",
);
const css = fs.readFileSync(path.join(projectRoot, "dist/styles.css"), "utf8");
const js = fs.readFileSync(path.join(projectRoot, "dist/runtime.js"), "utf8");
const countOccurrences = (value, token) => value.split(token).length - 1;

for (const [token, expectedCount] of [
  ["{{BUNDLED_CSS}}", 1],
  ["{{BUNDLED_JS}}", 1],
]) {
  const actualCount = countOccurrences(shell, token);
  if (actualCount !== expectedCount) {
    throw new Error(
      `expected ${expectedCount} ${token} placeholder(s), found ${actualCount}`,
    );
  }
}

const thirdPartyNotice = fs.readFileSync(
  path.join(skillRoot, "THIRD-PARTY-NOTICES.md"),
  "utf8",
);
const bundle =
  shell
    .replace("{{BUNDLED_CSS}}", () => css)
    .replace("{{BUNDLED_JS}}", () => js) +
  `\n<!-- ${thirdPartyNotice.replaceAll("--", "—")} -->`;

for (const token of ["{{BUNDLED_CSS}}", "{{BUNDLED_JS}}"]) {
  if (bundle.includes(token)) {
    throw new Error(`unresolved ${token} placeholder in template bundle`);
  }
}

const projectDist = path.join(projectRoot, "dist");
const skillDist = path.join(skillRoot, "dist");
const scriptsDst = path.join(skillRoot, "scripts");

for (const target of [projectDist, skillDist, scriptsDst]) {
  assertInsideSkillRoot(target);
}

fs.mkdirSync(projectDist, { recursive: true });
fs.writeFileSync(path.join(projectDist, "template.html"), bundle);
fs.mkdirSync(skillDist, { recursive: true });
fs.writeFileSync(path.join(skillDist, "template.html"), bundle);

// 仅同步对外发布的渲染/桥接脚本；开发/测试脚本保留在 project/scripts 中。
const scriptsSrc = path.join(projectRoot, "scripts");
fs.mkdirSync(scriptsDst, { recursive: true });
for (const name of publicScripts) {
  fs.copyFileSync(path.join(scriptsSrc, name), path.join(scriptsDst, name));
}

console.log(
  JSON.stringify(
    {
      source: projectRoot,
      bundle: path.join(projectRoot, "dist/template.html"),
      skillBundle: path.join(skillRoot, "dist/template.html"),
      scripts: publicScripts,
    },
    null,
    2,
  ),
);
