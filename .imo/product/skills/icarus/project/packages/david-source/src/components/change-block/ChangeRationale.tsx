import type { ChangeBlock } from "../../types/review";
import { CHANGE_KIND_LABELS } from "../../lib/changeModel";
import "./ChangeRationale.css";

/**
 * Renders the narrative part of a change block:
 * kind badge (add=gold/accent, modify=blue, remove=red-gray),
 * rationale text, and an optional impact disclosure (native
 * details/summary, collapsed by default). Deliberately self-contained:
 * it does not depend on the ui/ kit so A1's rich-content renderer is
 * the only composition point (DiffCodeBlock + ChangeRationale).
 * Class prefix dv-change-.
 */
export function ChangeRationale({ block }: { block: ChangeBlock }) {
  return (
    <div className="dv-change" data-dv-change-kind={block.kind}>
      <div className="dv-change-head">
        <span
          className={["dv-change-badge", `dv-change-badge-${block.kind}`].join(
            " ",
          )}
        >
          {CHANGE_KIND_LABELS[block.kind]}
        </span>
      </div>
      <p className="dv-change-rationale">{block.rationale}</p>
      {block.impact && block.impact.trim() !== "" && (
        <details className="dv-change-impact">
          <summary className="dv-change-impact-summary">改动影响面</summary>
          <div className="dv-change-impact-body">{block.impact}</div>
        </details>
      )}
    </div>
  );
}
