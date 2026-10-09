import { IconButton } from "../ui/IconButton";
import { TrashIcon } from "../ui/TrashIcon";
import type { AppearanceSelection } from "../../lib/globalSelection";
import { DAVID_MAX_SELECTIONS_PER_ENTRY } from "../../lib/davidFeedback";
import { SelectionContextChips } from "./SelectionContextChips";

export function SelectionList({
  selections,
  onAdd,
  onLocate,
  onRemove,
}: {
  selections: readonly AppearanceSelection[];
  onAdd?: () => void;
  onLocate?: (selection: AppearanceSelection) => void;
  onRemove?: (index: number) => void;
}) {
  if (!selections.length && !onAdd) return null;
  return (
    <section
      className="feedback-selections"
      data-testid="feedback-selection-list"
    >
      <div className="feedback-selections-heading">
        <strong>当前选区</strong>
        <span>
          {selections.length} / {DAVID_MAX_SELECTIONS_PER_ENTRY}
        </span>
        {onAdd && (
          <button
            type="button"
            className="feedback-selection-add"
            disabled={selections.length >= DAVID_MAX_SELECTIONS_PER_ENTRY}
            onClick={onAdd}
          >
            新增选区
          </button>
        )}
      </div>
      {selections.map((selection, index) => (
        <details
          key={`${selection.capturedAt}-${index}`}
          className="feedback-selection-item"
          data-selection-index={index}
          data-testid={
            index === 0
              ? "feedback-selection-context"
              : `feedback-selection-context-${index + 1}`
          }
        >
          <summary>
            选区 {index + 1} ·{" "}
            {selection.context?.heading ||
              selection.targets[0]?.label ||
              selection.surface}
            {onRemove && (
              <span className="feedback-selection-remove">
                <IconButton
                  label={`删除选区 ${index + 1}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove(index);
                  }}
                >
                  <TrashIcon />
                </IconButton>
              </span>
            )}
          </summary>
          <dl>
            <dt>所在区域</dt>
            <dd>{selection.surface}</dd>
            <dt>选中内容</dt>
            <dd>
              {selection.targets.map((target) => target.label).join("、")}
            </dd>
            <dt>选区尺寸</dt>
            <dd>
              {Math.round(selection.rect.nw * selection.viewport.width)} ×{" "}
              {Math.round(selection.rect.nh * selection.viewport.height)} px
            </dd>
            <dt>页面与层级</dt>
            <dd>
              {[
                selection.scene.pageId,
                selection.scene.componentId,
                selection.scene.nodeId,
                selection.detail?.rowId,
                selection.detail?.column,
              ]
                .filter(Boolean)
                .join(" / ")}
            </dd>
          </dl>
          <SelectionContextChips selection={selection} />
          <div className="feedback-selection-actions">
            {onLocate && (
              <button type="button" onClick={() => onLocate(selection)}>
                定位选区 {index + 1}
              </button>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
