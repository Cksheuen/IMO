import {
  parseFeedback,
  serializeFeedback,
  type DavidFeedbackDocument,
} from "./davidFeedback";

/**
 * 剪贴板信封（clipboard envelope）编解码，纯函数，不碰 DOM。
 *
 * 本模块负责「整份 david-feedback 文档 ↔ 剪贴板文本」的转换。
 * 设计约束：使用方必须把 parseAgentClipboardPayload 返回的原始 json 字符串
 * 原样交给导入通道（onImportFeedback / updateFeedback）——useDavidFeedback 依赖
 * `typeof input === "string"` 判断「显式导入」并走 mergeFeedbackDocuments 按 id 安全合并，
 * 从而保留用户新评论；若改传解析后的对象，会绕过合并、整体替换文档，覆盖用户新评论。
 */

export const AGENT_CLIPBOARD_HEADER =
  "david-feedback/v1 · 本机剪贴板交换 · 仅本地，未同步任何远端";

/** 握手行 + slug 行 + 空行 + 文档 JSON，拼成整段剪贴板文本。 */
export function buildAgentClipboardPayload(doc: DavidFeedbackDocument): string {
  return [
    AGENT_CLIPBOARD_HEADER,
    `slug: ${doc.slug}`,
    "",
    serializeFeedback(doc),
  ].join("\n");
}

/**
 * 容忍前置说明行；只取第一个 '{' 起的 JSON，严格校验后返回原始 JSON 串。
 * 返回值里的 json 必须原样传给导入通道（不要改传 doc 对象），否则会绕过
 * useDavidFeedback 的显式导入安全合并，导致用户新评论被整体替换覆盖。
 */
export function parseAgentClipboardPayload(text: string): {
  doc: DavidFeedbackDocument;
  json: string;
} {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("剪贴板内容不含 david-feedback JSON");
  const json = text.slice(start).trim();
  return { doc: parseFeedback(JSON.parse(json)), json };
}
