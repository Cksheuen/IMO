/**
 * feedback 文档合并（纯函数）：条目/回复按 id 并集，冲突拒绝覆盖。
 */

import {
  DAVID_FEEDBACK_SCHEMA,
  DAVID_MAX_REPLIES_PER_ENTRY,
} from "./constants.ts";

import { parseFeedback, parseFeedbackReply } from "./parseFeedback.ts";
import type {
  DavidFeedbackDocument,
  DavidFeedbackEntry,
  DavidFeedbackReply,
  DavidFeedbackScope,
} from "./types.ts";

import { isRecord } from "./guards.ts";

/** 归一化作者：只有显式 "agent" 才算 agent，缺省/其他一律视为 "user"。 */
export const replyAuthor = (r: DavidFeedbackReply): "user" | "agent" =>
  r.author === "agent" ? "agent" : "user";

/**
 * 统一解析 scope：外层 nodePath 与 selection.scene / selection.detail
 * 取同一套目标，合法数据可只带其中任一来源。
 * pageId = scope.pageId ?? selection.scene.pageId
 * componentId = nodePath[0] ?? selection.detail.componentId ?? selection.scene.componentId
 * nodeId = nodePath 末项(长度>1) ?? selection.detail.nodeId ?? selection.scene.nodeId
 */
export const resolveFeedbackTarget = (
  scope: DavidFeedbackScope | undefined,
): { pageId?: string; componentId?: string; nodeId?: string } | undefined => {
  if (!scope) return undefined;
  const selection = scope.selection ?? scope.selections?.[0];
  const nodePath = scope.nodePath ?? [];
  return {
    pageId: scope.pageId ?? selection?.scene?.pageId,
    componentId:
      nodePath[0] ??
      selection?.detail?.componentId ??
      selection?.scene?.componentId,
    nodeId:
      nodePath.length > 1
        ? nodePath[nodePath.length - 1]
        : (selection?.detail?.nodeId ?? selection?.scene?.nodeId),
  };
};

// author is a reply-level field only; entry-level compatibility intentionally ignores it. Do not add it here.
const assertFeedbackEntriesCompatible = (
  existing: DavidFeedbackEntry,
  incoming: DavidFeedbackEntry,
) => {
  if (existing.suggestion !== incoming.suggestion) {
    throw new Error(
      `feedback 条目 ${existing.id} 的 suggestion 冲突，拒绝合并（请手动取舍后再导入）`,
    );
  }
  if (existing.category !== incoming.category) {
    throw new Error(`feedback 条目 ${existing.id} 的 category 冲突，拒绝合并`);
  }
  if (existing.createdAt !== incoming.createdAt) {
    throw new Error(`feedback 条目 ${existing.id} 的 createdAt 冲突，拒绝合并`);
  }
  if (existing.status !== incoming.status) {
    throw new Error(`feedback 条目 ${existing.id} 的 status 冲突，拒绝合并`);
  }
  if (!jsonEqual(existing.scope, incoming.scope)) {
    throw new Error(`feedback 条目 ${existing.id} 的 scope 冲突，拒绝合并`);
  }
  if (!jsonEqual(existing.pluginDraft, incoming.pluginDraft)) {
    throw new Error(
      `feedback 条目 ${existing.id} 的 pluginDraft 冲突，拒绝合并`,
    );
  }
};

const mergeFeedbackReplies = (
  entryId: string,
  currentReplies: DavidFeedbackReply[] | undefined,
  incomingReplies: DavidFeedbackReply[] | undefined,
): DavidFeedbackReply[] => {
  const merged = new Map<string, DavidFeedbackReply>();
  for (const reply of currentReplies ?? []) {
    merged.set(reply.id, reply);
  }
  for (const reply of incomingReplies ?? []) {
    const existing = merged.get(reply.id);
    if (!existing) {
      merged.set(reply.id, reply);
      continue;
    }
    if (
      existing.body !== reply.body ||
      existing.createdAt !== reply.createdAt ||
      replyAuthor(existing) !== replyAuthor(reply)
    ) {
      throw new Error(
        `feedback 条目 ${entryId} 的回复 ${reply.id} 内容冲突，拒绝合并`,
      );
    }
  }
  // 当前文档顺序即接收顺序；新 id 追加在尾部，客户端时钟不参与重排。
  return [...merged.values()];
};

const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => jsonEqual(left[key], right[key]))
    );
  }
  return false;
};

/**
 * 按 id 安全合并两份 feedback 文档（纯函数）。
 * - 两份入参都会先经 parseFeedback 严格校验，slug 必须一致
 * - 条目按 id 取并集；同 id 条目的 suggestion/category/scope/createdAt/
 *   pluginDraft/status 任一不一致即抛冲突错误，绝不静默覆盖
 * - 回复按 id 取并集：同 id 同内容重放幂等，同 id 不同内容抛冲突错误
 * - 合并结果再次通过 parseFeedback 校验，回复保持接收顺序；不修改任何输入
 */
export function mergeFeedbackDocuments(
  current: unknown,
  incoming: unknown,
): DavidFeedbackDocument {
  const currentDoc = parseFeedback(current);
  const incomingDoc = parseFeedback(incoming);
  if (currentDoc.slug !== incomingDoc.slug) {
    throw new Error(
      `feedback slug 不一致，无法合并: current=${currentDoc.slug}, incoming=${incomingDoc.slug}`,
    );
  }
  const mergedEntries = new Map<string, DavidFeedbackEntry>();
  for (const entry of currentDoc.entries) {
    mergedEntries.set(entry.id, entry);
  }
  for (const incomingEntry of incomingDoc.entries) {
    const existing = mergedEntries.get(incomingEntry.id);
    if (!existing) {
      mergedEntries.set(incomingEntry.id, incomingEntry);
      continue;
    }
    assertFeedbackEntriesCompatible(existing, incomingEntry);
    const mergedReplies = mergeFeedbackReplies(
      existing.id,
      existing.replies,
      incomingEntry.replies,
    );
    mergedEntries.set(existing.id, {
      ...existing,
      ...(mergedReplies.length > 0 ? { replies: mergedReplies } : {}),
    });
  }
  return parseFeedback({
    schema: DAVID_FEEDBACK_SCHEMA,
    schemaVersion: 1,
    slug: currentDoc.slug,
    updatedAt: new Date().toISOString(),
    mode: currentDoc.mode,
    entries: [...mergedEntries.values()],
  });
}

/**
 * 向指定条目追加回复（纯函数）。
 * - 严格校验 reply（未知字段/空 body/超长/重复 id 一律拒绝）
 * - 条目不存在时抛错；不修改输入文档，返回带新 updatedAt 的新文档
 */
export function appendFeedbackReply(
  doc: DavidFeedbackDocument,
  entryId: string,
  reply: DavidFeedbackReply,
): DavidFeedbackDocument {
  const validated = parseFeedbackReply(
    reply,
    `feedback.entries[${entryId}].replies[]`,
  );
  let found = false;
  const entries = doc.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    found = true;
    const replies = entry.replies ?? [];
    if (replies.some((item) => item.id === validated.id)) {
      throw new Error(
        `feedback 条目 ${entryId} 已存在回复 id: ${validated.id}`,
      );
    }
    if (replies.length >= DAVID_MAX_REPLIES_PER_ENTRY) {
      throw new Error(
        `feedback 条目 ${entryId} 回复数量不能超过 ${DAVID_MAX_REPLIES_PER_ENTRY}`,
      );
    }
    return { ...entry, replies: [...replies, validated] };
  });
  if (!found) {
    throw new Error(`feedback 条目不存在: ${entryId}`);
  }
  return { ...doc, updatedAt: new Date().toISOString(), entries };
}

/** 显式修复历史顺序；必须包含全部现有 reply id，绝不修改回复内容。 */
export function reorderFeedbackReplies(
  doc: DavidFeedbackDocument,
  entryId: string,
  replyOrder: unknown,
): DavidFeedbackDocument {
  const entry = doc.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error(`feedback 条目不存在: ${entryId}`);
  const replies = entry.replies ?? [];
  if (
    !Array.isArray(replyOrder) ||
    replyOrder.length !== replies.length ||
    replyOrder.some((id) => typeof id !== "string") ||
    new Set(replyOrder).size !== replies.length
  ) {
    throw new Error("replyOrder 必须完整列出已有回复 id，且不能重复");
  }
  const byId = new Map(replies.map((reply) => [reply.id, reply]));
  if (replyOrder.some((id) => !byId.has(id))) {
    throw new Error("replyOrder 含未知回复 id");
  }
  if (replies.every((reply, index) => reply.id === replyOrder[index]))
    return doc;
  return {
    ...doc,
    updatedAt: new Date().toISOString(),
    entries: doc.entries.map((item) =>
      item.id === entryId
        ? { ...item, replies: replyOrder.map((id) => byId.get(id)!) }
        : item,
    ),
  };
}
