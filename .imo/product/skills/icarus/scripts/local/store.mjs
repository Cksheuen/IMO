import { enqueueBatchInputs } from "./feedback-queue.mjs";
import fs from "node:fs";
import {
  MAX_SELECTIONS,
  selectionRecords,
} from "../../assets/runtime/comment-model.mjs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
export const runtimeRoot = () =>
  path.resolve(
    process.env.ICARUS_RUNTIME_DIR ||
      path.join(os.homedir(), ".imo/runtime/icarus"),
  );
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const documentId = (sourcePath) =>
  hash(fs.realpathSync(sourcePath)).slice(0, 32);
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
export function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export const sourceInfo = (file) => ({
  path: fs.realpathSync(file),
  sha256: hash(fs.readFileSync(file)),
});
export function registerDocument(sourcePath, outputPath, root = runtimeRoot()) {
  const source = sourceInfo(sourcePath),
    id = documentId(source.path),
    file = path.join(root, "documents", `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        id,
        token: randomUUID(),
        source,
        output: path.resolve(outputPath),
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const previous = readJSON(file);
  const config = {
    id,
    token: previous?.token ?? randomUUID(),
    source,
    output: path.resolve(outputPath),
  };
  atomicJSON(file, config);
  return config;
}
export function configuration(id, root = runtimeRoot()) {
  if (!/^[a-f0-9]{32}$/.test(id))
    throw Object.assign(new Error("Invalid document id"), { status: 400 });
  const config = readJSON(path.join(root, "documents", `${id}.json`));
  if (!config)
    throw Object.assign(new Error("Document not registered"), { status: 404 });
  return config;
}
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 422 });
};
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail("Invalid or unknown fields");
}
const string = (value, max) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail("Invalid string");
};
export function validateSource(source) {
  keys(source, ["path", "sha256"]);
  string(source.path, 4096);
  if (!/^[a-f0-9]{64}$/.test(source.sha256)) fail("Invalid source hash");
}
export function validateSelection(selection) {
  keys(selection, [
    "kind",
    "rect",
    "viewport",
    "scroll",
    "text",
    "truncated",
    "anchors",
    "capturedAt",
    "context",
  ]);
  if (
    selection.kind !== "region" ||
    typeof selection.text !== "string" ||
    selection.text.length > 20000 ||
    typeof selection.truncated !== "boolean"
  )
    fail("Invalid selection");
  for (const [name, fields] of [
    ["rect", ["x", "y", "width", "height"]],
    ["viewport", ["width", "height"]],
    ["scroll", ["x", "y"]],
  ]) {
    keys(selection[name], fields);
    for (const k of fields)
      if (
        !Number.isFinite(selection[name][k]) ||
        Math.abs(selection[name][k]) > 1e9
      )
        fail("Invalid geometry");
  }
  if (
    selection.rect.width < 0 ||
    selection.rect.height < 0 ||
    selection.viewport.width <= 0 ||
    selection.viewport.height <= 0
  )
    fail("Invalid dimensions");
  if (!Array.isArray(selection.anchors) || selection.anchors.length > 32)
    fail("Invalid anchors");
  for (const anchor of selection.anchors) string(anchor, 512);
  if (selection.context !== undefined) {
    keys(selection.context, ["adapter", "state"]);
    string(selection.context.adapter, 256);
    const state = selection.context.state;
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      Object.keys(state).length > 16
    )
      fail("Invalid selection context");
    for (const [key, value] of Object.entries(state)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        fail("Invalid selection context field");
      if (typeof value !== "string" || value.length > 512)
        fail("Invalid selection context value");
    }
  }
  string(selection.capturedAt, 64);
  if (!Number.isFinite(Date.parse(selection.capturedAt)))
    fail("Invalid timestamp");
}
export function validateEntry(entry) {
  keys(entry, [
    "id",
    "comment",
    "selection",
    "status",
    "createdAt",
    "source",
    "replies",
  ]);
  string(entry.id, 128);
  string(entry.comment, 4000);
  validateSelection(entry.selection);
  validateSource(entry.source);
  if (entry.status !== "open") fail("New comments must remain open");
  string(entry.createdAt, 64);
  if (!Number.isFinite(Date.parse(entry.createdAt))) fail("Invalid timestamp");
  if (entry.replies !== undefined) fail("Replies require the reply operation");
  return entry;
}
export function snapshot(config, root = runtimeRoot()) {
  const stored = readJSON(path.join(root, "feedback", `${config.id}.json`));
  if (stored) {
    if (
      !Number.isSafeInteger(stored.version) ||
      stored.version < 0 ||
      stored.doc?.schema !== "icarus-feedback/v1" ||
      !Array.isArray(stored.doc.entries)
    )
      throw new Error("Corrupt feedback storage");
    return { ...stored, doc: { ...stored.doc, source: config.source } };
  }
  return {
    version: 0,
    doc: { schema: "icarus-feedback/v1", source: config.source, entries: [] },
  };
}
const fingerprintOf = (value) => {
  const canonical = (item) =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, canonical(item[key])]),
          )
        : item;
  return hash(JSON.stringify(canonical(value)));
};
export function mutate(config, operation, body, root = runtimeRoot()) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("Invalid body");
  const state = snapshot(config, root);
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0)
    fail("expectedVersion is required");
  const conflict = (message, code = "version-conflict") => {
    throw Object.assign(new Error(message), {
      status: 409,
      conflict: code,
      currentVersion: state.version,
    });
  };
  const original = (entry) => ({
    id: entry.id,
    comment: entry.comment,
    selection: entry.selection,
    source: entry.source,
    status: entry.status,
    createdAt: entry.createdAt,
  });
  let entry, fingerprint;
  if (operation === "entries") {
    keys(body, ["expectedVersion", "entry"]);
    validateEntry(body.entry);
    if (body.entry.source.path !== config.source.path)
      fail("Source belongs to another document");
    fingerprint = fingerprintOf(body.entry);
    if (state.deletedEntries?.some((e) => e.id === body.entry.id))
      conflict("Entry was deleted", "entry-deleted");
    const found = state.doc.entries.find((e) => e.id === body.entry.id);
    if (found) {
      const receipt = state.creations?.find((r) => r.entryId === found.id);
      if (
        receipt
          ? receipt.fingerprint !== fingerprint
          : !isDeepStrictEqual(original(found), body.entry)
      )
        conflict("Entry id conflict", "entry-conflict");
      return state;
    }
  } else if (operation === "replies") {
    keys(body, ["expectedVersion", "entryId", "reply"]);
    string(body.entryId, 128);
    keys(body.reply, ["id", "body", "author"]);
    string(body.reply.id, 128);
    string(body.reply.body, 4000);
    if (!["agent", "user"].includes(body.reply.author)) fail("Invalid author");
    entry = state.doc.entries.find((e) => e.id === body.entryId);
    if (!entry)
      throw Object.assign(new Error("Entry missing"), { status: 404 });
    const found = entry.replies?.find((r) => r.id === body.reply.id);
    if (found) {
      if (found.body !== body.reply.body || found.author !== body.reply.author)
        conflict("Reply id conflict", "reply-conflict");
      return state;
    }
  } else if (operation === "updates") {
    keys(body, ["expectedVersion", "entryId", "update"]);
    string(body.entryId, 128);
    const u = body.update;
    const fields = {
      status: ["status", "previousStatus"],
      edit: ["comment", "previousComment"],
      selection: ["selection", "source"],
    };
    if (!u || !Object.hasOwn(fields, u.kind)) fail("Invalid update kind");
    keys(u, ["id", "kind", ...fields[u.kind]]);
    string(u.id, 128);
    if (
      u.kind === "status" &&
      (!["open", "resolved"].includes(u.status) ||
        !["open", "resolved"].includes(u.previousStatus))
    )
      fail("Invalid status");
    if (u.kind === "edit") {
      string(u.comment, 4000);
      string(u.previousComment, 4000);
    }
    if (u.kind === "selection") {
      validateSelection(u.selection);
      validateSource(u.source);
      if (u.source.path !== config.source.path)
        fail("Source belongs to another document");
    }
    fingerprint = fingerprintOf({ entryId: body.entryId, update: u });
    const receipt = state.operations?.find((r) => r.id === u.id);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        conflict("Update id conflict", "update-conflict");
      return state;
    }
    entry = state.doc.entries.find((e) => e.id === body.entryId);
    if (!entry)
      throw Object.assign(new Error("Entry missing"), { status: 404 });
    if (u.kind === "edit" && entry.comment !== u.previousComment)
      conflict("评论已被其他窗口修改，请核对最新内容后重试", "entry-changed");
    if (u.kind === "status" && entry.status !== u.previousStatus)
      conflict("评论状态已改变，请核对最新状态后重试", "entry-changed");
    if (
      u.kind === "selection" &&
      selectionRecords(entry).length >= MAX_SELECTIONS
    )
      fail("最多保存 8 个选区");
    if ((state.operations?.length ?? 0) >= 50000)
      fail("Operation limit reached");
  } else fail("Unknown operation");
  if (body.expectedVersion !== state.version) conflict("Version conflict");
  if (operation === "entries") {
    if (state.doc.entries.length >= 1000) fail("Comment limit reached");
    state.doc.entries.push(body.entry);
    (state.creations ??= []).push({ entryId: body.entry.id, fingerprint });
  } else if (operation === "replies") {
    if ((entry.replies?.length ?? 0) >= 200) fail("Reply limit reached");
    (entry.replies ??= []).push({
      ...body.reply,
      createdAt: new Date().toISOString(),
    });
  } else {
    if (!state.creations?.some((r) => r.entryId === entry.id))
      (state.creations ??= []).push({
        entryId: entry.id,
        fingerprint: fingerprintOf(original(entry)),
      });
    const u = body.update;
    if (u.kind === "status") entry.status = u.status;
    if (u.kind === "edit") entry.comment = u.comment;
    if (u.kind === "selection")
      entry.selections = [
        ...selectionRecords(entry),
        { id: u.id, selection: u.selection, source: u.source },
      ];
    entry.updatedAt = new Date().toISOString();
    (state.operations ??= []).push({
      id: u.id,
      entryId: entry.id,
      fingerprint,
    });
  }
  enqueueBatchInputs(state);
  state.version++;
  if (Buffer.byteLength(JSON.stringify(state)) > 32 * 1024 * 1024)
    fail("Storage size limit reached");
  atomicJSON(path.join(root, "feedback", `${config.id}.json`), state);
  return state;
}
