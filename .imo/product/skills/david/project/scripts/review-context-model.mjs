import { resolveNodeMapping } from "../src/lib/reviewTree.ts";
import {
  hasAnchor,
  previewFragments,
  declaredActions,
} from "./review-context-html.mjs";

const clip = (value) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").slice(0, 120)
    : undefined;
const omit = (value, keys) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
export function reviewIndex(spec, pages) {
  const entries = [];
  const add = (kind, value, pointer, extra = {}) => {
    const entry = { kind, id: value.id, value, pointer, ...extra };
    entries.push(entry);
    return entry;
  };
  pages.forEach((page, i) =>
    add("page", page, spec.pages ? `/pages/${i}` : "/pageHtml"),
  );
  const walk = (node, pointer, component, ancestors) => {
    const entry = add(
      node === component ? "component" : "node",
      node,
      pointer,
      { component, ancestors },
    );
    (node.mapping ?? []).forEach((row, i) =>
      add("row", row, `${pointer}/mapping/${i}`, {
        component,
        ancestors: [...ancestors, entry],
        node,
      }),
    );
    (node.children ?? []).forEach((child, i) =>
      walk(child, `${pointer}/children/${i}`, component, [...ancestors, entry]),
    );
  };
  (spec.components ?? []).forEach((component, i) =>
    walk(component, `/components/${i}`, component, []),
  );
  (spec.apiContracts ?? []).forEach((contract, i) =>
    add("contract", contract, `/apiContracts/${i}`),
  );
  (spec.openQuestions ?? []).forEach((question, i) =>
    add("question", question, `/openQuestions/${i}`),
  );
  return entries;
}

export const describe = (entry) => ({
  kind: entry.kind,
  id: entry.id,
  selector: entry.pointer,
  label: clip(
    entry.value.label ??
      entry.value.title ??
      entry.value.topic ??
      entry.value.requirement ??
      entry.value.suggestion,
  ),
  ...(entry.component ? { componentId: entry.component.id } : {}),
});

export function selectEntry(index, selector) {
  const matches = index.filter(
    (entry) =>
      entry.pointer === selector ||
      entry.id === selector ||
      `${entry.kind}:${entry.id}` === selector,
  );
  if (matches.length !== 1) {
    const error = new Error(
      matches.length
        ? "Ambiguous selector; use an exact selector from the catalog"
        : "Unknown selector",
    );
    error.candidates = matches.map(describe);
    throw error;
  }
  return matches[0];
}

export function scopedReview(spec, pages, index, entry, includePreview) {
  const component = entry.component;
  const node = entry.value;
  const ownRows =
    entry.kind === "row"
      ? [node]
      : component
        ? resolveNodeMapping(node, component)
        : [];
  const rowIds = new Set(ownRows.map((row) => row.id));
  const contracts = new Set(
    ownRows.flatMap((row) => row.api?.contractIds ?? []),
  );
  const anchor =
    entry.kind === "component"
      ? { attribute: "data-component-id", token: node.id }
      : entry.kind === "node"
        ? { attribute: "data-review-node-id", token: node.target ?? node.id }
        : entry.kind === "contract"
          ? null
          : component
            ? { attribute: "data-component-id", token: component.id }
            : null;
  const hosting =
    entry.kind === "page"
      ? [node]
      : anchor
        ? pages.filter(
            (page) =>
              hasAnchor(page.pageHtml ?? "", anchor.attribute, anchor.token) ||
              page.scene?.components.some(
                (item) => item.componentId === component?.id,
              ),
          )
        : [];
  const relatedRows = index.filter(
    (item) =>
      item.kind === "row" && item.value.api?.contractIds?.includes(entry.id),
  );
  const body = {
    selection: describe(entry),
    value:
      entry.kind === "row"
        ? { id: node.id, title: node.title }
        : omit(node, ["pageHtml", "children", "mapping"]),
    ancestors: (entry.ancestors ?? []).map((item) => ({
      ...describe(item),
      context: omit(item.value, ["children", "mapping"]),
    })),
    rows: ownRows,
    contracts: (spec.apiContracts ?? []).filter((contract) =>
      contracts.has(contract.id),
    ),
    children: index
      .filter(
        (item) =>
          item.ancestors?.at(-1)?.pointer === entry.pointer &&
          item.kind !== "row",
      )
      .map(describe),
    pages: hosting.map((page) => ({
      id: page.id,
      label: page.label,
      kind: page.kind,
      ...(entry.kind !== "page"
        ? {
            interactions: page.interactions?.filter(
              (action) =>
                action.source === node.id ||
                action.source === node.target ||
                action.targetNodeId === node.id,
            ),
            scene: page.scene
              ? {
                  components: page.scene.components.filter(
                    (item) =>
                      item.componentId === component?.id ||
                      item.nodeId === node.id,
                  ),
                  state: page.scene.state,
                }
              : undefined,
          }
        : {}),
    })),
  };
  if (entry.kind === "page") {
    body.components = index
      .filter(
        (item) =>
          item.kind === "component" &&
          (hasAnchor(node.pageHtml ?? "", "data-component-id", item.id) ||
            node.scene?.components.some((c) => c.componentId === item.id)),
      )
      .map(describe);
  }
  if (entry.kind === "contract") body.consumers = relatedRows.map(describe);
  body.declaredActions = hosting.flatMap((page) =>
    declaredActions(page, entry.kind === "page" ? null : anchor),
  );
  const selectedText = JSON.stringify(body);
  body.questions = (spec.openQuestions ?? []).filter(
    (question) =>
      selectedText.includes(JSON.stringify(question.id)) ||
      selectedText.includes(`openQuestions#${question.id}`),
  );
  const otherQuestions = (spec.openQuestions ?? []).filter(
    (question) =>
      !(
        selectedText.includes(JSON.stringify(question.id)) ||
        selectedText.includes(`openQuestions#${question.id}`)
      ),
  );
  body.otherQuestions = {
    total: otherQuestions.length,
    items: otherQuestions.slice(0, 10).map((question) => ({
      id: question.id,
      topic: clip(question.topic),
      status: question.status,
      selector: `question:${question.id}`,
    })),
    catalog: "--kind question",
  };
  body.ownership = spec.collaboration ?? null;
  if (includePreview) {
    const anchors =
      entry.kind === "contract"
        ? [...(node.response ?? []), ...(node.request ?? [])].map((field) => ({
            attribute: "data-api-field",
            token: field.name,
          }))
        : entry.kind === "row"
          ? [
              anchor,
              ...(node.api?.fields ?? []).map((field) => ({
                attribute: "data-api-field",
                token: field.name,
              })),
            ].filter(Boolean)
          : anchor
            ? [anchor]
            : [];
    body.preview =
      entry.kind === "page"
        ? [{ pageId: node.id, fragments: [node.pageHtml], styles: [] }]
        : (entry.kind === "contract" ? pages : hosting).map((page) =>
            previewFragments(page, anchors),
          );
  }
  body.coverage = {
    descendantDetails: "catalog-only; select a child for its full content",
    otherQuestions:
      "scope not inferred from prose; inspect relevant question ids",
    rowIds: [...rowIds],
  };
  return body;
}
