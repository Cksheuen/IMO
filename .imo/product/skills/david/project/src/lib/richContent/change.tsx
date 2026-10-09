import type { ReactNode } from "react";
import { ChangeRationale, DiffCodeBlock } from "../../components/change-block";
import type { ChangeBlock } from "../../types/review";

/**
 * Contract 1 (change block): render the structured before/after change.
 * - add: after side + rationale only;
 * - modify: two-sided diff + rationale;
 * - remove: before side + rationale only.
 * The side filtering is applied here so the semantics hold regardless of
 * how DiffCodeBlock renders its props.
 */
export function renderChangeBlock(block?: ChangeBlock): ReactNode {
  if (!block) return null;
  const before = block.kind === "add" ? undefined : block.before;
  const after = block.kind === "remove" ? undefined : block.after;
  return (
    <div className="trd-change-block" data-change-kind={block.kind}>
      <ChangeRationale block={block} />
      <DiffCodeBlock kind={block.kind} before={before} after={after} />
    </div>
  );
}
