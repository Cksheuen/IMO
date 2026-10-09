/**
 * david-feedback / david-plugin 逻辑层（纯函数，不触碰 DOM、不执行插件代码）。
 *
 * 分层：
 * - constants/guards/types：共享常量、守卫、类型
 * - pluginDraft：david-plugin/v1 草稿白名单解析
 * - selectionSchema：AppearanceSelection（含 selection.context）严格校验
 * - parseFeedback：david-feedback/v1 文档/条目/回复严格解析
 * - merge：文档合并、回复追加、scope 目标解析
 * - document：文档创建/序列化/条目变更/插件聚合/索引
 *
 * 相对导入保留 .ts 扩展名：本目录会被 Node 24 原生 type-stripping 直接加载
 * （serve-feedback.mjs / CLI / bridge 测试 import davidFeedback.ts），Node ESM
 * 要求完整说明符；tsconfig.allowImportingTsExtensions 统一支持。
 */

export * from "./constants.ts";

export * from "./types.ts";

export { parsePluginDraft } from "./pluginDraft.ts";
export {
  validateAppearanceSelection,
  validateSelectionContext,
} from "./selectionSchema.ts";

export { parseFeedback, parseFeedbackReply } from "./parseFeedback.ts";
export {
  appendFeedbackReply,
  mergeFeedbackDocuments,
  reorderFeedbackReplies,
  replyAuthor,
  resolveFeedbackTarget,
} from "./merge.ts";
export {
  buildFeedbackIndex,
  createFeedbackDocument,
  feedbackStorageKey,
  pluginCssVariables,
  pluginFromFeedback,
  pluginMatchesSlug,
  pluginStorageKey,
  serializeFeedback,
  setFeedbackEntryDecision,
  setFeedbackEntryStatus,
  setFeedbackEntrySuggestion,
} from "./document.ts";

export {
  feedbackSelections,
  selectionScope,
  appendFeedbackSelection,
  removeFeedbackSelection,
} from "./selections.ts";
