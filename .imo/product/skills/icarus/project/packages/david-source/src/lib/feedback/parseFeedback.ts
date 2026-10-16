/**
 * david-feedback/v1 文档 / 条目 / scope / 回复严格解析。
 */

import {
  DAVID_FEEDBACK_SCHEMA,
  DAVID_REPLY_MAX_LENGTH,
  DAVID_MAX_REPLIES_PER_ENTRY,
  DAVID_MAX_SELECTIONS_PER_ENTRY,
  DAVID_SUGGESTION_MAX_LENGTH,
  FEEDBACK_CATEGORIES,
  PLUGIN_ID_MAX_LENGTH,
  PLUGIN_SLUG_MAX_LENGTH,
} from "./constants.ts";

import { isNonEmptyString, isRecord, rejectUnknownKeys } from "./guards.ts";

import { parsePluginDraft } from "./pluginDraft.ts";

import { validateAppearanceSelection } from "./selectionSchema.ts";
import type {
  DavidFeedbackDecision,
  DavidFeedbackDocument,
  DavidFeedbackEntry,
  DavidFeedbackEntryStatus,
  DavidFeedbackMode,
  DavidFeedbackOrigin,
  DavidFeedbackReply,
  DavidFeedbackReplyAuthor,
  DavidFeedbackScope,
} from "./types.ts";

const parseFeedbackScope = (
  value: unknown,
  path: string,
): DavidFeedbackScope | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  rejectUnknownKeys(
    value,
    ["pageId", "nodePath", "targetId", "selection", "selections"],
    path,
  );
  if (value.pageId !== undefined && !isNonEmptyString(value.pageId)) {
    throw new Error(`${path}.pageId 必须为非空字符串`);
  }
  if (
    value.nodePath !== undefined &&
    (!Array.isArray(value.nodePath) ||
      value.nodePath.some((item) => !isNonEmptyString(item)))
  ) {
    throw new Error(`${path}.nodePath 必须为非空字符串数组`);
  }
  if (value.targetId !== undefined && !isNonEmptyString(value.targetId)) {
    throw new Error(`${path}.targetId 必须为非空字符串`);
  }
  if (value.selection !== undefined) {
    validateAppearanceSelection(value.selection, `${path}.selection`);
  }
  if (value.selections !== undefined) {
    if (
      !Array.isArray(value.selections) ||
      value.selections.length < 1 ||
      value.selections.length > DAVID_MAX_SELECTIONS_PER_ENTRY
    )
      throw new Error(
        `${path}.selections 必须含 1 至 ${DAVID_MAX_SELECTIONS_PER_ENTRY} 个选区`,
      );
    value.selections.forEach((selection, index) =>
      validateAppearanceSelection(selection, `${path}.selections[${index}]`),
    );
    if (
      value.selection !== undefined &&
      JSON.stringify(value.selection) !== JSON.stringify(value.selections[0])
    )
      throw new Error(`${path}.selection 必须与 selections[0] 一致`);
  }
  return value as unknown as DavidFeedbackScope;
};

export const parseFeedbackReply = (
  value: unknown,
  path: string,
): DavidFeedbackReply => {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  rejectUnknownKeys(value, ["id", "body", "createdAt", "author"], path);
  if (!isNonEmptyString(value.id))
    throw new Error(`${path}.id 必须为非空字符串`);
  if (value.id.length > PLUGIN_ID_MAX_LENGTH) {
    throw new Error(`${path}.id 长度不能超过 ${PLUGIN_ID_MAX_LENGTH}`);
  }
  if (typeof value.body !== "string" || !value.body.trim()) {
    throw new Error(`${path}.body 不能为空`);
  }
  if (value.body.length > DAVID_REPLY_MAX_LENGTH) {
    throw new Error(`${path}.body 长度不能超过 ${DAVID_REPLY_MAX_LENGTH}`);
  }
  if (!isNonEmptyString(value.createdAt))
    throw new Error(`${path}.createdAt 必须为非空字符串`);
  const author: DavidFeedbackReplyAuthor =
    value.author === undefined
      ? "user"
      : (value.author as DavidFeedbackReplyAuthor);
  if (author !== "user" && author !== "agent") {
    throw new Error(`${path}.author 非法: ${String(value.author)}`);
  }
  return {
    id: value.id,
    body: value.body,
    createdAt: value.createdAt,
    // 规范化：user 不落盘，保持与旧版逐字节兼容
    ...(author === "agent" ? { author: "agent" } : {}),
  };
};

const parseFeedbackReplies = (
  value: unknown,
  path: string,
): DavidFeedbackReply[] => {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
  if (value.length > DAVID_MAX_REPLIES_PER_ENTRY) {
    throw new Error(`${path} 数量不能超过 ${DAVID_MAX_REPLIES_PER_ENTRY}`);
  }
  const replies = value.map((item, index) =>
    parseFeedbackReply(item, `${path}[${index}]`),
  );
  const seen = new Set<string>();
  for (const reply of replies) {
    if (seen.has(reply.id)) {
      throw new Error(`${path} 存在重复回复 id: ${reply.id}`);
    }
    seen.add(reply.id);
  }
  return replies;
};

const parseFeedbackEntry = (
  value: unknown,
  path: string,
): DavidFeedbackEntry => {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  rejectUnknownKeys(
    value,
    [
      "id",
      "category",
      "suggestion",
      "createdAt",
      "status",
      "origin",
      "decision",
      "scope",
      "replies",
      "pluginDraft",
    ],
    path,
  );
  if (!isNonEmptyString(value.id))
    throw new Error(`${path}.id 必须为非空字符串`);
  if (
    !FEEDBACK_CATEGORIES.includes(
      value.category as DavidFeedbackEntry["category"],
    )
  ) {
    throw new Error(`${path}.category 非法: ${String(value.category)}`);
  }
  if (typeof value.suggestion !== "string" || !value.suggestion.trim()) {
    throw new Error(`${path}.suggestion 不能为空`);
  }
  if (value.suggestion.length > DAVID_SUGGESTION_MAX_LENGTH) {
    throw new Error(
      `${path}.suggestion 长度不能超过 ${DAVID_SUGGESTION_MAX_LENGTH}`,
    );
  }
  if (!isNonEmptyString(value.createdAt))
    throw new Error(`${path}.createdAt 必须为非空字符串`);
  const status: DavidFeedbackEntryStatus =
    value.status === undefined
      ? "open"
      : (value.status as DavidFeedbackEntryStatus);
  if (status !== "open" && status !== "resolved") {
    throw new Error(`${path}.status 非法: ${String(value.status)}`);
  }
  // origin 缺省归一化为 "user"，保证旧条目行为不变。
  const origin: DavidFeedbackOrigin =
    value.origin === undefined ? "user" : (value.origin as DavidFeedbackOrigin);
  if (origin !== "user" && origin !== "agent") {
    throw new Error(`${path}.origin 非法: ${String(value.origin)}`);
  }
  // decision 只在 agent 提议上有意义；缺省表示尚未 review，不落字段。
  let decision: DavidFeedbackDecision | undefined;
  if (value.decision !== undefined) {
    if (value.decision !== "accepted" && value.decision !== "rejected") {
      throw new Error(`${path}.decision 非法: ${String(value.decision)}`);
    }
    if (origin !== "agent") {
      throw new Error(`${path}.decision 只能用于 origin=agent 的条目`);
    }
    decision = value.decision;
  }
  const replies =
    value.replies !== undefined
      ? parseFeedbackReplies(value.replies, `${path}.replies`)
      : undefined;
  const scope = parseFeedbackScope(value.scope, `${path}.scope`);
  const pluginDraft =
    value.pluginDraft !== undefined
      ? parsePluginDraft(value.pluginDraft, `${path}.pluginDraft`)
      : undefined;
  return {
    id: value.id,
    category: value.category as DavidFeedbackEntry["category"],
    suggestion: value.suggestion,
    createdAt: value.createdAt,
    status,
    origin,
    ...(decision !== undefined ? { decision } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(replies !== undefined ? { replies } : {}),
    ...(pluginDraft !== undefined ? { pluginDraft } : {}),
  };
};

/** 严格解析 david-feedback/v1 文档。 */
export function parseFeedback(value: unknown): DavidFeedbackDocument {
  if (!isRecord(value)) throw new Error("feedback 文档必须是对象");
  rejectUnknownKeys(
    value,
    ["schema", "schemaVersion", "slug", "updatedAt", "mode", "entries"],
    "feedback",
  );
  if (value.schema !== DAVID_FEEDBACK_SCHEMA) {
    throw new Error(`feedback.schema 必须为 ${DAVID_FEEDBACK_SCHEMA}`);
  }
  if (value.schemaVersion !== 1)
    throw new Error("feedback.schemaVersion 必须为 1");
  if (!isNonEmptyString(value.slug))
    throw new Error("feedback.slug 必须为非空字符串");
  if (value.slug.length > PLUGIN_SLUG_MAX_LENGTH) {
    throw new Error(`feedback.slug 长度不能超过 ${PLUGIN_SLUG_MAX_LENGTH}`);
  }
  if (!isNonEmptyString(value.updatedAt))
    throw new Error("feedback.updatedAt 必须为非空字符串");
  const mode: DavidFeedbackMode =
    value.mode === undefined ? "integrated" : (value.mode as DavidFeedbackMode);
  if (mode !== "integrated" && mode !== "plugin")
    throw new Error("feedback.mode 非法");
  if (!Array.isArray(value.entries))
    throw new Error("feedback.entries 必须为数组");
  const entries = value.entries.map((entry, index) =>
    parseFeedbackEntry(entry, `feedback.entries[${index}]`),
  );
  const seenEntryIds = new Set<string>();
  for (const entry of entries) {
    if (seenEntryIds.has(entry.id)) {
      throw new Error(`feedback.entries 存在重复条目 id: ${entry.id}`);
    }
    seenEntryIds.add(entry.id);
  }
  return {
    schema: DAVID_FEEDBACK_SCHEMA,
    schemaVersion: 1,
    slug: value.slug,
    updatedAt: value.updatedAt,
    mode,
    entries,
  };
}
