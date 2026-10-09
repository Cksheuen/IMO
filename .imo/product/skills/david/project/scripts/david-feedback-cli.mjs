#!/usr/bin/env node
/**
 * David 评论服务 agent CLI。
 *
 * 存在意义：让没有 computer-use 能力的 agent（Claude Code 等）也能读写评审页评论。
 * 在此之前 agent 只能靠浏览器自动化点 David 面板导出 JSON，SKILL.md 的反馈闭环
 * 因此绑死在 Codex CUA 上。
 *
 * 边界：
 * - 一切读写都过 serve-feedback.mjs，由服务端复用 davidFeedback.ts 的纯函数校验；
 *   agent 不允许裸写 JSON 文件，否则纯 prompt 生成的结构必然 schema 漂移。
 * - 所有写命令成功后强制回读确认（SKILL.md 反馈工作流的「写回后重新读取确认」）。
 *
 * 退出码：0 成功；2 参数错误；3 冲突（409，需重读重放）；4 服务不可达；5 回读未命中。
 *
 * 用法：
 *   serve
 *   list
 *   get      <slug>
 *   since    <slug>
 *   add      <slug> --category <c> --suggestion <s> [--origin agent|user] [--id <id>]
 *   reply    <slug> <entryId> --body <text> [--id <id>] [--author user]
 *   status   <slug> <entryId> --value <open|resolved>
 *   decision <slug> <entryId> --value <accepted|rejected>
 *
 * HARD-GATE 26：reply 默认以 agent 身份写回（author:"agent"），且默认 id /
 * id 确定性派生（agent-<hash>）；createdAt 由服务首次接收时写入，重放复用。
 * 同 entry+body 重复调用由服务端 merge 幂等跳过。
 * --author user 仅供人工写评论（默认随机 id / 当前时间）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DAVID_FEEDBACK_PORT || 5180);
const BASE = `http://127.0.0.1:${PORT}`;

const imoRoot = process.env.IMO_GLOBAL_ROOT
  ? path.resolve(process.env.IMO_GLOBAL_ROOT)
  : path.join(os.homedir(), ".imo");
const agentDir = path.join(imoRoot, "runtime", "david", "agent");

const CATEGORIES = ["visual", "interaction", "content", "schema", "other"];

class CliError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

const out = (payload) => console.log(JSON.stringify(payload, null, 2));
const note = (msg) => console.error(msg);

const parseArgs = (argv) => {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`参数 --${key} 缺少值`);
    }
    flags[key] = value;
    i += 1;
  }
  return { positional, flags };
};

const request = async (method, urlPath, body) => {
  let response;
  try {
    response = await fetch(`${BASE}${urlPath}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CliError(
      `评论服务未启动或不可达（${BASE}）。请先运行：\n` +
        `  node ${path.relative(process.cwd(), path.join(HERE, "david-feedback-cli.mjs"))} serve`,
      4,
    );
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new CliError(
      `服务返回非 JSON（${response.status}）: ${text.slice(0, 200)}`,
      2,
    );
  }
  if (response.status === 409) {
    note("冲突：服务端拒绝覆盖。请重读当前数据、保留用户编辑后重试。");
    out({ conflict: true, status: 409, ...payload });
    process.exit(3);
  }
  if (!response.ok) {
    throw new CliError(
      `${method} ${urlPath} 失败（${response.status}）: ${payload.error ?? text}`,
      2,
    );
  }
  return payload;
};

const health = async () => {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
};

// ── HARD-GATE 26 确定性工具 ─────────────────────────────────────────────────
// 与旧离线桥保持同一 id 派生方式；服务保留已有 reply 的时间与位置。

const sha256Hex = (input) =>
  crypto.createHash("sha256").update(input).digest("hex");

/** 确定性 agent 回复 id：`agent-<hash(entryId\nbody)>`（前 16 位）。 */
const agentReplyId = (entryId, body) =>
  `agent-${sha256Hex(`${entryId}\n${body}`).slice(0, 16)}`;

// ── 命令 ────────────────────────────────────────────────────────────────────

const cmdServe = async () => {
  const existing = await health();
  if (existing) {
    note(`评论服务已在运行（pid ${existing.pid}, port ${existing.port}）`);
    out({ ok: true, alreadyRunning: true, ...existing });
    return;
  }
  const child = spawn(
    process.execPath,
    [path.join(HERE, "serve-feedback.mjs")],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.unref();
  // 轮询等就绪：daemon 要加载 TS 真源，冷启动可能需要一两秒。
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await health();
    if (ready) {
      note(`评论服务已启动（pid ${ready.pid}, port ${ready.port}）`);
      out({ ok: true, started: true, ...ready });
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new CliError(`评论服务启动超时（10s），端口 ${PORT}`, 4);
};

const cmdList = async () => out(await request("GET", "/index"));

const cmdGet = async (slug) => {
  if (!slug) throw new CliError("用法: get <slug>");
  out(await request("GET", `/feedback/${encodeURIComponent(slug)}`));
};

/**
 * 增量：与上次处理快照比对。
 * 按 SKILL.md 语义 —— 已有 entry id 上的新用户编辑、新回复仍是待处理工作，
 * 只有 id 与内容/回复完全相同的条目才跳过。
 */
const cmdSince = async (slug) => {
  if (!slug) throw new CliError("用法: since <slug>");
  const { doc, version } = await request(
    "GET",
    `/feedback/${encodeURIComponent(slug)}`,
  );
  const snapshotFile = path.join(agentDir, `${slug}.processed.json`);
  let previous = { entries: [] };
  if (fs.existsSync(snapshotFile)) {
    try {
      previous = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
    } catch {
      note(`上次快照损坏，按全量处理: ${snapshotFile}`);
    }
  }
  const fingerprint = (entry) =>
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          suggestion: entry.suggestion,
          category: entry.category,
          status: entry.status,
          decision: entry.decision,
          replies: (entry.replies ?? []).map((r) => [r.id, r.body]),
        }),
      )
      .digest("hex");
  const seen = new Map(
    (previous.entries ?? []).map((e) => [e.id, e.fingerprint]),
  );
  const pending = doc.entries.filter(
    (entry) => seen.get(entry.id) !== fingerprint(entry),
  );
  out({
    slug,
    version,
    total: doc.entries.length,
    pendingCount: pending.length,
    pending,
    snapshotFile,
    hint: "处理完成后用 --commit 记录快照",
  });
};

const commitSnapshot = (slug, doc) => {
  fs.mkdirSync(agentDir, { recursive: true });
  const fingerprint = (entry) =>
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          suggestion: entry.suggestion,
          category: entry.category,
          status: entry.status,
          decision: entry.decision,
          replies: (entry.replies ?? []).map((r) => [r.id, r.body]),
        }),
      )
      .digest("hex");
  const snapshot = {
    slug,
    updatedAt: new Date().toISOString(),
    entries: doc.entries.map((e) => ({
      id: e.id,
      fingerprint: fingerprint(e),
    })),
  };
  fs.writeFileSync(
    path.join(agentDir, `${slug}.processed.json`),
    JSON.stringify(snapshot, null, 2),
  );
};

/** 写后回读：确认目标真的落库，否则退出码 5。禁止只凭 200 就宣称成功。 */
const verifyAfterWrite = async (slug, predicate, what) => {
  const { doc, version } = await request(
    "GET",
    `/feedback/${encodeURIComponent(slug)}`,
  );
  const hit = predicate(doc);
  if (!hit) {
    out({ verified: false, slug, version, error: `回读未命中${what}` });
    process.exit(5);
  }
  return { doc, version };
};

const cmdAdd = async (slug, flags) => {
  if (!slug)
    throw new CliError("用法: add <slug> --category <c> --suggestion <s>");
  const category = flags.category;
  if (!CATEGORIES.includes(category)) {
    throw new CliError(`--category 必须是 ${CATEGORIES.join(" | ")}`);
  }
  if (!flags.suggestion) throw new CliError("缺少 --suggestion");
  const entry = {
    id: flags.id || crypto.randomUUID(),
    category,
    suggestion: flags.suggestion,
    createdAt: new Date().toISOString(),
    origin: flags.origin || "agent",
  };
  await request("POST", `/feedback/${encodeURIComponent(slug)}/entries`, {
    entry,
  });
  const { doc, version } = await verifyAfterWrite(
    slug,
    (d) => d.entries.some((e) => e.id === entry.id),
    `条目 ${entry.id}`,
  );
  out({
    verified: true,
    slug,
    version,
    entryId: entry.id,
    entries: doc.entries.length,
  });
};

const cmdReply = async (slug, entryId, flags) => {
  if (!slug || !entryId)
    throw new CliError(
      "用法: reply <slug> <entryId> --body <text> [--id <id>] [--author user]",
    );
  if (!flags.body) throw new CliError("缺少 --body");
  // HARD-GATE 26：reply 是 agent 写回路径，缺省 author="agent"（页面据此渲染徽标），
  // 默认 id 确定性派生，服务首次接收时补时间，重放保留旧时间。
  const author = flags.author === "user" ? "user" : "agent";
  const reply =
    author === "agent"
      ? {
          id: flags.id || agentReplyId(entryId, flags.body),
          body: flags.body,
          author: "agent",
        }
      : {
          id: flags.id || crypto.randomUUID(),
          body: flags.body,
        };
  await request(
    "PATCH",
    `/feedback/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}/replies`,
    { reply },
  );
  const { doc, version } = await verifyAfterWrite(
    slug,
    (d) =>
      d.entries
        .find((e) => e.id === entryId)
        ?.replies?.some((r) => r.id === reply.id) ?? false,
    `回复 ${reply.id}`,
  );
  const target = doc.entries.find((e) => e.id === entryId);
  out({
    verified: true,
    slug,
    version,
    entryId,
    replyId: reply.id,
    replies: target?.replies?.length ?? 0,
  });
};

const cmdPatchField = async (field, allowed, slug, entryId, flags) => {
  if (!slug || !entryId) {
    throw new CliError(
      `用法: ${field} <slug> <entryId> --value <${allowed.join("|")}>`,
    );
  }
  const value = flags.value;
  if (!allowed.includes(value)) {
    throw new CliError(`--value 必须是 ${allowed.join(" | ")}`);
  }
  await request(
    "PATCH",
    `/feedback/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}`,
    { [field]: value },
  );
  const { doc, version } = await verifyAfterWrite(
    slug,
    (d) => d.entries.find((e) => e.id === entryId)?.[field] === value,
    `${field}=${value}`,
  );
  out({
    verified: true,
    slug,
    version,
    entryId,
    [field]: value,
    total: doc.entries.length,
  });
};

const cmdReorderReplies = async (slug, entryId, flags) => {
  if (!slug || !entryId || !flags.order) {
    throw new CliError(
      "用法: reorder-replies <slug> <entryId> --order <JSON reply id 数组>",
    );
  }
  const replyOrder = JSON.parse(flags.order);
  const { version: expectedVersion } = await request(
    "GET",
    `/feedback/${encodeURIComponent(slug)}`,
  );
  await request(
    "PATCH",
    `/feedback/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}`,
    {
      replyOrder,
      expectedVersion,
    },
  );
  const { version } = await verifyAfterWrite(
    slug,
    (doc) =>
      JSON.stringify(
        doc.entries
          .find((entry) => entry.id === entryId)
          ?.replies?.map((reply) => reply.id) ?? [],
      ) === JSON.stringify(replyOrder),
    `回复顺序 ${entryId}`,
  );
  out({ verified: true, slug, entryId, version, replyOrder });
};

// ── 入口 ────────────────────────────────────────────────────────────────────

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  switch (command) {
    case "serve":
      return cmdServe();
    case "list":
      return cmdList();
    case "get":
      return cmdGet(positional[0]);
    case "since":
      if (flags.commit !== undefined || positional[1] === "--commit") {
        const slug = positional[0];
        const { doc } = await request(
          "GET",
          `/feedback/${encodeURIComponent(slug)}`,
        );
        commitSnapshot(slug, doc);
        out({ committed: true, slug, entries: doc.entries.length });
        return undefined;
      }
      return cmdSince(positional[0]);
    case "commit":
      {
        const slug = positional[0];
        if (!slug) throw new CliError("用法: commit <slug>");
        const { doc } = await request(
          "GET",
          `/feedback/${encodeURIComponent(slug)}`,
        );
        commitSnapshot(slug, doc);
        out({ committed: true, slug, entries: doc.entries.length });
      }
      return undefined;
    case "add":
      return cmdAdd(positional[0], flags);
    case "reply":
      return cmdReply(positional[0], positional[1], flags);
    case "reorder-replies":
      return cmdReorderReplies(positional[0], positional[1], flags);
    case "status":
      return cmdPatchField(
        "status",
        ["open", "resolved"],
        positional[0],
        positional[1],
        flags,
      );
    case "decision":
      return cmdPatchField(
        "decision",
        ["accepted", "rejected"],
        positional[0],
        positional[1],
        flags,
      );
    default:
      throw new CliError(
        `未知命令: ${command ?? "(空)"}\n` +
          "可用: serve | list | get | since | commit | add | reply | reorder-replies | status | decision",
      );
  }
};

main().catch((error) => {
  const code = error instanceof CliError ? error.code : 2;
  note(`error: ${error.message}`);
  out({ ok: false, error: error.message });
  process.exit(code);
});
