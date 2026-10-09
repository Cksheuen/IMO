#!/usr/bin/env node
/** Start a business preview from a declared renderRecipe and capture one component. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const [specPath, componentId] = process.argv.slice(2);
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
if (!specPath || !componentId || !outDir) {
  console.error(
    "usage: node capture-component-evidence.mjs <review.json> <componentId> --out <dir>",
  );
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const component = (spec.components ?? []).find(
  (item) => item.id === componentId,
);
const recipe = component?.source?.renderRecipe;
if (!recipe)
  throw new Error(`component ${componentId} 缺少 source.renderRecipe`);
const specDir = path.dirname(path.resolve(specPath));
const projectRoot = path.resolve(specDir, recipe.projectRoot);
const viewportMatch = /^(\d+)x(\d+)$/.exec(recipe.viewport ?? "393x852");
if (!viewportMatch) throw new Error(`非法 viewport: ${recipe.viewport}`);
const viewport = `${viewportMatch[1]}x${viewportMatch[2]}`;
const [width, height] = viewportMatch.slice(1).map(Number);
const outputDir = path.resolve(specDir, outDir);
fs.mkdirSync(outputDir, { recursive: true });
const screenshot = path.join(outputDir, `${componentId}.png`);
const child = spawn(recipe.startCommand, {
  cwd: projectRoot,
  shell: true,
  env: { ...process.env, DAVID_CAPTURE_COMPONENT_ID: componentId },
  stdio: "ignore",
});
const stop = () => {
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
};
process.on("exit", stop);
try {
  const timeout = recipe.readyTimeoutMs ?? 30000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`startCommand 提前退出: ${child.exitCode}`);
    if (
      await fetch(recipe.url)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (
    !(await fetch(recipe.url)
      .then((response) => response.ok)
      .catch(() => false))
  ) {
    throw new Error(`预览未在 ${timeout}ms 内就绪: ${recipe.url}`);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.goto(recipe.url, { waitUntil: "networkidle" });
    const target = recipe.selector
      ? page.locator(recipe.selector).first()
      : page.locator("body");
    await target.waitFor({ state: "visible", timeout });
    await target.screenshot({ path: screenshot, animations: "disabled" });
  } finally {
    await browser.close();
  }
  const evidence = {
    schema: "david-render-evidence/v1",
    recipe: recipe.startCommand,
    url: recipe.url,
    selector: recipe.selector ?? null,
    viewport,
    screenshot,
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(outputDir, `${componentId}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  stop();
}
