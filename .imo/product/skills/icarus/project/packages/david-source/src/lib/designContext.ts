import type {
  MappingRow,
  PageSpec,
  ReviewComponent,
  ReviewData,
  ReviewNode,
} from "../types/review";
import { flattenReviewTree } from "./reviewTree.ts";

/**
 * Machine-readable design context (david-design-context/v1).
 *
 * Embedded into rendered review pages as
 * `<script id="david-design-context" type="application/json">` (see App root),
 * and extracted by `project/scripts/extract-design-context.mjs`.
 *
 * The document is a *directory* of the review data, not a replacement for it:
 * text fields are bounded summaries; the full content lives in review.json
 * (pageHtml / trd / deepDive). Agents read this first, then pull the full
 * nodes they need by id — see references/agent-readable-html.md.
 */
export const DESIGN_CONTEXT_SCHEMA = "david-design-context/v1" as const;

export type DesignContextChangeKind = "add" | "modify" | "migrate" | "remove";

export interface DesignContextPage {
  id: string;
  label?: string;
  kind?: string;
}

export interface DesignContextTreeNode {
  id: string;
  label?: string;
  kind: "overview" | "component" | "node";
  componentId?: string;
  nodeId?: string;
  children?: DesignContextTreeNode[];
}

export interface DesignContextAnchor {
  /** Anchor token: matches data-review-target / data-review-node-id / data-component-id. */
  target: string;
  label?: string;
  componentId?: string;
  nodeId?: string;
}

export interface DesignContextMapping {
  /**
   * Scoped row id (`<componentId>:<rowId>`, same convention as the
   * resolveOverview fallback); the owning component is the segment before
   * the first `:` and the raw row id (used by node.mappingIds) follows it.
   * Only component-level rows are listed here, matching overview semantics;
   * node-owned mapping rows live under tree nodes in review.json.
   */
  id: string;
  requirement?: string;
  change?: string;
  apiSummary?: string;
  changeBlockKind?: DesignContextChangeKind;
}

export interface DesignContextDocument {
  schema: typeof DESIGN_CONTEXT_SCHEMA;
  slug?: string;
  title?: string;
  pages: DesignContextPage[];
  tree: DesignContextTreeNode[];
  anchors: DesignContextAnchor[];
  mappings: DesignContextMapping[];
}

const SUMMARY_LIMIT = 120;

/** Bounded plain-text summary: collapse whitespace runs, then hard-clip. */
function clip(value: unknown, limit = SUMMARY_LIMIT): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit - 1)}…`;
}

/** Minimal structural view of ChangeBlock (contract 1; field added by A3). */
interface ChangeBlockShape {
  kind?: DesignContextChangeKind;
}

function changeBlockKind(row: MappingRow): DesignContextChangeKind | undefined {
  const block = (row as MappingRow & { changeBlock?: ChangeBlockShape })
    .changeBlock;
  const kind = block?.kind;
  return kind === "add" ||
    kind === "modify" ||
    kind === "migrate" ||
    kind === "remove"
    ? kind
    : undefined;
}

function summarizeNode(node: ReviewNode): DesignContextTreeNode {
  const summary: DesignContextTreeNode = {
    id: node.id,
    kind: "node",
    nodeId: node.id,
  };
  const label = clip(node.label);
  if (label) summary.label = label;
  if (node.children && node.children.length > 0) {
    summary.children = node.children.map(summarizeNode);
  }
  return summary;
}

function summarizeComponent(component: ReviewComponent): DesignContextTreeNode {
  const summary: DesignContextTreeNode = {
    id: component.id,
    kind: "component",
    componentId: component.id,
  };
  const label = clip(component.label);
  if (label) summary.label = label;
  if (component.children && component.children.length > 0) {
    summary.children = component.children.map(summarizeNode);
  }
  return summary;
}

/**
 * Review tree as a directory: synthetic overview root -> components -> recursive
 * nodes. Only id/label/kind/componentId/nodeId are kept (children recursive).
 */
function buildTree(data: ReviewData): DesignContextTreeNode[] {
  const overview: DesignContextTreeNode = { id: "overview", kind: "overview" };
  const title = clip(data.overview?.title ?? data.title);
  if (title) overview.label = title;
  overview.children = data.components.map(summarizeComponent);
  return [overview];
}

/**
 * Anchors derived from the review spec structure (NOT by parsing HTML):
 * - component roots: data-component-id / data-review-target
 * - recursive nodes: data-review-node-id (= target ?? id)
 * - api fields: data-api-field / data-review-target tokens from mapping rows
 * - declared page interactions: overlay/navigation trigger elements
 */
function buildAnchors(
  data: ReviewData,
  pages: PageSpec[],
): DesignContextAnchor[] {
  const anchors: DesignContextAnchor[] = [];
  const seen = new Set<string>();
  const add = (anchor: DesignContextAnchor) => {
    const key = `${anchor.target}|${anchor.componentId ?? ""}|${anchor.nodeId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push(anchor);
  };

  const addFieldAnchors = (
    row: MappingRow,
    componentId: string,
    nodeId?: string,
  ) => {
    for (const field of row.api?.fields ?? []) {
      const target = field.target ?? field.name;
      if (!target) continue;
      add({
        target,
        label: clip(field.meaning ?? field.name),
        componentId,
        nodeId,
      });
    }
  };

  for (const component of data.components) {
    add({
      target: component.target ?? component.id,
      label: clip(component.label),
      componentId: component.id,
    });
    for (const row of component.mapping ?? []) {
      addFieldAnchors(row, component.id);
    }
    for (const node of flattenReviewTree(component.children ?? [])) {
      add({
        target: node.target ?? node.id,
        label: clip(node.label),
        componentId: component.id,
        nodeId: node.id,
      });
      for (const row of node.mapping ?? []) {
        addFieldAnchors(row, component.id, node.id);
      }
    }
  }

  for (const page of pages) {
    for (const interaction of page.interactions ?? []) {
      if (!interaction.source) continue;
      add({
        target: interaction.source,
        label: clip(interaction.label ?? `${interaction.action} trigger`),
      });
    }
  }

  return anchors;
}

/** One bounded directory entry per mapping row (component-scoped id). */
function buildMappings(data: ReviewData): DesignContextMapping[] {
  const mappings: DesignContextMapping[] = [];
  for (const component of data.components) {
    for (const row of component.mapping ?? []) {
      const entry: DesignContextMapping = {
        id: `${component.id}:${row.id}`,
      };
      const requirement = clip(row.requirement);
      if (requirement) entry.requirement = requirement;
      const change = clip(row.change);
      if (change) entry.change = change;
      const apiSummary = clip(row.api?.summary);
      if (apiSummary) entry.apiSummary = apiSummary;
      const kind = changeBlockKind(row);
      if (kind) entry.changeBlockKind = kind;
      mappings.push(entry);
    }
  }
  return mappings;
}

function resolvePages(data: ReviewData, pagesArg?: unknown): PageSpec[] {
  if (Array.isArray(pagesArg) && pagesArg.length > 0) {
    return pagesArg as PageSpec[];
  }
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return data.pages;
  }
  // ReviewSpec may carry a single top-level pageHtml (same fallback as render).
  const spec = data as ReviewData & { pageHtml?: string };
  if (typeof spec.pageHtml === "string") {
    return [{ id: "default", label: "页面", pageHtml: spec.pageHtml }];
  }
  return [];
}

/**
 * Build the machine-readable design context for a review spec.
 * Pure function: no React, no DOM, input is never mutated.
 *
 * `pages` may be passed explicitly (the resolved PageSpec[] the app renders);
 * otherwise data.pages is used, falling back to a synthetic "default" page
 * when the spec is a single-page ReviewSpec with top-level pageHtml.
 */
export function buildDesignContext(
  data: ReviewData,
  pages?: unknown,
): DesignContextDocument {
  const resolvedPages = resolvePages(data, pages);
  const document: DesignContextDocument = {
    schema: DESIGN_CONTEXT_SCHEMA,
    pages: resolvedPages.map((page) => {
      const entry: DesignContextPage = { id: page.id };
      const label = clip(page.label);
      if (label) entry.label = label;
      if (page.kind) entry.kind = page.kind;
      return entry;
    }),
    tree: buildTree(data),
    anchors: buildAnchors(data, resolvedPages),
    mappings: buildMappings(data),
  };
  if (data.slug) document.slug = data.slug;
  const title = clip(data.title);
  if (title) document.title = title;
  return document;
}
