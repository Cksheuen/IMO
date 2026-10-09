#!/usr/bin/env node
/**
 * David 本地评论服务 daemon（HARD-GATE 25 的 loopback 例外）。
 *
 * 存在意义：评审页与 agent 需要同一份可读写的评论数据。页面在 file:// 或任意静态
 * 端口下打开，localStorage 按 origin 隔离且 agent 无法访问，因此把评论收敛到本机
 * 服务：页面经 fetch 读写，agent 经 david-feedback-cli.mjs 读写，两侧同源。
 *
 * 边界：
 * - 只绑 127.0.0.1，数据只落本机磁盘，绝不出网（不得声称同步飞书 / GitHub）。
 * - 无 token：评审页是要发给别人看的产物，注入凭据会随文件外泄。安全边界 =
 *   loopback 绑定 + slug 白名单校验（防路径穿越）。
 * - schema 校验与并发合并语义全部复用 src/lib/davidFeedback.ts 的纯函数，
 *   不在此另写一套，避免「agent 认为能合、页面拒绝」的裂缝。
 *
 * 用法：node scripts/serve-feedback.mjs
 *   DAVID_FEEDBACK_PORT  监听端口（默认 5180）
 *   IMO_GLOBAL_ROOT      存储根（默认 ~/.imo）
 */
import { createMaterialStore } from "./review-material-store.mjs";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DAVID_FEEDBACK_PORT || 5180);
const HOST = "127.0.0.1";
const BODY_LIMIT = 5 * 1024 * 1024;

// ── 真源加载 ────────────────────────────────────────────────────────────────
// 与 david-feedback.mjs 保持同一种加载方式：Node >= 22.18 原生 type stripping。
const feedbackSourceCandidates = [
  path.join(HERE, "../src/lib/davidFeedback.ts"),
  path.join(HERE, "../project/src/lib/davidFeedback.ts"),
];
const feedbackSource = feedbackSourceCandidates.find((c) => fs.existsSync(c));
if (!feedbackSource) {
  throw new Error(
    `找不到 davidFeedback.ts 真源（尝试：${feedbackSourceCandidates.join(" / ")}）`,
  );
}
let David;
try {
  David = await import(pathToFileURL(feedbackSource).href);
} catch (error) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const canStrip = major > 22 || (major === 22 && minor >= 18);
  throw new Error(
    `无法导入 ${feedbackSource}: ${error.message}` +
      (canStrip
        ? ""
        : `\n当前 Node ${process.versions.node} 不支持 TS type stripping，` +
          `请用 Node >= 22.18 或 NODE_OPTIONS=--experimental-strip-types`),
    { cause: error },
  );
}
const {
  parseFeedback,
  createFeedbackDocument,
  mergeFeedbackDocuments,
  buildFeedbackIndex,
  setFeedbackEntryStatus,
  setFeedbackEntryDecision,
  setFeedbackEntrySuggestion,
  appendFeedbackSelection,
  reorderFeedbackReplies,
} = David;

// ── 存储 ────────────────────────────────────────────────────────────────────
const imoRoot = process.env.IMO_GLOBAL_ROOT
  ? path.resolve(process.env.IMO_GLOBAL_ROOT)
  : path.join(os.homedir(), ".imo");
const storeDir = path.join(imoRoot, "runtime", "david", "feedback");
const metaFile = path.join(storeDir, ".meta.json");
const materials = createMaterialStore(
  path.join(imoRoot, "runtime", "david", "materials"),
);
fs.mkdirSync(storeDir, { recursive: true });

/**
 * slug 白名单校验 —— 防路径穿越的唯一防线，必须在任何路径拼接之前调用。
 * 只允许 [A-Za-z0-9._-]，长度 1..128，且拒绝 "." / ".."。
 */
const isValidSlug = (slug) =>
  typeof slug === "string" &&
  slug.length > 0 &&
  slug.length <= 128 &&
  /^[A-Za-z0-9._-]+$/.test(slug) &&
  slug !== "." &&
  slug !== "..";

const docPath = (slug) => path.join(storeDir, `${slug}.json`);

/** 原子写：先写 .tmp 再 rename，避免读到半截文件。 */
const writeJsonAtomic = (target, value) => {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, target);
};

const readMeta = () => {
  if (!fs.existsSync(metaFile)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    // meta 只是版本号缓存，损坏时重建即可，不影响 doc 本体。
    return {};
  }
};

const versionOf = (slug) => {
  const entry = readMeta()[slug];
  return entry && Number.isInteger(entry.version) ? entry.version : 0;
};

const bumpVersion = (slug) => {
  const meta = readMeta();
  const next = versionOf(slug) + 1;
  meta[slug] = { ...(meta[slug] || {}), version: next };
  writeJsonAtomic(metaFile, meta);
  return next;
};

const readDoc = (slug) => {
  const file = docPath(slug);
  if (!fs.existsSync(file)) return undefined;
  return parseFeedback(JSON.parse(fs.readFileSync(file, "utf8")));
};

/** 文档内容相等性（忽略 doc 级 updatedAt：合并总会刷新时间戳，不算内容变化）。 */
const feedbackContentEqual = (left, right) =>
  left.schema === right.schema &&
  left.schemaVersion === right.schemaVersion &&
  left.slug === right.slug &&
  left.mode === right.mode &&
  JSON.stringify(left.entries) === JSON.stringify(right.entries);

const writeDoc = (slug, doc) => {
  // 落盘前再过一次 parseFeedback：任何写入路径都不能绕过 schema 校验。
  const validated = parseFeedback(doc);
  const file = docPath(slug);
  if (fs.existsSync(file)) {
    let existing;
    try {
      existing = parseFeedback(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // 有效的显式 PUT 可以覆盖损坏文件；原文件不会被读作活动数据。
      existing = null;
    }
    if (existing && feedbackContentEqual(existing, validated)) {
      // 幂等重放 / 无内容写：不写盘、不 bump 版本（unchanged）。版本号只反映
      // 内容变化，重复同内容写（如重放同一条 agent 回复）不应让单调版本爬升。
      return { doc: existing, version: versionOf(slug), unchanged: true };
    }
  }
  writeJsonAtomic(file, validated);
  return { doc: validated, version: bumpVersion(slug) };
};

const listSlugs = () =>
  fs
    .readdirSync(storeDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map((f) => f.slice(0, -5))
    .filter(isValidSlug);

// ── HTTP 基础 ───────────────────────────────────────────────────────────────
// CORS 全开：页面可能从 file:// 打开（Origin: null），无法白名单化。
// 这不放大攻击面 —— 服务只绑 loopback，且不存任何凭据。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,If-Match",
  "Access-Control-Max-Age": "600",
};

const send = (res, status, payload, extraHeaders = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...CORS,
    ...extraHeaders,
  });
  res.end(body);
};

const readBody = (req, limit = BODY_LIMIT) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(
          Object.assign(new Error(`请求体超过 ${limit / 1024 / 1024}MB`), {
            httpStatus: 413,
          }),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(
          Object.assign(new Error(`请求体不是合法 JSON: ${error.message}`), {
            httpStatus: 400,
          }),
        );
      }
    });
    req.on("error", reject);
  });

/**
 * 乐观并发：客户端可选带 expectedVersion。不符即 409 并回带当前状态，
 * 供调用方重读、重放。这样页面与 agent 的并发写不会静默覆盖对方。
 */
const conflict = (res, slug, message) =>
  send(res, 409, {
    error: message,
    currentDoc: readDoc(slug) ?? null,
    currentVersion: versionOf(slug),
  });

const okDoc = (res, slug, doc) => {
  const saved = writeDoc(slug, doc);
  send(res, 200, saved, { ETag: `"${saved.version}"` });
};

/** 把一条 entry 包成完整文档过 parseFeedback —— parseFeedbackEntry 未导出。 */
const validateEntry = (slug, entry) =>
  parseFeedback({
    schema: "david-feedback/v1",
    schemaVersion: 1,
    slug,
    updatedAt: new Date().toISOString(),
    mode: "integrated",
    entries: [entry],
  }).entries[0];

// ── 路由 ────────────────────────────────────────────────────────────────────
const handle = async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const method = req.method || "GET";

  if (
    url.pathname.startsWith("/materials/") &&
    req.headers.origin &&
    req.headers.origin !== "null"
  ) {
    let local = false;
    try {
      const origin = new URL(req.headers.origin);
      local =
        ["http:", "https:"].includes(origin.protocol) &&
        ["127.0.0.1", "localhost"].includes(origin.hostname);
    } catch {
      /* Reject malformed origins. */
    }
    if (!local) {
      send(res, 403, { error: "设计资料仅供本机评审页面读取" });
      return;
    }
  }

  if (method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, {
      ok: true,
      version: 1,
      pid: process.pid,
      port: PORT,
      capabilities: [
        "multi-selection",
        "design-materials",
        "region-text",
        "delete-entry",
      ],
    });
    return;
  }

  if (url.pathname.startsWith("/materials/")) {
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const slug = parts[1];
    if (!isValidSlug(slug)) {
      send(res, 400, { error: "非法资料 slug" });
      return;
    }
    try {
      if (method === "GET" && parts.length === 2) {
        send(res, 200, materials.read(slug));
        return;
      }
      if (method === "GET" && parts.length === 4 && parts[3] === "content") {
        send(res, 200, materials.content(slug, parts[2]));
        return;
      }
      if (method === "POST" && parts.length === 3) {
        const input = await readBody(req, 12 * 1024 * 1024);
        if (parts[2] === "groups") {
          send(
            res,
            200,
            materials.addGroup(slug, input.group, input.expectedVersion),
          );
          return;
        }
        if (parts[2] === "items") {
          send(
            res,
            200,
            materials.add(slug, input.material, input.expectedVersion),
          );
          return;
        }
      }
      send(res, 404, { error: "未知设计资料操作" });
    } catch (error) {
      if (error.httpStatus === 409)
        send(res, 409, {
          error: error.message,
          currentVersion: materials.read(slug).version,
        });
      else throw error;
    }
    return;
  }

  if (url.pathname === "/index" && method === "GET") {
    const docs = [];
    const versions = {};
    for (const slug of listSlugs()) {
      try {
        const doc = readDoc(slug);
        if (doc) {
          docs.push(doc);
          versions[slug] = versionOf(slug);
        }
      } catch {
        // 单个损坏文档不应让整个索引不可用；跳过并保留原文件。
      }
    }
    const index = buildFeedbackIndex(docs);
    index.items = index.items.map((item) => ({
      ...item,
      version: versions[item.slug] ?? 0,
    }));
    send(res, 200, index);
    return;
  }

  // /feedback/:slug[/entries[/:id[/replies]]]
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "feedback") {
    send(res, 404, { error: `未知路径: ${url.pathname}` });
    return;
  }

  // slug 缺失：可能是裸 /feedback/，也可能是 %2E%2E 一类被 URL 规范化吃掉的
  // 穿越尝试（`..` 会被折叠成 `/`）。统一按非法 slug 处理，不落到 404 语义。
  if (!segments[1]) {
    send(res, 400, {
      error:
        "slug 非法（缺失或被路径规范化移除，只允许 [A-Za-z0-9._-]，长度 1..128）",
    });
    return;
  }

  const slug = decodeURIComponent(segments[1]);
  if (!isValidSlug(slug)) {
    send(res, 400, {
      error: `slug 非法（只允许 [A-Za-z0-9._-]，长度 1..128）: ${slug}`,
    });
    return;
  }

  const body = method === "GET" ? {} : await readBody(req);
  const expected = body.expectedVersion;
  const current = versionOf(slug);
  // A failed GET cannot provide a usable version for a corrupt document.
  // Only explicit whole-document import may recover it; a readable document
  // still uses the normal version guard and can never be overwritten here.
  let corruptImport = false;
  if (method === "PUT" && segments.length === 2) {
    try {
      readDoc(slug);
    } catch (error) {
      if (!(error instanceof SyntaxError) && error?.code) throw error;
      corruptImport = true;
    }
  }
  if (
    expected !== undefined &&
    Number(expected) !== current &&
    !corruptImport
  ) {
    conflict(res, slug, `版本不符：expected=${expected} current=${current}`);
    return;
  }

  // GET /feedback/:slug
  if (segments.length === 2 && method === "GET") {
    const doc = readDoc(slug);
    if (!doc) {
      send(res, 404, { error: `slug 无评论数据: ${slug}` });
      return;
    }
    send(res, 200, { doc, version: current }, { ETag: `"${current}"` });
    return;
  }

  // PUT /feedback/:slug —— 整稿合并导入
  if (segments.length === 2 && method === "PUT") {
    const incoming = body.doc;
    // 损坏文件只能由显式有效 JSON 导入恢复；此 PUT 是该恢复入口。
    let existing;
    try {
      existing = readDoc(slug);
    } catch {
      existing = null;
    }
    // merge 承担全部冲突语义：entry base 冲突抛错、replies 幂等 union。
    const merged = existing
      ? mergeFeedbackDocuments(existing, incoming)
      : parseFeedback(incoming);
    okDoc(res, slug, merged);
    return;
  }

  // POST /feedback/:slug/entries —— 新增条目
  if (segments.length === 3 && segments[2] === "entries" && method === "POST") {
    const entry = validateEntry(slug, body.entry);
    const existing = readDoc(slug) ?? createFeedbackDocument(slug);
    const incoming = createFeedbackDocument(slug, [entry], existing.mode);
    okDoc(res, slug, mergeFeedbackDocuments(existing, incoming));
    return;
  }

  const entryId = segments[3] ? decodeURIComponent(segments[3]) : "";

  // 删除必须针对刚读取的版本；保留其余评论、回复和人审状态。
  if (
    segments.length === 4 &&
    segments[2] === "entries" &&
    method === "DELETE"
  ) {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      send(res, 400, { error: "删除评论需要非负整数 expectedVersion" });
      return;
    }
    const existing = readDoc(slug);
    if (!existing || !existing.entries.some((entry) => entry.id === entryId)) {
      send(res, 404, { error: `评论不存在: ${entryId}` });
      return;
    }
    okDoc(res, slug, {
      ...existing,
      updatedAt: new Date().toISOString(),
      entries: existing.entries.filter((entry) => entry.id !== entryId),
    });
    return;
  }

  // PATCH /feedback/:slug/entries/:id/replies —— 追加回复
  if (
    segments.length === 5 &&
    segments[2] === "entries" &&
    segments[4] === "replies" &&
    method === "PATCH"
  ) {
    const existing = readDoc(slug);
    if (!existing) {
      send(res, 404, { error: `slug 无评论数据: ${slug}` });
      return;
    }
    const target = existing.entries.find((e) => e.id === entryId);
    if (!target) {
      send(res, 404, { error: `entry 不存在: ${entryId}` });
      return;
    }
    // 走 merge 而非 appendFeedbackReply：后者对重复 reply id 一律抛错，
    // 而 merge 才有「同 id 同内容幂等、异内容冲突」的语义。
    // base 字段必须与现有 entry 一致，否则会被误判成 base 冲突。
    // CLI 只发送确定性 id 与正文。首次接收记录真实时间，重放沿用已有时间。
    const reply =
      body.reply &&
      typeof body.reply === "object" &&
      !Array.isArray(body.reply) &&
      body.reply.createdAt === undefined
        ? {
            ...body.reply,
            createdAt:
              target.replies?.find((item) => item.id === body.reply.id)
                ?.createdAt ?? new Date().toISOString(),
          }
        : body.reply;
    const incoming = createFeedbackDocument(
      slug,
      [{ ...target, replies: [reply] }],
      existing.mode,
    );
    okDoc(res, slug, mergeFeedbackDocuments(existing, incoming));
    return;
  }

  // PATCH /feedback/:slug/entries/:id —— status / decision / suggestion
  if (
    segments.length === 4 &&
    segments[2] === "entries" &&
    method === "PATCH"
  ) {
    const existing = readDoc(slug);
    if (!existing) {
      send(res, 404, { error: `slug 无评论数据: ${slug}` });
      return;
    }
    let next = existing;
    if (body.replyOrder !== undefined) {
      if (!Number.isInteger(expected)) {
        send(res, 400, { error: "replyOrder 需要 expectedVersion" });
        return;
      }
      next = reorderFeedbackReplies(next, entryId, body.replyOrder);
    }
    if (body.addSelection !== undefined) {
      next = appendFeedbackSelection(next, entryId, body.addSelection);
    }
    if (body.suggestion !== undefined) {
      next = setFeedbackEntrySuggestion(next, entryId, body.suggestion);
    }
    if (body.status !== undefined) {
      next = setFeedbackEntryStatus(next, entryId, body.status);
    }
    if (body.decision !== undefined) {
      next = setFeedbackEntryDecision(next, entryId, body.decision);
    }
    if (
      next === existing &&
      body.addSelection === undefined &&
      body.replyOrder === undefined
    ) {
      send(res, 400, {
        error:
          "未提供 status / decision / suggestion / addSelection / replyOrder 任一字段",
      });
      return;
    }
    okDoc(res, slug, next);
    return;
  }

  send(res, 404, { error: `未知路径或方法: ${method} ${url.pathname}` });
};

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const status = error?.httpStatus ?? classifyError(error);
    // 409 必须回带当前状态，客户端才能重读、重放本次修改。
    // 从 URL 反解 slug：能进到这里说明它已通过 isValidSlug 校验。
    if (status === 409) {
      const slug = slugFromUrl(req.url);
      if (slug) {
        send(res, 409, {
          error: String(error?.message ?? error),
          currentDoc: safeReadDoc(slug),
          currentVersion: versionOf(slug),
        });
        return;
      }
    }
    send(res, status, { error: String(error?.message ?? error) });
  });
});

/** 从请求 URL 取出 /feedback/:slug 的 slug；非法或不匹配返回 undefined。 */
function slugFromUrl(rawUrl) {
  try {
    const segments = new URL(rawUrl, `http://${HOST}:${PORT}`).pathname
      .split("/")
      .filter(Boolean);
    if (segments[0] !== "feedback" || !segments[1]) return undefined;
    const slug = decodeURIComponent(segments[1]);
    return isValidSlug(slug) ? slug : undefined;
  } catch {
    return undefined;
  }
}

/** 读 doc 但不抛错——错误响应路径上不能因为二次失败而丢掉原始错误。 */
function safeReadDoc(slug) {
  try {
    return readDoc(slug) ?? null;
  } catch {
    return null;
  }
}

/**
 * 把纯函数抛出的错误映射成 HTTP 状态：
 * - 冲突类（merge 拒绝覆盖）→ 409，调用方应重读重放
 * - 不存在类 → 404
 * - 其余（schema 校验失败）→ 422
 */
function classifyError(error) {
  const msg = String(error?.message ?? error);
  if (/冲突|已存在回复 id|不一致，无法合并/.test(msg)) return 409;
  if (/不存在/.test(msg)) return 404;
  return 422;
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    // 幂等启动：已有实例在跑就不是错误，CLI 的 serve 依赖这个行为。
    console.log(
      JSON.stringify({ ok: true, alreadyRunning: true, port: PORT }, null, 2),
    );
    process.exit(0);
  }
  throw error;
});

// Watch 重载和手动停止都先停止接收新请求，等待在途请求完成。
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 5000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify(
      { ok: true, host: HOST, port: PORT, pid: process.pid, store: storeDir },
      null,
      2,
    ),
  );
});
