import type { AppearanceSelection } from "../../lib/globalSelection";
import { buildSelectionContextChips } from "./contextChipModel";
import "./feedback.css";

export type SelectionContextChipsProps = {
  selection?: Pick<AppearanceSelection, "context">;
  /** Compact rendering drops the text snippet / dom path lines. */
  compact?: boolean;
};

/**
 * Readable chips for a stored appearance selection's deep context.
 * Renders nothing when the selection has no context (v1 legacy data).
 */
export function SelectionContextChips({
  selection,
  compact = false,
}: SelectionContextChipsProps) {
  const context = selection?.context;
  if (!context) return null;

  const chips = buildSelectionContextChips(context);

  return (
    <div className="dv-fb-ctx" data-testid="selection-context-chips">
      {chips.length > 0 && (
        <ul className="dv-fb-ctx-chips">
          {chips.map((chip) => (
            <li
              key={`${chip.key}:${chip.value}`}
              className={`dv-fb-chip${chip.tone ? ` dv-fb-chip--${chip.tone}` : ""}`}
              title={chip.title ?? chip.value}
            >
              <span className="dv-fb-chip__key">{chip.key}</span>
              <span>{chip.value}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && context.regionText && (
        <div className="dv-fb-region-text">
          <p>
            区域内可见文字 · {context.regionText.text.length} 字符
            {context.regionText.truncated ? "（已截断，请缩小选区）" : ""}
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {context.regionText.text ||
              "此区域未提取到可见 DOM 文字；图片、画布和嵌入页面需结合区域位置查看。"}
          </pre>
        </div>
      )}
      {!compact && !context.regionText && context.textSnippet && (
        <p
          className="dv-fb-snippet"
          title="历史记录仅保存命中元素摘要，不代表整个选区"
        >
          历史摘要（非完整选区）：{context.textSnippet}
        </p>
      )}
      {!compact && context.domPath && (
        <p className="dv-fb-dompath" title="命中元素 DOM 路径">
          {context.domPath}
        </p>
      )}
    </div>
  );
}
