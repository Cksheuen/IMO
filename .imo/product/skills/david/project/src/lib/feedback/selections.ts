import type { AppearanceSelection } from "../globalSelection";
import type { DavidFeedbackDocument, DavidFeedbackScope } from "./types.ts";
import { DAVID_MAX_SELECTIONS_PER_ENTRY } from "./constants.ts";
import { validateAppearanceSelection } from "./selectionSchema.ts";

export function feedbackSelections(
  scope?: DavidFeedbackScope,
): AppearanceSelection[] {
  return scope?.selections ?? (scope?.selection ? [scope.selection] : []);
}
export function selectionScope(
  selection: AppearanceSelection,
): DavidFeedbackScope {
  const componentId =
    selection.detail?.componentId ?? selection.scene.componentId;
  const nodeId = selection.detail?.nodeId ?? selection.scene.nodeId;
  const nodePath = [componentId, nodeId].filter((id): id is string =>
    Boolean(id),
  );
  return {
    selection,
    ...(selection.scene.pageId ? { pageId: selection.scene.pageId } : {}),
    ...(nodePath.length ? { nodePath } : {}),
    ...(selection.targets[0]
      ? { targetId: selection.targets[0].targetId }
      : {}),
  };
}
export function appendFeedbackSelection(
  doc: DavidFeedbackDocument,
  entryId: string,
  selection: AppearanceSelection,
): DavidFeedbackDocument {
  validateAppearanceSelection(selection, "selection");
  let found = false;
  let changed = false;
  const entries = doc.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    found = true;
    const current = feedbackSelections(entry.scope);
    if (
      current.some((item) => JSON.stringify(item) === JSON.stringify(selection))
    )
      return entry;
    if (current.length >= DAVID_MAX_SELECTIONS_PER_ENTRY)
      throw new Error(`每条评论最多 ${DAVID_MAX_SELECTIONS_PER_ENTRY} 个选区`);
    changed = true;
    const selections = [...current, selection];
    return {
      ...entry,
      scope: {
        ...(current.length ? entry.scope : selectionScope(selection)),
        selection: selections[0],
        ...(selections.length > 1 ? { selections } : {}),
      },
    };
  });
  if (!found) throw new Error(`feedback 条目不存在: ${entryId}`);
  return changed
    ? { ...doc, entries, updatedAt: new Date().toISOString() }
    : doc;
}

/** Remove one exact selection; repeated removal is a no-op. */
export function removeFeedbackSelection(
  doc: DavidFeedbackDocument,
  entryId: string,
  selection: AppearanceSelection,
): DavidFeedbackDocument {
  validateAppearanceSelection(selection, "selection");
  let found = false,
    changed = false;
  const entries = doc.entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    found = true;
    const current = feedbackSelections(entry.scope),
      selections = current.filter(
        (item) => JSON.stringify(item) !== JSON.stringify(selection),
      );
    if (current.length === selections.length) return entry;
    changed = true;
    const next = { ...entry };
    if (!selections.length) delete next.scope;
    else
      next.scope = {
        ...selectionScope(selections[0]),
        ...(selections.length > 1 ? { selections } : {}),
      };
    return next;
  });
  if (!found) throw new Error(`feedback 条目不存在: ${entryId}`);
  return changed
    ? { ...doc, entries, updatedAt: new Date().toISOString() }
    : doc;
}
