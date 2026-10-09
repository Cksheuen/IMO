/**
 * david-feedback / david-plugin 纯逻辑层入口。
 *
 * 实现已分层拆入 ./feedback/（constants/guards/types/pluginDraft/
 * selectionSchema/parseFeedback/merge/document）；本文件保留为薄 re-export，
 * 现有全部导入路径（../lib/davidFeedback）与导出签名不变。
 */

export * from "./feedback/index.ts";
