#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { args, known } from "./mods/args.mjs";
import {
  exportGraphs,
  readResearchSource,
  selectGraphs,
  sourceHash,
} from "./whiteboard-source.mjs";

const usage = `icarus whiteboard export <source.html|spec.json> --out <dir> [--page id] [--question id] [--view id] [--all]
icarus whiteboard sync <source.html|spec.json> --whiteboard-token <token> --page id --view id [--as user] [--overwrite] [--dry-run]
icarus whiteboard sync <source.html|spec.json> --doc <doc-url-or-token> --create --page id --view id [--as user] [--dry-run]
Use --question id when a page has multiple questions. Existing-board sync requires --overwrite or --append.`;
const [operation, ...argv] = process.argv.slice(2);
if (!operation || ["--help", "help"].includes(operation)) {
  console.log(usage);
  process.exit(0);
}
const boolean = ["all", "create", "overwrite", "append", "dry-run"];
const parsed = args(argv, boolean);
known(parsed.opts, [
  "out",
  "page",
  "question",
  "view",
  "all",
  "whiteboard-token",
  "doc",
  "create",
  "overwrite",
  "append",
  "dry-run",
  "as",
  "idempotent-token",
  "lark-cli",
]);
const [source] = parsed.positional;
if (!source || parsed.positional.length !== 1) throw Error(usage);

function requireExportSelection() {
  if (operation === "sync" && (!parsed.opts.page || !parsed.opts.view))
    throw Error(
      "sync requires --page and --view; use export --all to export every board",
    );
}

function run(command, argv, { cwd = process.cwd() } = {}) {
  const result = spawnSync(command, argv, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw Error(`${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw Error(
      `${command} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
    );
  return result.stdout.trim();
}

function parseJsonEnvelope(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const lines = raw
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {}
    }
    throw Error("CLI returned no JSON result; success cannot be confirmed");
  }
}

function relativeInput(file, cwd) {
  const relative = path.relative(cwd, file);
  if (relative.startsWith(".."))
    throw Error("generated whiteboard input must stay under the command cwd");
  return `@./${relative.replaceAll(path.sep, "/")}`;
}

function validateMermaid(file) {
  const cli = process.env.ICARUS_WHITEBOARD_CLI ?? "npx";
  const argv =
    cli === "npx"
      ? ["-y", "@larksuite/whiteboard-cli@^0.2.13", "--input", file, "--check"]
      : ["--input", file, "--check"];
  const report = parseJsonEnvelope(run(cli, argv));
  if (report.code !== 0 || report.data?.check?.errors !== 0)
    throw Error(`Mermaid validation failed: ${JSON.stringify(report)}`);
  return report.data;
}

async function main() {
  if (operation === "export") {
    const out = parsed.opts.out;
    if (!out) throw Error("export requires --out <dir>");
    const result = exportGraphs(source, path.resolve(out), {
      pageId: parsed.opts.page,
      questionId: parsed.opts.question,
      viewId: parsed.opts.view,
      all: parsed.opts.all,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (operation !== "sync") throw Error(usage);
  requireExportSelection();
  if (!!parsed.opts["whiteboard-token"] === !!parsed.opts.doc)
    throw Error("sync requires exactly one of --whiteboard-token or --doc");
  if (parsed.opts.doc && !parsed.opts.create)
    throw Error(
      "--doc sync requires --create so document insertion is explicit",
    );
  if (parsed.opts.all || parsed.opts.out)
    throw Error("--all and --out are export options");
  if (
    parsed.opts.doc &&
    (parsed.opts.overwrite ||
      parsed.opts.append ||
      parsed.opts["idempotent-token"])
  )
    throw Error(
      "--overwrite, --append and --idempotent-token only apply to an existing whiteboard",
    );
  if (
    parsed.opts["whiteboard-token"] &&
    (parsed.opts.create || !!parsed.opts.overwrite === !!parsed.opts.append)
  )
    throw Error(
      "Existing-board sync requires exactly one of --overwrite or --append, without --create",
    );
  if (parsed.opts.as && !["user", "bot"].includes(parsed.opts.as))
    throw Error("--as must be user or bot");

  const { spec, sourcePath, sha256 } = readResearchSource(source);
  const selection = {
    pageId: parsed.opts.page,
    questionId: parsed.opts.question,
    viewId: parsed.opts.view,
  };
  const selected = selectGraphs(spec, selection);
  if (selected.length !== 1)
    throw Error(
      "sync selection must resolve to exactly one graph; add --question",
    );
  const item = selected[0];
  const temp = fs.mkdtempSync(path.join(process.cwd(), ".icarus-whiteboard-"));
  try {
    const stem =
      `${item.page.id}--${item.question.id}--${item.view.id}`.replace(
        /[^a-zA-Z0-9._-]+/g,
        "-",
      );
    const exported = exportGraphs(source, temp, selection);
    const graphEntry = exported.graphs[0];
    const mmd = graphEntry.mermaid;
    const check = validateMermaid(mmd);
    const as = parsed.opts.as ?? "user";
    const diagram = fs.readFileSync(mmd, "utf8");
    const idempotent =
      parsed.opts["idempotent-token"] ??
      `icarus-${sourceHash(JSON.stringify([parsed.opts["whiteboard-token"], !!parsed.opts.overwrite, diagram])).slice(0, 40)}`;
    const lark = parsed.opts["lark-cli"] ?? "lark-cli";
    const dryRun = parsed.opts["dry-run"];
    const cwd = process.cwd();
    let target;
    let response;
    if (parsed.opts["whiteboard-token"]) {
      const sourceArg = relativeInput(mmd, cwd);
      const larkArgs = [
        "whiteboard",
        "+update",
        "--whiteboard-token",
        parsed.opts["whiteboard-token"],
        "--input_format",
        "mermaid",
        "--source",
        sourceArg,
        "--idempotent-token",
        idempotent,
        "--as",
        as,
      ];
      if (parsed.opts.overwrite) larkArgs.push("--overwrite");
      if (dryRun) larkArgs.push("--dry-run");
      response = parseJsonEnvelope(run(lark, larkArgs, { cwd }));
      target = { type: "whiteboard", token: parsed.opts["whiteboard-token"] };
    } else {
      const xml = `<whiteboard type="mermaid" path="${relativeInput(mmd, cwd)}"></whiteboard>`;
      const xmlPath = path.join(temp, `${stem}.xml`);
      fs.writeFileSync(xmlPath, xml);
      const larkArgs = [
        "docs",
        "+update",
        "--doc",
        parsed.opts.doc,
        "--command",
        "append",
        "--content",
        relativeInput(xmlPath, cwd),
        "--doc-format",
        "xml",
        "--as",
        as,
      ];
      if (dryRun) larkArgs.push("--dry-run");
      response = parseJsonEnvelope(run(lark, larkArgs, { cwd }));
      target = {
        type: "document",
        doc: parsed.opts.doc,
        action: "create-whiteboard",
      };
    }
    if (
      response.ok !== true ||
      (response.code !== undefined && response.code !== 0) ||
      response.error
    )
      throw Error(
        `lark-cli did not confirm success: ${JSON.stringify(response)}`,
      );
    console.log(
      JSON.stringify(
        {
          synced: !dryRun,
          dryRun: !!dryRun,
          readBackVerified: false,
          target,
          source: { path: sourcePath, sha256 },
          page: item.page.id,
          question: item.question.id,
          view: item.view.id,
          label: `${item.page.label} · ${item.view.label}`,
          mermaid: diagram,
          validation: check,
          response,
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
