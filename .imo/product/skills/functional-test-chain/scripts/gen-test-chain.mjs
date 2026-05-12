import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ATOMS_PATH = path.join(ROOT, "testing", "atoms.yaml");
const DEFAULT_CHAINS_PATH = path.join(ROOT, "testing", "chains.yaml");
const BUNDLED_ATOMS_PATH = path.join(SCRIPT_DIR, "..", "references", "pingu", "atoms.yaml");
const BUNDLED_CHAINS_PATH = path.join(SCRIPT_DIR, "..", "references", "pingu", "chains.yaml");

function parseArgs(argv) {
  const options = {
    list: false,
    chain: null,
    format: "markdown",
    atoms: null,
    chains: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--list") {
      options.list = true;
      continue;
    }
    if (token === "--chain") {
      options.chain = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--format") {
      options.format = argv[i + 1] ?? "markdown";
      i += 1;
      continue;
    }
    if (token === "--atoms") {
      options.atoms = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--chains") {
      options.chains = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.list && !options.chain) {
    throw new Error("Either --list or --chain <ID> is required.");
  }

  if (!["markdown", "json"].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/gen-test-chain.mjs --list
  node scripts/gen-test-chain.mjs --chain MC-01
  node scripts/gen-test-chain.mjs --chain MC-01 --format json
  node scripts/gen-test-chain.mjs --atoms ./testing/atoms.yaml --chains ./testing/chains.yaml --chain MC-01`);
}

async function readJsonCompatibleYaml(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${filePath} is expected to be JSON-compatible YAML. ${error.message}`);
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAssetPath(explicitPath, defaultPath, bundledPath) {
  if (explicitPath) {
    return path.resolve(ROOT, explicitPath);
  }

  if (await pathExists(defaultPath)) {
    return defaultPath;
  }

  return bundledPath;
}

function buildIndexes(atomsDoc, chainsDoc) {
  const atomMap = new Map();
  for (const atom of atomsDoc.atoms ?? []) {
    atomMap.set(atom.id, atom);
  }

  const chainMap = new Map();
  for (const chain of chainsDoc.subchains ?? []) {
    chainMap.set(chain.id, { ...chain, kind: "subchain" });
  }
  for (const chain of chainsDoc.mainChains ?? []) {
    chainMap.set(chain.id, { ...chain, kind: "mainChain" });
  }

  return { atomMap, chainMap };
}

function listChains(chainsDoc) {
  return {
    subchains: (chainsDoc.subchains ?? []).map((chain) => ({
      id: chain.id,
      name: chain.name,
      goal: chain.goal,
    })),
    mainChains: (chainsDoc.mainChains ?? []).map((chain) => ({
      id: chain.id,
      name: chain.name,
      goal: chain.goal,
    })),
  };
}

function expandChain(chainId, indexes) {
  const { atomMap, chainMap } = indexes;
  const visited = new Set();
  const stack = [];

  function walk(ref) {
    if (atomMap.has(ref)) {
      return [
        {
          kind: "atom",
          ref,
          atom: atomMap.get(ref),
          path: [...stack, ref],
        },
      ];
    }

    const chain = chainMap.get(ref);
    if (!chain) {
      throw new Error(`Unknown reference: ${ref}`);
    }

    if (visited.has(ref)) {
      throw new Error(`Circular chain reference detected: ${[...stack, ref].join(" -> ")}`);
    }

    visited.add(ref);
    stack.push(ref);
    const steps = [];
    for (const child of chain.refs ?? []) {
      steps.push(...walk(child));
    }
    stack.pop();
    visited.delete(ref);

    return steps;
  }

  const root = chainMap.get(chainId);
  if (!root) {
    throw new Error(`Unknown chain id: ${chainId}`);
  }

  return {
    id: root.id,
    name: root.name,
    goal: root.goal,
    kind: root.kind,
    refs: root.refs ?? [],
    expandedSteps: walk(chainId),
  };
}

function toMarkdown(expanded) {
  const lines = [];
  lines.push(`# ${expanded.id} ${expanded.name}`);
  lines.push("");
  if (expanded.goal) {
    lines.push(`目标：${expanded.goal}`);
    lines.push("");
  }
  lines.push(`引用：${expanded.refs.join(" -> ")}`);
  lines.push("");
  lines.push("## 展开步骤");
  lines.push("");

  expanded.expandedSteps.forEach((step, index) => {
    const atom = step.atom;
    lines.push(`${index + 1}. ${atom.id} ${atom.action}`);
    lines.push(`   前置条件：${formatList(atom.preconditions)}`);
    lines.push(`   期望结果：${formatList(atom.expected)}`);
  });

  return lines.join("\n");
}

function formatList(items) {
  if (!items || items.length === 0) {
    return "无";
  }
  return items.join("；");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const atomsPath = await resolveAssetPath(options.atoms, DEFAULT_ATOMS_PATH, BUNDLED_ATOMS_PATH);
  const chainsPath = await resolveAssetPath(options.chains, DEFAULT_CHAINS_PATH, BUNDLED_CHAINS_PATH);
  const [atomsDoc, chainsDoc] = await Promise.all([
    readJsonCompatibleYaml(atomsPath),
    readJsonCompatibleYaml(chainsPath),
  ]);

  if (options.list) {
    const payload = listChains(chainsDoc);
    if (options.format === "json") {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    const lines = [];
    lines.push("# Available Chains");
    lines.push("");
    lines.push("## Subchains");
    for (const chain of payload.subchains) {
      lines.push(`- ${chain.id} ${chain.name}: ${chain.goal}`);
    }
    lines.push("");
    lines.push("## Main Chains");
    for (const chain of payload.mainChains) {
      lines.push(`- ${chain.id} ${chain.name}: ${chain.goal}`);
    }
    console.log(lines.join("\n"));
    return;
  }

  const expanded = expandChain(options.chain, buildIndexes(atomsDoc, chainsDoc));
  if (options.format === "json") {
    console.log(JSON.stringify(expanded, null, 2));
    return;
  }

  console.log(toMarkdown(expanded));
}

main().catch((error) => {
  console.error(`gen-test-chain failed: ${error.message}`);
  process.exit(1);
});
