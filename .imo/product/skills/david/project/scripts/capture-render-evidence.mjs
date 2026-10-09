#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const take = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = args[0];
const output = take("--out");
const reportPath = take("--report");
const selector = take("--selector");
const viewport = take("--viewport", "393x852");
if (!url || !output) {
  console.error(
    "usage: node capture-render-evidence.mjs <url> --out <screenshot> [--report report.json] [--selector css] [--viewport 393x852]",
  );
  process.exit(2);
}
const match = /^([0-9]+)x([0-9]+)$/.exec(viewport);
if (!match) throw new Error(`invalid viewport: ${viewport}`);
const [width, height] = match.slice(1).map(Number);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const startedAt = new Date().toISOString();
  await page.goto(url, { waitUntil: "networkidle" });
  const target = selector
    ? page.locator(selector).first()
    : page.locator("body");
  if ((await target.count()) === 0)
    throw new Error(`selector not found: ${selector}`);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  await target.screenshot({ path: output, animations: "disabled" });
  const report = {
    schema: "david-render-evidence/v1",
    url,
    selector: selector ?? null,
    viewport,
    screenshot: path.resolve(output),
    capturedAt: startedAt,
  };
  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
