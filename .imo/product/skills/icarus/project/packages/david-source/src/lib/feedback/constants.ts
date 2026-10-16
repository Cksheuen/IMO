/**
 * david-feedback / david-plugin 共用常量。
 */

export const DAVID_FEEDBACK_SCHEMA = "david-feedback/v1" as const;
export const DAVID_PLUGIN_SCHEMA = "david-plugin/v1" as const;
export const DAVID_FEEDBACK_INDEX_SCHEMA = "david-feedback-index/v1" as const;

export const DAVID_SUGGESTION_MAX_LENGTH = 2000;
export const DAVID_REPLY_MAX_LENGTH = 2000;
export const DAVID_MAX_REPLIES_PER_ENTRY = 100;
export const DAVID_MAX_SELECTIONS_PER_ENTRY = 8;

export type DavidFeedbackCategory =
  "visual" | "interaction" | "content" | "schema" | "other";

export const FEEDBACK_CATEGORIES: readonly DavidFeedbackCategory[] = [
  "visual",
  "interaction",
  "content",
  "schema",
  "other",
];

export const PLUGIN_ID_MAX_LENGTH = 128;
export const PLUGIN_SLUG_MAX_LENGTH = 128;
export const PLUGIN_MAX_SLUGS = 64;
export const PLUGIN_MAX_RADIUS = 32;
export const PLUGIN_MIN_FONT_SCALE = 0.8;
export const PLUGIN_MAX_FONT_SCALE = 1.4;
