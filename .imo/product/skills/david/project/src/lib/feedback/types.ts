/**
 * david-feedback / david-plugin 类型定义。
 */

import type { AppearanceSelection } from "../globalSelection";
import type {
  DAVID_FEEDBACK_SCHEMA,
  DAVID_FEEDBACK_INDEX_SCHEMA,
  DAVID_PLUGIN_SCHEMA,
} from "./constants";
import type { DavidFeedbackCategory } from "./constants";
export type DavidFeedbackMode = "integrated" | "plugin";
export type DavidFeedbackEntryStatus = "open" | "resolved";

/** 回复作者。缺省视为 "user"（人写的评论）；"agent" 为 agent 兜底生成的回复。 */
export type DavidFeedbackReplyAuthor = "user" | "agent";

/** 条目内的回复（严格可选扩展；旧条目无此字段仍可读）。 */
export type DavidFeedbackReply = {
  id: string;
  body: string;
  createdAt: string;
  /** 缺省视为 "user"；parse 时 user 不落盘，与旧版逐字节兼容。 */
  author?: DavidFeedbackReplyAuthor;
};

export type DavidFeedbackScope = {
  pageId?: string;
  nodePath?: string[];
  targetId?: string;
  selection?: AppearanceSelection;
  /** Ordered regions for one comment; selection remains the legacy primary. */
  selections?: AppearanceSelection[];
};

/** 统一解析后的反馈定位目标（page/component/node 三级）。 */
export type ResolvedFeedbackTarget = {
  pageId?: string;
  componentId?: string;
  nodeId?: string;
};

/** 声明式插件主题：仅允许白名单 design tokens */
export type DavidPluginTheme = {
  paper?: string;
  ink?: string;
  accent?: string;
  gold?: string;
  muted?: string;
  radius?: string;
  fontScale?: string;
};

/** 声明式插件行为：仅允许 motionScale 与 defaultInteraction */
export type DavidPluginBehavior = {
  motionScale?: number;
  defaultInteraction?: "highlight" | "drilldown" | "auto";
};

export type DavidPluginDraft = {
  schema: typeof DAVID_PLUGIN_SCHEMA;
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  match?: { slugs?: string[] };
  theme?: DavidPluginTheme;
  behavior?: DavidPluginBehavior;
};

/** 条目来源。缺省视为 "user"（人写的评论）；"agent" 为 agent 主动提出的建议。 */
export type DavidFeedbackOrigin = "user" | "agent";

/** 用户对 agent 提议的采纳决议。缺省表示尚未 review。 */
export type DavidFeedbackDecision = "accepted" | "rejected";

export type DavidFeedbackEntry = {
  id: string;
  category: DavidFeedbackCategory;
  suggestion: string;
  createdAt: string;
  /** 缺省视为 open；parse 时旧条目归一化为 "open"。 */
  status?: DavidFeedbackEntryStatus;
  /** 缺省视为 "user"；旧条目无此字段仍可读。 */
  origin?: DavidFeedbackOrigin;
  /** 仅对 origin === "agent" 有意义；缺省表示尚未 review。 */
  decision?: DavidFeedbackDecision;
  scope?: DavidFeedbackScope;
  replies?: DavidFeedbackReply[];
  pluginDraft?: DavidPluginDraft;
};

export type DavidFeedbackDocument = {
  schema: typeof DAVID_FEEDBACK_SCHEMA;
  schemaVersion: 1;
  slug: string;
  updatedAt: string;
  mode: DavidFeedbackMode;
  entries: DavidFeedbackEntry[];
};

export type DavidFeedbackIndexItem = {
  slug: string;
  updatedAt: string;
  mode: DavidFeedbackMode;
  count: number;
  entries?: DavidFeedbackEntry[];
};

export type DavidFeedbackIndex = {
  schema: typeof DAVID_FEEDBACK_INDEX_SCHEMA;
  schemaVersion: 1;
  items: DavidFeedbackIndexItem[];
};
