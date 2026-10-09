#!/usr/bin/env node
/**
 * Unified layered test runner for the david project.
 *
 * - Layers: unit / ssr (the fast layers, concurrent within a layer) and
 *   browser (playwright, serial — ports are isolated per test by design).
 * - Default run: all fast-layer tests. Browser tests only run with
 *   --browser / --all / --layer browser.
 * - Selectors (combinable, union semantics):
 *     --files <path...>     explicit changed files (glob * / ** supported)
 *     --affected            changed files from `git diff` + untracked files
 *     --base <ref>          diff base for --affected (default HEAD)
 *     --id <id...>          select by manifest id
 *     --component <name...> select by covers path fragment
 *     --layer unit|ssr|browser
 * - Affected tests are computed by a self-contained reverse import graph
 *   (regex scan, no third-party dependencies).
 *
 * Exit code is non-zero if any selected test fails; every started test runs
 * to completion (no early kill) and failures are listed at the end.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const SCRIPTS_DIR = path.join(PROJECT_ROOT, "scripts");
const MANIFEST_PATH = path.join(SCRIPTS_DIR, "test-manifest.json");

const LAYERS = ["unit", "ssr", "browser"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);

// Conventional vite alias. vite.config.ts currently defines no custom alias;
// `@/` is resolved defensively so adding the alias later cannot silently break
// affected-test detection.
const ALIASES = { "@": SRC_DIR };

/**
 * Shared-base files: a change here can plausibly affect every test of the
 * widened scope, so the run is expanded to the whole (fast, by default) layer.
 * Paths are project-relative POSIX strings.
 */
const BASE_ROOTS_EXPLAINED = [
  "src/components/ui/** (shared UI primitives)",
  "src/lib/richContent/index.ts (rich content barrel)",
  "src/lib/reviewSpec.ts (central spec parser/types)",
  "src/styles/index.css (global stylesheet)",
  "src/main.tsx (runtime entry)",
  "vite.config.ts (build/dev server config)",
  "scripts/render-review.mjs (shared render pipeline)",
  "package.json (dependency surface)",
];

function isBaseChange(rel) {
  return (
    rel.startsWith("src/components/ui/") ||
    rel === "src/lib/richContent/index.ts" ||
    rel === "src/lib/reviewSpec.ts" ||
    rel === "src/styles/index.css" ||
    rel === "src/main.tsx" ||
    rel === "vite.config.ts" ||
    rel === "scripts/render-review.mjs" ||
    rel === "../scripts/render-review.mjs" ||
    rel === "package.json"
  );
}

const relPosix = (abs) =>
  path.relative(PROJECT_ROOT, abs).split(path.sep).join("/");

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`david test runner

Usage: node scripts/run-tests.mjs [options]

Layer selection:
  (none)                 all unit + ssr tests (fast layers)
  --browser              include browser tests (serial) in addition to fast layers
  --all                  all three layers (browser serial)
  --layer LAYER          only run unit | ssr | browser

Browser tests run by default are only the self-contained, non-aggregated ones
(manifest selfContained:true, no aggregatedBy) — each boots its own page server
on a kernel port. Aggregator child scripts and half-manual/external-server
scripts are skipped (listed at run time); force one with --id <id>.

Test selection (combinable, union):
  --files <p...>         affected by the given changed files (globs allowed)
  --affected             affected by git diff vs --base plus untracked files
  --base <ref>           git diff base, default HEAD
  --id <id...>           select manifest ids
  --component <name...>  select tests whose covers contain the path fragment

Other:
  --jobs <n>             fast-layer concurrency (default min(cpus-1, 4))
  --list                 print the selection plan and exit without running
  -h, --help             this help

Shared-base changes (${BASE_ROOTS_EXPLAINED.join("; ")}) widen to the whole
selected layer set and print a hint to additionally run --browser.
`);
}

function parseArgs(argv) {
  const opts = {
    files: [],
    affected: false,
    base: "HEAD",
    ids: [],
    components: [],
    layer: null,
    browser: false,
    all: false,
    list: false,
    jobs: Math.max(1, Math.min(os.cpus().length - 1, 4)),
    help: false,
  };
  const multi = (key, flag) => {
    const before = opts[key].length;
    while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      opts[key].push(argv[++i]);
    }
    if (opts[key].length === before) {
      throw new Error(`${flag} requires at least one value`);
    }
  };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--files":
        multi("files", "--files");
        break;
      case "--affected":
        opts.affected = true;
        break;
      case "--base":
        if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
          throw new Error("--base requires a git ref");
        }
        opts.base = argv[++i];
        break;
      case "--id":
        multi("ids", "--id");
        break;
      case "--component":
        multi("components", "--component");
        break;
      case "--layer":
        if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
          throw new Error("--layer requires unit|ssr|browser");
        }
        opts.layer = argv[++i];
        break;
      case "--browser":
        opts.browser = true;
        break;
      case "--all":
        opts.all = true;
        break;
      case "--list":
        opts.list = true;
        break;
      case "--jobs":
        if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
          throw new Error("--jobs requires a number");
        }
        opts.jobs = Number.parseInt(argv[++i], 10);
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (opts.layer && !LAYERS.includes(opts.layer)) {
    throw new Error(`--layer must be one of ${LAYERS.join("|")}`);
  }
  if (!Number.isInteger(opts.jobs) || opts.jobs < 1) {
    throw new Error("--jobs must be a positive integer");
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`test manifest not found: ${MANIFEST_PATH}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    throw new Error(`manifest is not valid JSON: ${err.message}`, {
      cause: err,
    });
  }
  if (!parsed || !Array.isArray(parsed.tests)) {
    throw new Error("manifest must contain a tests[] array");
  }
  const seen = new Set();
  for (const t of parsed.tests) {
    for (const field of ["id", "script", "layer"]) {
      if (typeof t[field] !== "string" || !t[field]) {
        throw new Error(
          `manifest entry missing string field "${field}": ${JSON.stringify(t)}`,
        );
      }
    }
    if (!LAYERS.includes(t.layer)) {
      throw new Error(`manifest entry ${t.id} has unknown layer ${t.layer}`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate manifest id: ${t.id}`);
    seen.add(t.id);
    if (!Array.isArray(t.covers)) {
      throw new Error(`manifest entry ${t.id} covers must be an array`);
    }
    if (t.layer === "browser") {
      if (
        t.selfContained !== undefined &&
        typeof t.selfContained !== "boolean"
      ) {
        throw new Error(`manifest entry ${t.id} selfContained must be boolean`);
      }
      if (t.aggregatedBy !== undefined && typeof t.aggregatedBy !== "string") {
        throw new Error(`manifest entry ${t.id} aggregatedBy must be string`);
      }
    }
  }
  return parsed.tests;
}

// ---------------------------------------------------------------------------
// Lightweight import graph (project files only)
// ---------------------------------------------------------------------------

const IMPORT_RE = /\b(?:from|import|require)\b\s*\(?\s*["']([^"']+)["']/g;
// Test scripts reference source through vite ssrLoadModule("/src/...") and
// readFileSync(new URL("../src/...", import.meta.url)).
const SRC_STRING_RE = /["'`]((?:\.\.\/)+src\/[^"'`]+|\/src\/[^"'`]+)["'`]/g;

function walkDir(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(abs, out);
    } else {
      out.push(abs);
    }
  }
}

function resolveWithExtensions(target) {
  const trials = [
    "",
    ".ts",
    ".tsx",
    ".mjs",
    ".js",
    ".css",
    ".json",
    "/index.ts",
    "/index.tsx",
    "/index.js",
  ];
  for (const suffix of trials) {
    const candidate = target + suffix;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveSpec(spec, importerAbs) {
  let target;
  if (spec.startsWith("/src/")) {
    target = path.join(PROJECT_ROOT, spec);
  } else if (spec.startsWith("@/")) {
    target = path.join(ALIASES["@"], spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    target = path.resolve(path.dirname(importerAbs), spec);
  } else {
    return null; // bare package import (react, vite, node:*)
  }
  // Strip query/hash fragments (e.g. css?url style specifiers).
  target = target.replace(/[?#].*$/, "");
  return resolveWithExtensions(target);
}

function extractEdges(fileAbs, isScript) {
  const specs = [];
  let text;
  try {
    text = fs.readFileSync(fileAbs, "utf8");
  } catch {
    return specs;
  }
  for (const re of [IMPORT_RE, ...(isScript ? [SRC_STRING_RE] : [])]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const spec = match[1].split(/[?#]/)[0];
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

/**
 * @returns {{graph: Map<string, Set<string>>, nodes: Set<string>}}
 * graph maps a file to the files it imports.
 */
function buildGraph() {
  const graph = new Map();
  const nodes = new Set();

  const srcFiles = [];
  walkDir(SRC_DIR, srcFiles);
  const scriptFiles = fs
    .readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
    .map((e) => path.join(SCRIPTS_DIR, e.name));

  for (const file of [...srcFiles, ...scriptFiles]) {
    nodes.add(file);
    if (!graph.has(file)) graph.set(file, new Set());
  }

  for (const file of [...srcFiles, ...scriptFiles]) {
    const ext = path.extname(file);
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    const edges = graph.get(file);
    const isScript = file.startsWith(SCRIPTS_DIR + path.sep);
    for (const spec of extractEdges(file, isScript)) {
      const resolved = resolveSpec(spec, file);
      if (resolved && nodes.has(resolved)) edges.add(resolved);
    }
  }
  return { graph, nodes };
}

function buildReverseGraph(graph) {
  const reverse = new Map();
  for (const [importer, imports] of graph) {
    for (const imported of imports) {
      if (!reverse.has(imported)) reverse.set(imported, new Set());
      reverse.get(imported).add(importer);
    }
  }
  return reverse;
}

function reverseClosure(seedFiles, reverse, nodes) {
  const affected = new Set();
  const queue = [];
  for (const file of seedFiles) {
    if (nodes.has(file) && !affected.has(file)) {
      affected.add(file);
      queue.push(file);
    }
  }
  while (queue.length) {
    const current = queue.shift();
    for (const importer of reverse.get(current) ?? []) {
      if (!affected.has(importer)) {
        affected.add(importer);
        queue.push(importer);
      }
    }
  }
  return affected;
}

// ---------------------------------------------------------------------------
// Changed-file discovery
// ---------------------------------------------------------------------------

function gitAffectedFiles(base) {
  const gitRootResult = spawnSync(
    "git",
    ["-C", PROJECT_ROOT, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
    },
  );
  if (gitRootResult.status !== 0) {
    throw new Error(
      `not a git work tree: ${(gitRootResult.stderr || "").trim()}`,
    );
  }
  const root = gitRootResult.stdout.trim();
  // Run from the repo root so both commands emit repo-root-relative paths.
  const run = (args) => {
    const result = spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${(result.stderr || "").trim()}`,
      );
    }
    return result.stdout.split("\0").filter(Boolean);
  };
  const repoRelative = [
    ...run(["diff", "--name-only", "-z", base]),
    ...run(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  return repoRelative
    .map((p) => path.join(root, p))
    .filter((abs) => abs.startsWith(path.dirname(PROJECT_ROOT) + path.sep))
    .filter(
      (abs) =>
        !/(?:^|\/)(?:node_modules|dist|\.concurrency|test-results)(?:\/|$)/.test(
          path.relative(path.dirname(PROJECT_ROOT), abs),
        ),
    );
}

function globToRegExp(pattern) {
  // Translate a small glob subset (*, **, literal chars) to an anchored regex.
  // Process the string in one pass; ** matches across path separators.
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      i++; // consume the second star
      // A slash-following ** optionally matches path segments.
      if (pattern[i + 1] === "/") {
        i++;
        regex += "(?:.*/)?";
      } else {
        regex += ".*";
      }
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regex += "\\" + char;
    } else {
      regex += char;
    }
  }
  return new RegExp("^" + regex + "$");
}

function expandFileArgs(patterns, allProjectFiles) {
  const out = new Set();
  for (const pattern of patterns) {
    const direct = path.isAbsolute(pattern)
      ? path.normalize(pattern)
      : path.resolve(PROJECT_ROOT, pattern);
    if (!/[*]/.test(pattern)) {
      out.add(direct);
      continue;
    }
    const re = globToRegExp(pattern);
    for (const abs of allProjectFiles) {
      if (re.test(relPosix(abs))) out.add(abs);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectTests(tests, opts, graphCtx) {
  const { graph, nodes } = graphCtx;
  const reverse = buildReverseGraph(graph);

  // A browser aggregator (e.g. ui-regressions) boots one shared page server and
  // runs child scripts that cannot run standalone. For affected-test matching
  // the aggregator effectively covers the union of its children's covers, so a
  // component change selects the runnable aggregator rather than a child that
  // needs an external BASE_URL.
  const childrenOf = new Map();
  for (const t of tests) {
    if (t.aggregatedBy) {
      if (!childrenOf.has(t.aggregatedBy)) childrenOf.set(t.aggregatedBy, []);
      childrenOf.get(t.aggregatedBy).push(t);
    }
  }
  const effectiveCovers = (t) => {
    const children = childrenOf.get(t.id);
    if (!children) return t.covers;
    return [
      ...new Set(
        t.covers.concat(children.flatMap((c) => [c.script, ...c.covers])),
      ),
    ];
  };
  // A browser test is runnable by default only when it is self-contained
  // (boots its own page server) and is not itself a child of an aggregator
  // (those are covered — once — by running the aggregator). Half-manual / dead
  // scripts stay opt-in via explicit --id.
  const browserRunnable = (t) =>
    t.layer === "browser" && t.selfContained === true && !t.aggregatedBy;
  const explicitIds = new Set(opts.ids);

  const activeLayers = opts.all
    ? [...LAYERS]
    : opts.layer
      ? [opts.layer]
      : opts.browser
        ? ["unit", "ssr", "browser"]
        : ["unit", "ssr"];

  const reasons = [];
  let selectedIds = null; // null = no narrowing selector applied
  const union = new Set();
  let narrowing = opts.affected || opts.files.length > 0;

  const addByIds = (ids, reason) => {
    narrowing = true;
    for (const id of ids) {
      if (!tests.some((t) => t.id === id)) {
        throw new Error(`unknown test id: ${id}`);
      }
      union.add(id);
    }
    reasons.push(`${reason}: ${ids.join(", ")}`);
  };

  if (opts.ids.length) addByIds(opts.ids, "--id");

  if (opts.components.length) {
    narrowing = true;
    for (const fragment of opts.components) {
      const matches = tests.filter(
        (t) =>
          [t.script, ...effectiveCovers(t)].some((cover) =>
            cover.includes(fragment),
          ) ||
          [
            ...reverseClosure(
              [...nodes].filter((file) => relPosix(file).includes(fragment)),
              reverse,
              nodes,
            ),
          ].some((file) =>
            [t.script, ...effectiveCovers(t)].some(
              (cover) => file === path.join(PROJECT_ROOT, cover),
            ),
          ),
      );
      if (!matches.length) {
        throw new Error(`--component matched no manifest covers: ${fragment}`);
      }
      for (const t of matches) union.add(t.id);
    }
    reasons.push(`--component: ${opts.components.join(", ")}`);
  }

  // Changed-file driven selection (--files / --affected).
  const changedOpts = [];
  if (opts.affected) {
    reasons.push(`--affected (git diff ${opts.base} + untracked)`);
    changedOpts.push(...gitAffectedFiles(opts.base));
  }
  if (opts.files.length) {
    changedOpts.push(...expandFileArgs(opts.files, [...nodes]));
  }

  let baseChanged = [];
  let relevantChanges = [];
  let changedRels = [];
  if (changedOpts.length) {
    narrowing = true;
    const inProject = [];
    for (const abs of [...new Set(changedOpts)]) {
      const rel = path.relative(PROJECT_ROOT, abs);
      if (abs.startsWith(path.dirname(PROJECT_ROOT) + path.sep)) {
        inProject.push(rel.split(path.sep).join("/"));
      }
    }
    const rels = [...new Set(inProject)];
    changedRels = rels;
    // Deleted, unknown or unscannable files cannot be proven unrelated.
    baseChanged = rels.filter(
      (rel) => isBaseChange(rel) || !nodes.has(path.join(PROJECT_ROOT, rel)),
    );
    relevantChanges = rels.filter(
      (rel) => nodes.has(path.join(PROJECT_ROOT, rel)) || isBaseChange(rel),
    );

    if (baseChanged.length) {
      // Widen: every test in the active layers is potentially affected.
      for (const t of tests) {
        if (activeLayers.includes(t.layer)) union.add(t.id);
      }
    } else {
      const seeds = rels
        .map((rel) => path.join(PROJECT_ROOT, rel))
        .filter((abs) => nodes.has(abs));
      const affected = reverseClosure(seeds, reverse, nodes);
      for (const t of tests) {
        const scriptAbs = path.join(PROJECT_ROOT, t.script);
        if (affected.has(scriptAbs)) {
          union.add(t.id);
          continue;
        }
        if (
          effectiveCovers(t).some((cover) =>
            affected.has(path.join(PROJECT_ROOT, cover)),
          )
        ) {
          union.add(t.id);
        }
      } // No reachable test is not proof that a source change is harmless.
      if (!tests.some((t) => union.has(t.id)) && seeds.length) {
        baseChanged.push(...rels);
        for (const t of tests)
          if (activeLayers.includes(t.layer)) union.add(t.id);
      }
    }
  }

  // Promote selected child scripts before applying runnable/layer filters.
  // This covers direct script edits, dependency closure and component selectors.
  for (const t of tests) {
    if (union.has(t.id) && t.aggregatedBy && !explicitIds.has(t.id))
      union.add(t.aggregatedBy);
  }
  if (narrowing) selectedIds = union;

  let selected = tests.filter((t) => activeLayers.includes(t.layer));
  const droppedByLayer = [];
  if (selectedIds) {
    selected = selected.filter((t) => selectedIds.has(t.id));
    for (const id of selectedIds) {
      const t = tests.find((x) => x.id === id);
      if (t && !activeLayers.includes(t.layer)) droppedByLayer.push(t);
    }
  }

  // Browser layer: default to the self-contained, non-aggregated set. Child
  // scripts of an aggregator and half-manual/dead scripts are excluded unless
  // the user forces them with an explicit --id.
  const excludedBrowser = [];
  if (activeLayers.includes("browser")) {
    selected = selected.filter((t) => {
      if (t.layer !== "browser" || browserRunnable(t)) return true;
      if (explicitIds.has(t.id)) return true;
      excludedBrowser.push(t);
      return false;
    });
  }

  // An explicit child plus its aggregator must still execute exactly once.
  const selectedSet = new Set(selected.map((t) => t.id));
  selected = selected.filter(
    (t) => !t.aggregatedBy || !selectedSet.has(t.aggregatedBy),
  );

  // Fail fast on missing scripts of selected tests.
  for (const t of selected) {
    const scriptAbs = path.join(PROJECT_ROOT, t.script);
    if (!fs.existsSync(scriptAbs)) {
      throw new Error(
        `script declared by manifest entry ${t.id} not found: ${t.script}`,
      );
    }
  }

  return {
    selected,
    activeLayers,
    reasons,
    baseChanged,
    relevantChanges,
    droppedByLayer,
    excludedBrowser,
    narrowing,
    changedCount: changedRels.length,
    fileSelectorUsed: opts.affected || opts.files.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function prefixStream(stream, prefix, sink) {
  const rl = readline.createInterface({ input: stream });
  rl.on("line", (line) => sink(`${prefix} ${line}`));
  return rl;
}

function runOne(test) {
  const started = Date.now();
  const scriptAbs = path.join(PROJECT_ROOT, test.script);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptAbs], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tag = `[${test.id}]`;
    prefixStream(child.stdout, tag, (line) => console.log(line));
    prefixStream(child.stderr, tag, (line) => console.error(line));
    child.on("error", (err) => {
      console.error(`${tag} failed to spawn: ${err.message}`);
      resolve({
        test,
        code: -1,
        signal: null,
        ms: Date.now() - started,
        ok: false,
      });
    });
    child.on("close", (code, signal) => {
      resolve({
        test,
        code,
        signal,
        ms: Date.now() - started,
        ok: code === 0 && !signal,
      });
    });
  });
}

async function runPool(items, jobs) {
  const queue = [...items];
  const results = [];
  const workers = Array.from(
    { length: Math.min(jobs, items.length) },
    async () => {
      while (queue.length) {
        const test = queue.shift();
        results.push(await runOne(test));
      }
    },
  );
  await Promise.all(workers);
  return results;
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const tests = loadManifest();
  const graphCtx = buildGraph();

  // Surface manifest covers that no longer resolve (metadata drift warning).
  for (const t of tests) {
    for (const cover of t.covers) {
      if (!fs.existsSync(path.join(PROJECT_ROOT, cover))) {
        console.warn(
          `warning: manifest entry ${t.id} covers missing file: ${cover}`,
        );
      }
    }
  }

  const selection = selectTests(tests, opts, graphCtx);

  // --- Audit the selection before running anything ---
  if (selection.narrowing) {
    if (selection.fileSelectorUsed) {
      if (selection.changedCount) {
        console.log(`changed files (${selection.changedCount}):`);
        const shown = selection.relevantChanges;
        const PREVIEW_LIMIT = 20;
        for (const rel of shown.slice(0, PREVIEW_LIMIT)) {
          console.log(`  - ${rel}`);
        }
        if (shown.length > PREVIEW_LIMIT) {
          console.log(`  ... ${shown.length - PREVIEW_LIMIT} more`);
        }
        const ignored =
          selection.changedCount - selection.relevantChanges.length;
        if (ignored > 0) {
          console.log(
            `  (${ignored} file(s) outside the src/scripts scan graph have no import edges)`,
          );
        }
      } else {
        console.log("no changed files inside the project scan scope");
      }
    }
    if (selection.baseChanged.length) {
      console.log(
        "shared base changed — widening to whole selected layer set:",
      );
      for (const rel of selection.baseChanged) console.log(`  ! ${rel}`);
      if (!selection.activeLayers.includes("browser")) {
        console.log(
          "hint: shared base changed; browser tests are skipped by default — rerun with --browser (npm run test:browser) before release.",
        );
      }
    }
    for (const reason of selection.reasons) console.log(`selector: ${reason}`);
  }

  if (selection.droppedByLayer.length) {
    console.log(
      `skipped by active layers (rerun with --browser/--all/--layer): ${selection.droppedByLayer
        .map((t) => `${t.id}(${t.layer})`)
        .join(", ")}`,
    );
  }

  if (selection.excludedBrowser.length) {
    const why = (t) =>
      t.aggregatedBy
        ? `child of aggregator ${t.aggregatedBy}`
        : "half-manual / needs an external server or out-of-tree fixture";
    console.log(
      `browser tests omitted (aggregated children already covered; standalone selfContained children allow --id, external fixtures require setup): ${selection.excludedBrowser
        .map((t) => `${t.id} (${why(t)})`)
        .join("; ")}`,
    );
  }

  if (!selection.selected.length) {
    if (selection.narrowing) {
      console.log("no affected tests");
    } else {
      console.log("no tests in selected layers");
    }
    return 0;
  }

  console.log(
    `will run ${selection.selected.length} test(s): ${selection.selected
      .map((t) => t.id)
      .join(", ")}`,
  );
  for (const layer of selection.activeLayers) {
    const ids = selection.selected
      .filter((t) => t.layer === layer)
      .map((t) => t.id);
    if (ids.length)
      console.log(`  ${layer} (${ids.length}): ${ids.join(", ")}`);
  }
  if (opts.list) {
    console.log("--list: plan only, not executing tests");
    return 0;
  }
  // Any browser test that survived filtering but is not in the default
  // self-contained set was forced via explicit --id; it needs an external
  // page server (aggregator BASE_URL) or an out-of-tree fixture.
  const forcedExternal = selection.selected.filter(
    (t) => t.layer === "browser" && t.selfContained !== true,
  );
  if (forcedExternal.length) {
    console.log(
      `note: ${forcedExternal
        .map((t) => t.id)
        .join(
          ", ",
        )} were forced via --id and need an external server / out-of-tree fixture`,
    );
  }
  console.log(
    `scheduling: fast layers concurrent (jobs=${opts.jobs}), browser serial`,
  );

  const runStarted = Date.now();
  const allResults = [];
  for (const layer of selection.activeLayers) {
    const layerTests = selection.selected.filter((t) => t.layer === layer);
    if (!layerTests.length) continue;
    const layerStarted = Date.now();
    console.log(
      `\n=== ${layer} layer: ${layerTests.length} test(s), ${
        layer === "browser" ? "serial" : `jobs=${opts.jobs}`
      } ===`,
    );
    const results =
      layer === "browser"
        ? await runPool(layerTests, 1)
        : await runPool(layerTests, opts.jobs);
    allResults.push(...results);
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    console.log(
      `--- ${layer} subtotal: ${passed} passed, ${failed} failed, ${fmtMs(
        Date.now() - layerStarted,
      )} ---`,
    );
  }

  const totalMs = Date.now() - runStarted;
  const failed = allResults.filter((r) => !r.ok);

  console.log(`\nresults (${allResults.length} tests, ${fmtMs(totalMs)}):`);
  for (const layer of selection.activeLayers) {
    for (const r of allResults.filter((x) => x.test.layer === layer)) {
      const status = r.ok ? "PASS" : "FAIL";
      const detail = !r.ok
        ? r.signal
          ? ` signal=${r.signal}`
          : ` exit=${r.code}`
        : "";
      console.log(
        `  ${status.padEnd(4)} ${r.test.id.padEnd(20)} ${fmtMs(r.ms).padStart(9)}${detail}`,
      );
    }
  }

  if (failed.length) {
    console.log(
      `\nfailed tests (${failed.length}): ${failed
        .map((r) => r.test.id)
        .join(", ")}`,
    );
    return 1;
  }
  console.log(`\nall ${allResults.length} selected tests passed`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`run-tests: ${err.message}`);
    process.exitCode = 2;
  });
