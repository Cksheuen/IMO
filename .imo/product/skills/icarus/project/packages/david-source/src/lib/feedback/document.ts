/**
 * feedback / plugin 文档读写纯函数：创建、序列化、条目变更、插件聚合。
 */

import {
  DAVID_FEEDBACK_INDEX_SCHEMA,
  DAVID_FEEDBACK_SCHEMA,
  DAVID_PLUGIN_SCHEMA,
  DAVID_SUGGESTION_MAX_LENGTH,
} from "./constants.ts";

import { parseFeedback } from "./parseFeedback.ts";
import type {
  DavidFeedbackDecision,
  DavidFeedbackDocument,
  DavidFeedbackEntry,
  DavidFeedbackEntryStatus,
  DavidFeedbackIndex,
  DavidFeedbackMode,
  DavidPluginBehavior,
  DavidPluginDraft,
  DavidPluginTheme,
} from "./types.ts";

/** localStorage key：david:<slug>:feedback */
export function feedbackStorageKey(slug: string): string {
  return `david:${slug}:feedback`;
}

/** 序列化为 JSON 字符串。 */
export function serializeFeedback(doc: DavidFeedbackDocument): string {
  return JSON.stringify(doc);
}

/** 创建空反馈文档（mode 默认 integrated）。 */
export function createFeedbackDocument(
  slug: string,
  entries: DavidFeedbackEntry[] = [],
  mode: DavidFeedbackMode = "integrated",
): DavidFeedbackDocument {
  return {
    schema: DAVID_FEEDBACK_SCHEMA,
    schemaVersion: 1,
    slug,
    updatedAt: new Date().toISOString(),
    mode,
    entries,
  };
}

/**
 * 更新指定条目的建议正文（纯函数）。
 * 条目不存在或正文非法（空/超长）时抛错；不修改输入文档，返回带新 updatedAt 的新文档。
 */
export function setFeedbackEntrySuggestion(
  doc: DavidFeedbackDocument,
  entryId: string,
  suggestion: string,
): DavidFeedbackDocument {
  if (typeof suggestion !== "string" || !suggestion.trim()) {
    throw new Error("feedback 条目建议不能为空");
  }
  if (suggestion.length > DAVID_SUGGESTION_MAX_LENGTH) {
    throw new Error(
      `feedback 条目建议长度不能超过 ${DAVID_SUGGESTION_MAX_LENGTH}`,
    );
  }
  let found = false;
  const entries = doc.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    found = true;
    return { ...entry, suggestion };
  });
  if (!found) {
    throw new Error(`feedback 条目不存在: ${entryId}`);
  }
  return { ...doc, updatedAt: new Date().toISOString(), entries };
}

/**
 * 设置指定条目的解决状态（纯函数）。
 * 条目不存在或状态非法时抛错；不修改输入文档，返回带新 updatedAt 的新文档。
 */
export function setFeedbackEntryStatus(
  doc: DavidFeedbackDocument,
  entryId: string,
  status: DavidFeedbackEntryStatus,
): DavidFeedbackDocument {
  if (status !== "open" && status !== "resolved") {
    throw new Error(`feedback 条目状态非法: ${String(status)}`);
  }
  let found = false;
  const entries = doc.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    found = true;
    return { ...entry, status };
  });
  if (!found) {
    throw new Error(`feedback 条目不存在: ${entryId}`);
  }
  return { ...doc, updatedAt: new Date().toISOString(), entries };
}

/**
 * 设置 agent 提议的采纳决议。与 status 正交：只表达用户 review 的结论，
 * 不改变 open/resolved。传入与当前相同的决议视为撤销，回到未 review。
 * 仅允许作用于 origin === "agent" 的条目。
 */
export function setFeedbackEntryDecision(
  doc: DavidFeedbackDocument,
  entryId: string,
  decision: DavidFeedbackDecision,
): DavidFeedbackDocument {
  if (decision !== "accepted" && decision !== "rejected") {
    throw new Error(`feedback 采纳决议非法: ${String(decision)}`);
  }
  let found = false;
  const entries = doc.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    found = true;
    if ((entry.origin ?? "user") !== "agent") {
      throw new Error(`只有 agent 提议可设置采纳决议: ${entryId}`);
    }
    if (entry.decision === decision) {
      // 再次点击同一决议 = 撤销，回到未 review 状态（不落 decision 字段）。
      const next = { ...entry };
      delete next.decision;
      return next;
    }
    return { ...entry, decision };
  });
  if (!found) {
    throw new Error(`feedback 条目不存在: ${entryId}`);
  }
  return { ...doc, updatedAt: new Date().toISOString(), entries };
}

/**
 * 从反馈条目的 pluginDraft 聚合生成声明式插件草稿（纯数据，不执行代码）。
 * 没有任何条目携带 pluginDraft 时返回 null。
 */
export function pluginFromFeedback(
  doc: DavidFeedbackDocument,
): DavidPluginDraft | null {
  const drafts = doc.entries
    .map((entry) => entry.pluginDraft)
    .filter((draft): draft is DavidPluginDraft => draft !== undefined);
  if (drafts.length === 0) return null;

  const first = drafts[0];
  const slugs = new Set<string>();
  const theme: DavidPluginTheme = {};
  let behavior: DavidPluginBehavior | undefined;
  for (const draft of drafts) {
    for (const slug of draft.match?.slugs ?? []) slugs.add(slug);
    Object.assign(theme, draft.theme);
    if (draft.behavior) behavior = { ...behavior, ...draft.behavior };
  }
  if (!slugs.has(doc.slug)) slugs.add(doc.slug);

  return {
    schema: DAVID_PLUGIN_SCHEMA,
    schemaVersion: 1,
    id: first.id,
    name: first.name,
    version: first.version,
    match: { slugs: [...slugs] },
    ...(Object.keys(theme).length > 0 ? { theme } : {}),
    ...(behavior !== undefined ? { behavior } : {}),
  };
}

/** localStorage key：david:plugins */
export const pluginStorageKey = "david:plugins";

/** 判断声明式插件是否匹配指定 slug（纯函数，不触碰 DOM）。 */
export function pluginMatchesSlug(
  plugin: DavidPluginDraft,
  slug: string,
): boolean {
  return (plugin.match?.slugs ?? []).includes(slug);
}

/**
 * 将插件主题白名单 tokens 映射为 CSS 自定义属性。
 * 仅返回白名单 Record（--paper 等、--david-radius、--david-font-scale），不触碰 DOM、不执行插件代码。
 */
export function pluginCssVariables(
  plugin: DavidPluginDraft,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const theme = plugin.theme;
  if (!theme) return vars;
  if (theme.paper !== undefined) vars["--paper"] = theme.paper;
  if (theme.ink !== undefined) vars["--ink"] = theme.ink;
  if (theme.accent !== undefined) vars["--accent"] = theme.accent;
  if (theme.gold !== undefined) vars["--gold"] = theme.gold;
  if (theme.muted !== undefined) vars["--muted"] = theme.muted;
  if (theme.radius !== undefined) vars["--david-radius"] = theme.radius;
  if (theme.fontScale !== undefined)
    vars["--david-font-scale"] = theme.fontScale;
  return vars;
}

/** 构建 agent 可读的反馈索引 JSON。 */
export function buildFeedbackIndex(
  docs: readonly DavidFeedbackDocument[],
): DavidFeedbackIndex {
  return {
    schema: DAVID_FEEDBACK_INDEX_SCHEMA,
    schemaVersion: 1,
    items: docs.map((doc) => ({
      slug: doc.slug,
      updatedAt: doc.updatedAt,
      mode: doc.mode,
      count: doc.entries.length,
      entries: doc.entries.map((entry) => ({ ...entry })),
    })),
  };
}

export { parseFeedback };
