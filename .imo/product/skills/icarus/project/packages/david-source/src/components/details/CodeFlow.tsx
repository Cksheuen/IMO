import { useState } from "react";
import type { LogicGraph, TechModule, TechPoint } from "../../types/review";
import type { AppearanceSelection } from "../../lib/globalSelection";
import { renderTechGroups } from "../../lib/richContent";
import { LogicCanvas } from "../canvas/LogicCanvas";
import { CodeFlowDetail } from "./CodeFlowDetail";
import { GraphPresentation } from "./GraphPresentation";

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** Stable targets for new feedback; scoped text matching for existing comments. */
function pointForSelection(
  points: TechPoint[],
  selection?: AppearanceSelection,
) {
  const target = selection?.context?.anchorChain?.target;
  const direct = points.find((p) => target === `tech-point:${p.id}`);
  if (direct) return direct.id;
  const snippet = normalize(selection?.context?.textSnippet ?? "");
  const heading = normalize(selection?.context?.heading ?? "");
  return points.find(
    (p) =>
      (heading && Boolean(p.title) && heading.endsWith(normalize(p.title!))) ||
      (snippet.length >= 12 &&
        [
          p.pseudoCode,
          p.changeBlock?.before?.code,
          p.changeBlock?.after?.code,
          ...(p.codeAnnotations?.flatMap((a) => a.bullets) ?? []),
        ].some((code) => code && normalize(code).includes(snippet))),
  )?.id;
}

export function CodeFlow({
  graph,
  points,
  modules,
  focusSelection,
}: {
  graph: LogicGraph;
  points: TechPoint[];
  modules?: TechModule[];
  focusSelection?: AppearanceSelection;
}) {
  const codePoints = points.filter((p) =>
    graph.nodes.some((n) => n.id === p.id),
  );
  const [selection, setSelection] = useState(focusSelection);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    [pointForSelection(codePoints, focusSelection) ?? codePoints[0]?.id].filter(
      (id): id is string => Boolean(id),
    ),
  );
  // Repeated comment navigation in an already-open dialog must select before
  // the parent's focus/scroll effect runs, without resetting reader choices.
  if (selection !== focusSelection) {
    setSelection(focusSelection);
    setSelectedIds(
      [
        pointForSelection(codePoints, focusSelection) ?? codePoints[0]?.id,
      ].filter((id): id is string => Boolean(id)),
    );
  }
  const active = codePoints.filter((p) => p.id && selectedIds.includes(p.id));
  const toggle = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const supporting = points.filter((p) => !codePoints.includes(p));
  return (
    <section className="trd-code-flow" aria-label="代码调用与引用关系">
      <GraphPresentation title="代码调用与引用关系" target="code-flow">
        <p className="trd-code-flow-hint">
          点击节点可多选，再次点击取消；下方展示已选代码。
        </p>
        <LogicCanvas
          graph={graph}
          label="代码调用与引用关系"
          selectedNodeIds={selectedIds}
          selectableNodeIds={codePoints.map((p) => p.id!)}
          onSelectNode={toggle}
        />
      </GraphPresentation>
      <div
        className="trd-code-flow-selections"
        data-selected-code-ids={active.map((p) => p.id).join(" ")}
      >
        {codePoints.map((point) => (
          <CodeFlowDetail
            key={point.id}
            id={point.id!}
            active={selectedIds.includes(point.id!)}
          >
            {renderTechGroups([point], modules)}
          </CodeFlowDetail>
        ))}
        {!active.length && (
          <p className="trd-code-flow-hint">选择上方节点查看代码。</p>
        )}
      </div>
      {supporting.length > 0 && renderTechGroups(supporting, modules)}
    </section>
  );
}
