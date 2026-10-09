#!/usr/bin/env node
/**
 * David feedback 桥接 CLI（agent 侧工具）。
 * 直接 import 真源 TS（project/src/lib/davidFeedback.ts），merge/parse 语义与页面永远同源，
 * 不会出现「agent 认为能合、页面拒绝」的裂缝。
 *
 * subcommands:
 *   pull   --slug <slug> [--from downloads|clipboard|file]
 *          [--dir <dir>] [--file <path>] [--snapshot <snapshot.json>]
 *   diff   --base <snapshot.json> --head <current.json>
 *   reply  --doc <current.json> --entry <id> --body <text> [--entry ... --body ...]
 *   verify --doc <a.json> --against <b.json>
 *
 * 安全约束：只读 ~/Downloads 与显式传入路径；写入前反向断言，拒绝写进 skill 目录；
 * 绝不触碰浏览器 profile / leveldb。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 真源 TS 可能位于 project/scripts（开发）或 skill 根 scripts 副本（build 产物）。
const feedbackSourceCandidates = [
  path.join(HERE, "../src/lib/davidFeedback.ts"),
  path.join(HERE, "../project/src/lib/davidFeedback.ts"),
];
const feedbackSource = feedbackSourceCandidates.find((candidate) =>
  fs.existsSync(candidate),
);
if (!feedbackSource) {
  throw new Error(
    `找不到 davidFeedback.ts 真源（尝试位置：${feedbackSourceCandidates.join(" / ")}）`,
  );
}
// project/src/lib/davidFeedback.ts -> ../../../ = skill 根目录
const skillRoot = path.resolve(path.dirname(feedbackSource), "../../..");

const loadFeedbackModule = async () => {
  try {
    return await import(pathToFileURL(feedbackSource).href);
  } catch (error) {
    const [major, minor] = process.versions.node.split(".").map(Number);
    const canStripTypes = major > 22 || (major === 22 && minor >= 18);
    const hint = canStripTypes
      ? ""
      : `\n当前 Node ${process.versions.node} 默认不支持 TS type stripping，` +
        `请使用 Node >= 22.18，或加 NODE_OPTIONS=--experimental-strip-types 运行。`;
    throw new Error(
      `无法导入反馈逻辑源 ${feedbackSource}: ${error.message}${hint}`,
      { cause: error },
    );
  }
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 --${key} 缺少值`);
    }
    if (key in args) {
      args[key] = Array.isArray(args[key])
        ? [...args[key], value]
        : [args[key], value];
    } else {
      args[key] = value;
    }
    i += 1;
  }
  return args;
};

const listArg = (value) =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 覆盖 Chrome 下载去重命名：`<slug>-feedback.json` 与 `<slug>-feedback (1).json`
const feedbackFilePattern = (slug) =>
  new RegExp(`^${escapeRegExp(slug)}-feedback(?: \\(\\d+\\))?\\.json$`, "i");

const stripJsonPreamble = (raw) => {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("内容中没有找到 JSON 对象起始符 '{'");
  return raw.slice(start);
};

const readRawFeedbackDoc = (mod, raw) => {
  const json = JSON.parse(stripJsonPreamble(raw));
  return mod.parseFeedback(json);
};

const runCapture = (cmd) => {
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (result.status !== 0 || result.error) {
    throw new Error(
      `${cmd[0]} 执行失败: ${result.stderr || result.error?.message || ""}`.trim(),
    );
  }
  return result.stdout;
};

const readClipboard = () => {
  if (process.platform === "darwin") return runCapture(["pbpaste"]);
  if (process.platform === "linux") {
    for (const cmd of [["wl-paste"], ["xclip", "-o"]]) {
      try {
        const out = runCapture(cmd);
        if (out) return out;
      } catch {
        // try next clipboard tool
      }
    }
    throw new Error("剪贴板读取失败：Linux 需要 wl-paste 或 xclip");
  }
  throw new Error(`剪贴板读取在平台 ${process.platform} 不可用`);
};

const sha256Hex = (input) =>
  crypto.createHash("sha256").update(input).digest("hex");

// 确定性回复 id：同 entry+body 必得同 id，重放天然幂等。
const agentReplyId = (entryId, body) =>
  `agent-${sha256Hex(`${entryId}\n${body}`).slice(0, 16)}`;

// 确定性回复 createdAt：与 id 同源（sha256(entryId + "\n" + body)），
// 固定基准时间 + 哈希派生偏移，保证同输入必得同时间戳（重放幂等）。
// 偏移落在 2026 自然年内，时间看起来合理（不落 1970，也不跑到荒谬未来）。
const AGENT_REPLY_EPOCH_MS = Date.UTC(2026, 0, 1);
const AGENT_REPLY_SPAN_MS = Date.UTC(2027, 0, 1) - AGENT_REPLY_EPOCH_MS;

const agentReplyCreatedAt = (entryId, body) => {
  const hash = sha256Hex(`${entryId}\n${body}`);
  const fraction = Number.parseInt(hash.slice(16, 24), 16) / 0xffffffff;
  return new Date(
    AGENT_REPLY_EPOCH_MS + Math.floor(fraction * AGENT_REPLY_SPAN_MS),
  ).toISOString();
};

// 兼容裸 feedback doc 与 pull 输出（带 { ..., doc }）两种输入。
const readFeedbackDoc = (mod, file, label) => {
  let rawJson;
  try {
    rawJson = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`${label} 读取失败: ${error.message}`, { cause: error });
  }
  const candidate =
    rawJson &&
    typeof rawJson === "object" &&
    !Array.isArray(rawJson) &&
    rawJson.doc
      ? rawJson.doc
      : rawJson;
  return mod.parseFeedback(candidate);
};

// 写入前反向断言：拒绝把工作产物写进 skill 目录。
const assertOutsideSkillRoot = (target) => {
  const resolved = path.resolve(target);
  const relative = path.relative(path.resolve(skillRoot), resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new Error(
      `拒绝写入 skill 目录: ${resolved}（工作产物请放到数据目录，如 ~/Downloads）`,
    );
  }
};

const printJson = (value) =>
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");

const totalReplies = (doc) =>
  doc.entries.reduce((n, entry) => n + (entry.replies?.length ?? 0), 0);

const cmdPull = async (args) => {
  const mod = await loadFeedbackModule();
  const slug = args.slug;
  if (!slug) throw new Error("pull 需要 --slug");
  const from = args.from ?? "downloads";

  let raw;
  let sourcePath;
  let mtimeMs;

  if (from === "downloads") {
    const dir = args.dir
      ? path.resolve(args.dir)
      : path.join(os.homedir(), "Downloads");
    let latest = null;
    if (fs.existsSync(dir)) {
      const pattern = feedbackFilePattern(slug);
      for (const name of fs.readdirSync(dir)) {
        if (!pattern.test(name)) continue;
        const filePath = path.join(dir, name);
        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        if (!latest || stat.mtimeMs > latest.stat.mtimeMs) {
          latest = { filePath, stat };
        }
      }
    }
    if (!latest) {
      throw new Error(`未在 ${dir} 找到 ${slug}-feedback*.json`);
    }
    raw = fs.readFileSync(latest.filePath, "utf8");
    sourcePath = latest.filePath;
    mtimeMs = latest.stat.mtimeMs;
  } else if (from === "clipboard") {
    raw = readClipboard();
    sourcePath = "clipboard";
    mtimeMs = Date.now();
  } else if (from === "file") {
    if (!args.file) throw new Error("--from file 需要 --file");
    raw = fs.readFileSync(path.resolve(args.file), "utf8");
    sourcePath = path.resolve(args.file);
    mtimeMs = fs.statSync(sourcePath).mtimeMs;
  } else {
    throw new Error(`--from 非法: ${from}（downloads|clipboard|file）`);
  }

  const doc = readRawFeedbackDoc(mod, raw);
  const output = {
    path: sourcePath,
    mtime: new Date(mtimeMs).toISOString(),
    sha256: sha256Hex(raw),
    slug: doc.slug,
    entries: doc.entries.length,
    replies: totalReplies(doc),
    updatedAt: doc.updatedAt,
    doc,
  };

  if (args.snapshot) {
    const snapshotJson = JSON.parse(
      fs.readFileSync(path.resolve(args.snapshot), "utf8"),
    );
    const snapshotTime = new Date(snapshotJson.updatedAt).getTime();
    if (mtimeMs < snapshotTime) {
      output.stale = true;
      output.staleReason =
        `本文件修改时间 (${output.mtime}) 早于指定 snapshot 的 updatedAt (` +
        `${new Date(snapshotTime).toISOString()})，这份数据可能不够新`;
      process.stderr.write(
        `[david-feedback] WARN STALE — ${output.staleReason}\n`,
      );
    }
  }

  if (doc.slug !== slug) {
    process.stderr.write(
      `[david-feedback] WARN slug 不匹配：文件内 doc.slug=${doc.slug}，请求 --slug=${slug}\n`,
    );
  }
  printJson(output);
};

const cmdDiff = async (args) => {
  const mod = await loadFeedbackModule();
  if (!args.base || !args.head) throw new Error("diff 需要 --base 与 --head");
  const baseDoc = readFeedbackDoc(mod, args.base, "base");
  const headDoc = readFeedbackDoc(mod, args.head, "head");
  const baseEntries = new Map(
    baseDoc.entries.map((entry) => [entry.id, entry]),
  );

  const newEntries = [];
  const suggestionChanged = [];
  const newUserReplies = [];
  const needsAgentConclusion = [];

  for (const entry of headDoc.entries) {
    const baseEntry = baseEntries.get(entry.id);
    const baseUserReplies =
      baseEntry?.replies?.filter(
        (reply) => mod.replyAuthor(reply) === "user",
      ) ?? [];
    const headUserReplies =
      entry.replies?.filter((reply) => mod.replyAuthor(reply) === "user") ?? [];
    const newUser = headUserReplies.filter(
      (reply) =>
        !baseUserReplies.some(
          (base) => base.id === reply.id && base.body === reply.body,
        ),
    );
    const agentReplies =
      entry.replies?.filter((reply) => mod.replyAuthor(reply) === "agent") ??
      [];
    const hasAgentConclusion = agentReplies.length > 0;

    if (!baseEntry) {
      newEntries.push({ id: entry.id, entry });
    } else if (baseEntry.suggestion !== entry.suggestion) {
      suggestionChanged.push({
        id: entry.id,
        base: baseEntry.suggestion,
        head: entry.suggestion,
      });
    }
    if (newUser.length > 0) {
      newUserReplies.push({ id: entry.id, replies: newUser });
    }
    if (newUser.length > 0 && !hasAgentConclusion) {
      needsAgentConclusion.push(entry.id);
    }
    // 已处理（有 agent 结论）或无用户新意见的条目，即使 status=open 也不输出，
    // 避免反复处理同一条。
  }

  printJson({
    base: {
      slug: baseDoc.slug,
      updatedAt: baseDoc.updatedAt,
      entries: baseDoc.entries.length,
    },
    head: {
      slug: headDoc.slug,
      updatedAt: headDoc.updatedAt,
      entries: headDoc.entries.length,
    },
    newEntries,
    suggestionChanged,
    newUserReplies,
    needsAgentConclusion,
    summary: {
      newEntries: newEntries.length,
      suggestionChanged: suggestionChanged.length,
      newUserReplies: newUserReplies.length,
      needsAgentConclusion: needsAgentConclusion.length,
      headEntries: headDoc.entries.length,
    },
  });
};

const cmdReply = async (args) => {
  const mod = await loadFeedbackModule();
  if (!args.doc) throw new Error("reply 需要 --doc");
  const entryIds = listArg(args.entry);
  const bodies = listArg(args.body);
  if (entryIds.length === 0) throw new Error("reply 需要至少一个 --entry");
  if (entryIds.length !== bodies.length) {
    throw new Error("--entry 与 --body 数量必须一致");
  }

  const original = readFeedbackDoc(mod, args.doc, "doc");
  let working = original;
  const replayed = [];
  for (let i = 0; i < entryIds.length; i += 1) {
    const entryId = entryIds[i];
    const bodyText = bodies[i].trim();
    if (!bodyText) throw new Error("reply body 不能为空");
    const id = agentReplyId(entryId, bodyText);
    const target = working.entries.find((entry) => entry.id === entryId);
    if (!target) throw new Error(`feedback 条目不存在: ${entryId}`);
    if ((target.replies ?? []).some((reply) => reply.id === id)) {
      // 同确定性 id 已存在：重放，不重复发帖。
      replayed.push(entryId);
      continue;
    }
    working = mod.appendFeedbackReply(working, entryId, {
      id,
      body: bodyText,
      createdAt: agentReplyCreatedAt(entryId, bodyText),
      author: "agent",
    });
  }

  // delta doc：只含被回复的 entry，base 字段逐字从 --doc 抄（suggestion/category/
  // createdAt/status/scope 任一不一致整份导入都会炸）。
  const repliedIds = new Set(entryIds);
  const delta = {
    schema: working.schema,
    schemaVersion: working.schemaVersion,
    slug: working.slug,
    updatedAt: working.updatedAt,
    mode: working.mode,
    entries: working.entries
      .filter((entry) => repliedIds.has(entry.id))
      .map((entry) => ({ ...entry })),
  };
  // 自检：与原 doc 必须能安全合并，否则这份 delta 写回必然失败。
  mod.mergeFeedbackDocuments(original, delta);

  const outPath = path.join(
    process.cwd(),
    `${original.slug}-feedback.agent.json`,
  );
  assertOutsideSkillRoot(outPath);
  fs.writeFileSync(outPath, JSON.stringify(delta, null, 2) + "\n");

  printJson({
    output: outPath,
    slug: original.slug,
    entries: delta.entries.map((entry) => entry.id),
    replayed,
  });

  if (process.platform === "darwin") {
    try {
      spawnSync("pbcopy", [], {
        input: JSON.stringify(delta, null, 2),
        encoding: "utf8",
      });
    } catch (error) {
      // pbcopy 失败只警告，不阻断。
      process.stderr.write(
        `[david-feedback] WARN pbcopy 失败（忽略）: ${error.message}\n`,
      );
    }
  }
};

const cmdVerify = async (args) => {
  const mod = await loadFeedbackModule();
  if (!args.doc || !args.against)
    throw new Error("verify 需要 --doc 与 --against");
  const a = readFeedbackDoc(mod, args.doc, "doc");
  const b = readFeedbackDoc(mod, args.against, "against");
  const bEntries = new Map(b.entries.map((entry) => [entry.id, entry]));
  const missing = [];
  let checked = 0;
  for (const entry of a.entries) {
    const agentReplies = (entry.replies ?? []).filter(
      (reply) => mod.replyAuthor(reply) === "agent",
    );
    if (agentReplies.length === 0) continue;
    const other = bEntries.get(entry.id);
    if (!other) {
      missing.push({ id: entry.id, reason: "against 缺少该 entry" });
      continue;
    }
    const otherReplies = new Map(
      (other.replies ?? []).map((reply) => [reply.id, reply]),
    );
    for (const reply of agentReplies) {
      checked += 1;
      const matching = otherReplies.get(reply.id);
      if (!matching) {
        missing.push({
          id: entry.id,
          replyId: reply.id,
          reason: "agent 回复缺失",
        });
      } else if (
        matching.body !== reply.body ||
        matching.createdAt !== reply.createdAt
      ) {
        missing.push({
          id: entry.id,
          replyId: reply.id,
          reason: "agent 回复内容不一致",
        });
      }
    }
  }
  if (missing.length > 0) {
    process.stderr.write(
      JSON.stringify({ ok: false, checked, missing }, null, 2) + "\n",
    );
    process.exit(1);
  }
  printJson({ ok: true, checked });
};

const usage = () => {
  console.error(`david-feedback — agent 侧 David feedback 桥接工具

用法:
  node david-feedback.mjs pull    --slug <slug> [--from downloads|clipboard|file] [--dir <dir>] [--file <path>] [--snapshot <snapshot.json>]
  node david-feedback.mjs diff    --base <snapshot.json> --head <current.json>
  node david-feedback.mjs reply   --doc <current.json> --entry <id> --body <text> [--entry ... --body ...]
  node david-feedback.mjs verify  --doc <a.json> --against <b.json>
`);
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  try {
    switch (command) {
      case "pull":
        await cmdPull(parseArgs(rest));
        break;
      case "diff":
        await cmdDiff(parseArgs(rest));
        break;
      case "reply":
        await cmdReply(parseArgs(rest));
        break;
      case "verify":
        await cmdVerify(parseArgs(rest));
        break;
      default:
        usage();
        process.exit(2);
    }
  } catch (error) {
    process.stderr.write(
      `[david-feedback] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
};

main();
