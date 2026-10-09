import type { ReactNode } from "react";

/**
 * 安全渲染内联代码、加粗和 BE 契约徽章。
 *
 * 安全约束：
 * - 不使用 dangerouslySetInnerHTML / eval；所有文本按 React 文本节点转义。
 * - 仅允许 <code>/<b>/<strong>/<mark> 白名单标签与 BE-F 契约徽章，
 *   其余内容（包括 <script>、<img onerror> 等）一律按纯文本渲染。
 */
export function renderRichText(text?: string): ReactNode {
  if (!text) return null;
  const tokenRegex =
    /(<code>[\s\S]*?<\/code>|<b>[\s\S]*?<\/b>|<strong>[\s\S]*?<\/strong>|<mark>[\s\S]*?<\/mark>|\bBE-F\d+-\d{3}(?!\d))/g;
  const parts = text.split(tokenRegex);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("<code>") && part.endsWith("</code>")) {
      return <code key={i}>{part.slice(6, -7)}</code>;
    }
    if (part.startsWith("<b>") && part.endsWith("</b>")) {
      return <strong key={i}>{part.slice(3, -4)}</strong>;
    }
    if (part.startsWith("<strong>") && part.endsWith("</strong>")) {
      return <strong key={i}>{part.slice(8, -9)}</strong>;
    }
    if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
      return <mark key={i}>{part.slice(6, -7)}</mark>;
    }
    if (/^BE-F\d+-\d{3}$/.test(part)) {
      return (
        <span key={i} className="trd-be-badge">
          {part}
        </span>
      );
    }
    return part;
  });
}
