#!/usr/bin/env node
/**
 * David design context 提取 CLI（agent 用）。
 *
 * 把评审产物变成 agent 可廉价阅读的目录：
 * - 输入 .json（review spec）：内联重建 design context（见下）。
 * - 输入 .html（渲染后的评审页）：提取页面内嵌的
 *   <script id="david-design-context" type="application/json"> 文本。
 *
 * 用法：
 *   node scripts/extract-design-context.mjs <review.json|file.html> [--pretty]
 *
 * 退出码：0 成功；2 参数/输入错误（与 david-feedback-cli.mjs 风格一致）。
 *
 * JSON 路径与两份 renderer 直接复用 designContext.ts（Node type stripping），
 * HTML 路径读取磁盘中唯一的内嵌块；不再维护摘要逻辑镜像。
 */
import fs from "node:fs";
import path from "node:path";

import { buildDesignContext as buildDesignContextJson } from "../src/lib/designContext.ts";
class CliError extends Error {
  constructor(message) {
    super(message);
    this.code = 2;
  }
}

/** Extract the embedded context JSON from a rendered review HTML page. */
function extractFromHtml(html) {
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  const contexts = [];
  while ((match = scriptRe.exec(html)) !== null) {
    const attrs = match[1];
    const hasId = /\bid\s*=\s*["']david-design-context["']/i.test(attrs);
    const hasType = /\btype\s*=\s*["']application\/json["']/i.test(attrs);
    if (!hasId || !hasType) continue;
    contexts.push(JSON.parse(match[2].trim()));
  }
  if (contexts.length === 1) return contexts[0];
  if (contexts.length > 1)
    throw new CliError("HTML 中 design context 必须唯一");
  throw new CliError(
    'HTML 中未找到 <script id="david-design-context" type="application/json">（页面可能由旧版本渲染）',
  );
}

const main = () => {
  const argv = process.argv.slice(2);
  const pretty = argv.includes("--pretty");
  const positional = argv.filter((arg) => arg !== "--pretty");
  if (positional.length !== 1) {
    throw new CliError(
      "用法: node scripts/extract-design-context.mjs <review.json|file.html> [--pretty]",
    );
  }

  const inputPath = path.resolve(positional[0]);
  if (!fs.existsSync(inputPath)) {
    throw new CliError(`文件不存在: ${inputPath}`);
  }

  const ext = path.extname(inputPath).toLowerCase();
  let context;
  if (ext === ".json") {
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    } catch (error) {
      throw new CliError(`JSON 解析失败: ${error.message}`);
    }
    context = buildDesignContextJson(spec);
  } else if (ext === ".html" || ext === ".htm") {
    context = extractFromHtml(fs.readFileSync(inputPath, "utf8"));
  } else {
    throw new CliError(`不支持的文件类型: ${ext}（仅支持 .json / .html）`);
  }

  process.stdout.write(`${JSON.stringify(context, null, pretty ? 2 : 0)}\n`);
};

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(error.code ?? 2);
}
