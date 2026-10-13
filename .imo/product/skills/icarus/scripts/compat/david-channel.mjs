import { enqueueBatchInputs } from "../local/feedback-queue.mjs";
import { taskView, changeTask } from "../local/feedback-tasks.mjs";
/** Wire adapter only: original David parsers/mutators, one Icarus feedback store. */
import path from "node:path";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import * as david from "./david-model.mjs";
import {
  snapshot,
  atomicJSON,
  hash,
  readJSON,
  configuration,
} from "../local/store.mjs";
import { readModState, writeModState } from "../local/mod-state.mjs";
import { selectionRecords } from "../../assets/runtime/comment-model.mjs";
const fail = (message, status = 422) => {
  throw Object.assign(Error(message), { status });
};
const keys = (value, allowed) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail("Unknown David operation fields");
};
// A protocol target identifies this retained region; it is deliberately not a React DOM anchor.
const legacyTarget = (entry, record) => ({
  targetId:
    "icarus:legacy-region:" +
    hash(JSON.stringify([entry.id, record.id])).slice(0, 24),
  label: "原 HTML 区域（无 React 定位锚点）",
  kind: "shell",
});
// Upgrade the wire projection once at service startup. Original React clients
// ignore changed response bodies at the same version, so a revision is required
// to recover already-open drafts. No entry or region data is rewritten here.
export function upgradeLegacyProjections(root) {
  const dir = path.join(root, "feedback");
  if (!fs.existsSync(dir)) return [];
  const upgraded = [];
  for (const file of fs
    .readdirSync(dir)
    .filter((name) => /^[a-f0-9]{32}\.json$/.test(name))) {
    const id = file.slice(0, -5);
    const plan = readJSON(path.join(root, "mod-plans", file));
    if (
      !plan?.specs?.some((mod) =>
        ["review-workbench", "research-workbench"].includes(mod.id),
      )
    )
      continue;
    const state = readJSON(path.join(dir, file));
    if (state.nativeProjectionVersion === 1) continue;
    const legacy = state.doc.entries.some((entry) =>
      selectionRecords(entry).some(
        (record) =>
          !record.david ||
          (record.david.surface === "shell" &&
            record.david.context?.heading === "原 HTML 选区"),
      ),
    );
    if (!legacy) continue;
    nativeSnapshot(configuration(id, root), "icarus-upgrade-validation", root);
    atomicJSON(path.join(dir, file), {
      ...state,
      version: state.version + 1,
      nativeProjectionVersion: 1,
    });
    upgraded.push(id);
  }
  return upgraded;
}
const fallbackSelection = (entry, record) => {
  const s = record.selection,
    state = s.context?.state ?? {},
    v = s.viewport;
  return {
    version: 1,
    kind: "appearance-selection",
    capturedAt: s.capturedAt,
    surface: "shell",
    scene: {
      pageId: state.pageId || "default",
      ...(state.componentId ? { componentId: state.componentId } : {}),
      ...(state.nodeId ? { nodeId: state.nodeId } : {}),
    },
    viewport: v,
    windowScroll: s.scroll,
    rect: {
      nx: s.rect.x / v.width,
      ny: s.rect.y / v.height,
      nw: s.rect.width / v.width,
      nh: s.rect.height / v.height,
    },
    targets: [legacyTarget(entry, record)],
    context: {
      regionText: { text: s.text, truncated: s.truncated },
      heading: "原 HTML 选区",
    },
  };
};
function projectSelection(entry, record) {
  const selection = record.david;
  if (!selection) return fallbackSelection(entry, record);
  // Compatibility with the invalid projection persisted by Icarus 0.2.0.
  // Incoming native selections still go through the unmodified strict David validator.
  if (
    selection.surface === "shell" &&
    selection.context?.heading === "原 HTML 选区" &&
    Array.isArray(selection.targets) &&
    selection.targets.length === 0
  )
    return { ...selection, targets: [legacyTarget(entry, record)] };
  return selection;
}
function projectEntry(entry) {
  const selections = selectionRecords(entry)
    .filter(
      (r) =>
        !entry.david ||
        r.david ||
        r.selection.text ||
        r.selection.rect.width ||
        r.selection.rect.height,
    )
    .map((record) => projectSelection(entry, record));
  const native = entry.david ?? {
    id: entry.id,
    category: "content",
    createdAt: entry.createdAt,
  };
  return {
    ...native,
    suggestion: entry.comment,
    status: entry.status,
    ...(selections.length
      ? {
          scope: {
            ...(native.scope ?? {}),
            selection: selections[0],
            ...(selections.length > 1 ? { selections } : {}),
          },
        }
      : {}),
    replies: (entry.replies ?? []).map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      ...(r.author === "agent" ? { author: "agent" } : {}),
    })),
  };
}
export function nativeSnapshot(config, slug, root) {
  const state = snapshot(config, root);
  return {
    version: state.version,
    doc: david.parseFeedback(
      david.createFeedbackDocument(slug, state.doc.entries.map(projectEntry)),
    ),
  };
}
function plainSelection(s, createdAt) {
  if (!s)
    return {
      kind: "region",
      text: "",
      truncated: false,
      anchors: [],
      capturedAt: createdAt,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      viewport: { width: 1, height: 1 },
      scroll: { x: 0, y: 0 },
    };
  const region = s.context?.regionText;
  return {
    kind: "region",
    text: region?.text ?? s.targets.map((t) => t.label).join("\n"),
    truncated: region?.truncated ?? true,
    anchors: s.targets
      .map((t) => "[data-review-target=" + JSON.stringify(t.targetId) + "]")
      .slice(0, 32),
    capturedAt: s.capturedAt,
    rect: {
      x: s.rect.nx * s.viewport.width,
      y: s.rect.ny * s.viewport.height,
      width: s.rect.nw * s.viewport.width,
      height: s.rect.nh * s.viewport.height,
    },
    viewport: s.viewport,
    scroll: s.windowScroll,
    context: {
      adapter: "david-native",
      state: { pageId: s.scene.pageId, surface: s.surface },
    },
  };
}
function storeEntry(native, previous, source) {
  const selections = david.feedbackSelections(native.scope);
  const prior = previous ? selectionRecords(previous) : [];
  const records = selections.map((s) => {
    const matched = prior.find((r) =>
      isDeepStrictEqual(projectSelection(previous, r), s),
    );
    return matched
      ? matched.david
        ? { ...matched, david: s }
        : matched
      : {
          id: hash(JSON.stringify(s)).slice(0, 32),
          selection: plainSelection(s, native.createdAt),
          source,
          david: s,
        };
  });
  const keptPrimary =
    prior[0] && records.some((record) => record.id === prior[0].id);
  const first = records[0] ?? {
    id: "primary",
    selection: plainSelection(null, native.createdAt),
    source,
  };
  return {
    ...previous,
    davidCreationHash:
      previous?.davidCreationHash ?? hash(JSON.stringify(native)),
    id: native.id,
    comment: native.suggestion,
    status: native.status ?? "open",
    createdAt: native.createdAt,
    source: keptPrimary ? previous.source : first.source,
    selection: keptPrimary ? previous.selection : first.selection,
    selections: records,
    replies: (native.replies ?? []).map((r) => ({
      ...r,
      author: r.author ?? "user",
    })),
    david: native,
  };
}
function changeFeedback(config, slug, kind, entryId, body, root) {
  const state = snapshot(config, root),
    before = nativeSnapshot(config, slug, root),
    current = before.doc;
  const conflict = (message) => {
    throw Object.assign(Error(message), {
      status: 409,
      currentVersion: state.version,
      currentDoc: current,
    });
  };
  let next = current;
  if (kind === "delete") {
    keys(body, ["expectedVersion"]);
    const found = state.doc.entries.find((entry) => entry.id === entryId);
    if (!found) {
      if (state.deletedEntries?.some((entry) => entry.id === entryId))
        return before;
      fail("Comment missing", 404);
    }
    if (body.expectedVersion !== state.version)
      conflict("评论已变化，请重读后重试");
    state.deletedEntries = [
      ...(state.deletedEntries ?? []),
      { ...found, deletedAt: new Date().toISOString() },
    ];
    next = {
      ...current,
      entries: current.entries.filter((entry) => entry.id !== entryId),
    };
  } else if (kind === "add") {
    keys(body, ["entry", "expectedVersion"]);
    const parsed = david.parseFeedback(
      david.createFeedbackDocument(slug, [body.entry]),
    ).entries[0];
    if (state.deletedEntries?.some((entry) => entry.id === parsed.id))
      conflict("已删除的评论不能由旧请求恢复");
    const found = current.entries.find((e) => e.id === parsed.id);
    if (found) {
      const persisted = state.doc.entries.find((e) => e.id === parsed.id);
      if (
        persisted?.davidCreationHash === hash(JSON.stringify(parsed)) ||
        isDeepStrictEqual(persisted?.david, parsed) ||
        isDeepStrictEqual(found, parsed)
      )
        return before;
      conflict("Entry id conflict");
    }
    next = { ...current, entries: [...current.entries, parsed] };
  } else if (kind === "reply") {
    keys(body, ["reply", "expectedVersion"]);
    next = david.appendFeedbackReply(current, entryId, body.reply);
  } else if (kind === "patch") {
    keys(body, [
      "status",
      "decision",
      "suggestion",
      "addSelection",
      "removeSelection",
      "expectedVersion",
    ]);
    if (Object.keys(body).filter((k) => k !== "expectedVersion").length !== 1)
      fail("One patch field is required");
    if (body.status !== undefined)
      next = david.setFeedbackEntryStatus(current, entryId, body.status);
    if (body.suggestion !== undefined)
      next = david.setFeedbackEntrySuggestion(
        current,
        entryId,
        body.suggestion,
      );
    if (body.addSelection !== undefined) {
      if (
        state.removedSelections?.some(
          (item) =>
            item.entryId === entryId &&
            isDeepStrictEqual(item.selection, body.addSelection),
        )
      )
        conflict("已删除的选区不能由旧请求恢复");
      next = david.appendFeedbackSelection(current, entryId, body.addSelection);
    }
    if (body.removeSelection !== undefined) {
      next = david.removeFeedbackSelection(
        current,
        entryId,
        body.removeSelection,
      );
      if (!isDeepStrictEqual(next.entries, current.entries)) {
        if (body.expectedVersion !== state.version)
          conflict("评论已变化，请重读后重试");
        const original = state.doc.entries.find(
          (entry) => entry.id === entryId,
        );
        state.removedSelections = [
          ...(state.removedSelections ?? []),
          {
            entryId,
            selection: body.removeSelection,
            record: original
              ? selectionRecords(original).find((record) =>
                  isDeepStrictEqual(
                    projectSelection(original, record),
                    body.removeSelection,
                  ),
                )
              : undefined,
            removedAt: new Date().toISOString(),
          },
        ];
      }
    }
    if (body.decision !== undefined) {
      if (body.expectedVersion !== state.version)
        conflict("评论已变化，请重读后重试");
      next = david.setFeedbackEntryDecision(current, entryId, body.decision);
    }
  } else if (kind === "put") {
    keys(body, ["doc", "expectedVersion"]);
    const incoming = david.parseFeedback(body.doc);
    if (incoming.slug !== slug) fail("Slug mismatch");
    if (
      incoming.entries.some((entry) =>
        state.deletedEntries?.some((removed) => removed.id === entry.id),
      )
    )
      conflict("导入包含已删除评论，请先移除旧条目");
    next = david.mergeFeedbackDocuments(current, incoming);
  }
  if (isDeepStrictEqual(next.entries, current.entries)) return before;
  if (
    body.expectedVersion !== undefined &&
    body.expectedVersion !== state.version
  )
    conflict("评论已变化，请重读后重试");
  if (next.entries.length > 1000) fail("Comment limit reached");
  // Validate the entire outgoing document before committing, not just the new entry.
  next = david.parseFeedback(next);
  state.doc.entries = next.entries.map((entry) =>
    storeEntry(
      entry,
      state.doc.entries.find((e) => e.id === entry.id),
      config.source,
    ),
  );
  enqueueBatchInputs(state);
  state.version++;
  if (Buffer.byteLength(JSON.stringify(state)) > 32 * 1024 * 1024)
    fail("Comment storage exceeds limit");
  atomicJSON(path.join(root, "feedback", config.id + ".json"), state);
  // The adapter confirms against the same default store before acknowledging.
  return nativeSnapshot(config, slug, root);
}
function materials(config, slug, kind, id, body, root) {
  const state = readModState(config.id, "design-materials", root),
    value = state.value ?? { groups: [], items: [], contents: {} };
  const doc = () =>
    david.parseMaterialDocument({
      schema: "david-materials/v1",
      slug,
      version: state.version,
      groups: value.groups,
      items: value.items,
    });
  if (kind === "read") return doc();
  if (kind === "content") {
    const item = value.items.find((x) => x.id === id);
    if (!item) fail("Material missing", 404);
    return { item, content: value.contents[id], localPath: "" };
  }
  const next = structuredClone(value);
  if (kind === "group") {
    keys(body, ["group", "expectedVersion"]);
    david.assertMaterialGroup(body.group);
    const found = next.groups.find((g) => g.id === body.group.id);
    if (found) {
      if (!isDeepStrictEqual(found, body.group))
        fail("Material group id conflict", 409);
      return doc();
    }
    next.groups.push(body.group);
  } else {
    keys(body, ["material", "expectedVersion"]);
    const input = body.material;
    david.assertMaterialInput(input);
    let bytes;
    if (input.kind === "png") {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.content))
        fail("Invalid PNG");
      bytes = Buffer.from(input.content.split(",")[1], "base64");
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
        fail("Invalid PNG header");
    } else bytes = Buffer.from(input.content);
    if (
      !bytes.length ||
      bytes.length >
        (input.kind === "png"
          ? david.MATERIAL_IMAGE_LIMIT
          : david.MATERIAL_CSS_LIMIT)
    )
      fail("Material size limit exceeded");
    const sha256 = hash(bytes),
      found = next.items.find((i) => i.id === input.id);
    if (found) {
      if (
        found.sha256 !== sha256 ||
        found.title !== input.title ||
        found.groupId !== input.group.id ||
        found.kind !== input.kind ||
        found.sourceRef !== input.sourceRef
      )
        fail("Material id conflict", 409);
      return doc();
    }
    if (!next.groups.some((g) => g.id === input.group.id))
      next.groups.push(input.group);
    next.items.push({
      id: input.id,
      groupId: input.group.id,
      title: input.title,
      kind: input.kind,
      fileName: input.id + "." + input.kind,
      bytes: bytes.length,
      sha256,
      createdAt: new Date().toISOString(),
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    });
    next.contents[input.id] = input.content;
  }
  david.parseMaterialDocument({
    schema: "david-materials/v1",
    slug,
    version: state.version + 1,
    groups: next.groups,
    items: next.items,
  });
  writeModState(
    config.id,
    "design-materials",
    { expectedVersion: body.expectedVersion, value: next },
    root,
  );
  return materials(config, slug, "read", null, null, root);
}
export function handleDavid(config, route, method, body, root) {
  if (/^\/feedback\/[^/]+\/tasks$/.test(route)) {
    if (method === "GET") return taskView(config, root);
    if (
      method === "POST" &&
      ["queue", "cancel", "queue-all"].includes(body?.action)
    )
      return changeTask(config, body, root);
    fail("Use the Agent channel to claim or complete a task", 405);
  }
  if (route === "/health" && method === "GET")
    return {
      capabilities: [
        "multi-selection",
        "region-text",
        "design-materials",
        "feedback-delete",
        "feedback-tasks-v1",
        "feedback-batch-v1",
      ],
    };
  const parts = route.split("/").slice(1).map(decodeURIComponent),
    [category, slug, third, id, fifth] = parts;
  if (!slug || slug.length > 160 || parts.some((p) => !p))
    fail("Invalid David route", 404);
  if (category === "feedback") {
    if (parts.length === 2 && method === "GET")
      return nativeSnapshot(config, slug, root);
    if (parts.length === 2 && method === "PUT")
      return changeFeedback(config, slug, "put", null, body, root);
    if (third === "entries" && parts.length === 3 && method === "POST")
      return changeFeedback(config, slug, "add", null, body, root);
    if (third === "entries" && parts.length === 4 && method === "DELETE")
      return changeFeedback(config, slug, "delete", id, body, root);
    if (third === "entries" && parts.length === 4 && method === "PATCH")
      return changeFeedback(config, slug, "patch", id, body, root);
    if (
      third === "entries" &&
      fifth === "replies" &&
      parts.length === 5 &&
      method === "PATCH"
    )
      return changeFeedback(config, slug, "reply", id, body, root);
  }
  if (category === "materials") {
    if (parts.length === 2 && method === "GET")
      return materials(config, slug, "read", null, null, root);
    if (parts.length === 4 && id === "content" && method === "GET")
      return materials(config, slug, "content", third, null, root);
    if (parts.length === 3 && third === "groups" && method === "POST")
      return materials(config, slug, "group", null, body, root);
    if (parts.length === 3 && third === "items" && method === "POST")
      return materials(config, slug, "item", null, body, root);
  }
  fail("Unknown David operation", 404);
}
