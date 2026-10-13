#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { args, list, known } from "./mods/args.mjs";
import { bundle } from "./mods/bundle.mjs";
import { buildPlan, writePlan } from "./mods/plan.mjs";
import { registerDocument, hash } from "./local/store.mjs";
import { ensureService } from "./local/service.mjs";
const { positional, opts } = args(process.argv.slice(2), ["auto", "no-auto"]);
known(opts, ["mods", "features", "auto", "no-auto", "exclude", "options"]);
const [input, output] = positional;
if (!input || !output || positional.length !== 2)
  throw new Error(
    "Usage: icarus attach source.html review.html [--mods code-notes] [--no-auto] [--exclude id]",
  );
if (
  path.resolve(input) === path.resolve(output) ||
  (fs.existsSync(output) && fs.realpathSync(input) === fs.realpathSync(output))
)
  throw new Error("Source and review output must differ");
const source = fs.readFileSync(input, "utf8");
if (/id\s*=\s*["']icarus-bootstrap["']/i.test(source))
  throw new Error("Use the original source HTML, not an attached review");
const plan = await buildPlan(input, {
  ids: list(opts.mods ?? opts.features),
  auto: !opts["no-auto"],
  exclude: list(opts.exclude),
  options: opts.options
    ? JSON.parse(fs.readFileSync(opts.options, "utf8"))
    : {},
});
const runtime = fileURLToPath(new URL("../assets/runtime/", import.meta.url));
const core = await bundle("core.mjs", runtime),
  loader = await bundle("mod-loader.mjs", runtime, undefined, {
    dynamicImports: true,
  });
const config = registerDocument(input, output);
if (config.source.sha256 !== hash(source))
  throw new Error("Source changed during generation; retry");
const local = await ensureService();
const service = {
  baseUrl: local.baseUrl,
  documentId: config.id,
  token: config.token,
};
writePlan(config.id, plan);
let boot = `import {mountIcarus} from ${JSON.stringify(core)};import {connectMods} from ${JSON.stringify(loader)};\nwindow.icarus=mountIcarus({source:${JSON.stringify(config.source)},service:${JSON.stringify(service)}});window.icarusMods=connectMods(window.icarus,${JSON.stringify(plan)},${JSON.stringify(service)});\nconst destroy=window.icarus.destroy;window.icarus.destroy=async()=>{try{await window.icarusMods.destroy();}finally{await destroy();}};\ntry{await window.icarusMods.ready;}catch(error){console.error('Icarus mod activation failed:',error);}\nwindow.dispatchEvent(new Event('icarus-ready'));`;
const injection = `\n<script id="icarus-bootstrap" type="module">${boot.replace(/<\/script/gi, "<\\/script")}</script>\n`;
const end = source.toLowerCase().lastIndexOf("</body>");
const html =
  end < 0
    ? source + injection
    : source.slice(0, end) + injection + source.slice(end);
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
console.log(
  JSON.stringify({
    output: path.resolve(output),
    source: config.source,
    documentId: config.id,
    previewUrl: `${local.baseUrl}/review/${config.id}/`,
    agentReadCommand: `node ${fileURLToPath(new URL("./feedback.mjs", import.meta.url))} get ${config.id}`,
    mods: plan.specs.map((m) => m.id),
    decisions: plan.decisions,
    missing: plan.missing,
    warnings: plan.warnings,
    bytes: Buffer.byteLength(html),
    runtimeBytes: Buffer.byteLength(injection),
  }),
);
