import type {
  MappingRow,
  PageSpec,
  ReviewComponent,
  ReviewData,
  ReviewInteraction,
  ReviewNode,
  ReviewOverview,
} from "../types/review";

/** 按明确 HTML/scene 归属派生只读页概览，不改动完整 spec。 */
export function reviewForPage(data: ReviewData, page?: PageSpec): ReviewData {
  if (!page) return data;
  const ids = new Set(
    Array.from(
      page.pageHtml.matchAll(/data-component-id\s*=\s*["']([^"']+)["']/g),
      (match) => match[1],
    ),
  );
  page.scene?.components.forEach((item) => {
    if (item.componentId) ids.add(item.componentId);
    else if (data.components.some((component) => component.id === item.id))
      ids.add(item.id);
  });
  const singlePage = (data.pages?.length ?? 1) <= 1;
  if (singlePage && ids.size === 0 && !page.overview) return data;
  const components = data.components.filter((component) =>
    ids.has(component.id),
  );
  const mapping = data.overview?.mapping?.filter((row) => {
    const owners = data.components.filter((component) =>
      component.mapping.some(
        (candidate) =>
          row.id === candidate.id ||
          row.id === `${component.id}:${candidate.id}`,
      ),
    );
    // 单页保留旧的中性行；多页不把无法归属的全局行混入当前页。
    return owners.length === 1 ? ids.has(owners[0].id) : singlePage;
  });
  return {
    ...data,
    components,
    overview: {
      title:
        page.overview?.title ??
        (singlePage ? data.overview?.title : page.label),
      summary:
        page.overview?.summary ?? (singlePage ? data.overview?.summary : ""),
      ...(mapping ? { mapping } : {}),
    },
  };
}

/** 递归节点最大嵌套深度（与 reviewSpec / render-review 的校验保持一致） */
export const MAX_REVIEW_TREE_DEPTH = 8;

export type ResolvedInteraction = Exclude<ReviewInteraction, "auto">;

/**
 * 解析节点交互：interaction 缺省（undefined）视为 auto；
 * auto 始终使用保守的 highlight 预览，即使存在 children；
 * 显式指定的 drilldown / highlight 仍按原值返回。
 * 纯函数，不修改输入。
 */
export function resolveInteraction(
  node: Pick<ReviewNode, "interaction" | "children">,
): ResolvedInteraction {
  if (node.interaction === undefined || node.interaction === "auto") {
    return "highlight";
  }
  return node.interaction;
}

/** 深度优先展开节点树（包含根节点），不修改输入。 */
export function flattenReviewTree(roots: readonly ReviewNode[]): ReviewNode[] {
  const flattened: ReviewNode[] = [];
  const walk = (nodes: readonly ReviewNode[]) => {
    for (const node of nodes) {
      flattened.push(node);
      if (node.children && node.children.length > 0) walk(node.children);
    }
  };
  walk(roots);
  return flattened;
}

/** 构建 id => node 索引（重复 id 以先遍历到的为准）。 */
export function indexReviewTree(
  roots: readonly ReviewNode[],
): Map<string, ReviewNode> {
  const index = new Map<string, ReviewNode>();
  for (const node of flattenReviewTree(roots)) {
    if (!index.has(node.id)) index.set(node.id, node);
  }
  return index;
}

/** 返回从根到目标节点的路径；未命中返回 null。 */
export function findNodePath(
  roots: readonly ReviewNode[],
  id: string,
): ReviewNode[] | null {
  for (const node of roots) {
    if (node.id === id) return [node];
    if (node.children && node.children.length > 0) {
      const subPath = findNodePath(node.children, id);
      if (subPath) return [node, ...subPath];
    }
  }
  return null;
}

/** 面包屑 = 根到当前节点的路径。 */
export function buildBreadcrumb(
  roots: readonly ReviewNode[],
  id: string,
): ReviewNode[] | null {
  return findNodePath(roots, id);
}

/** 按 id 解析当前选中节点；未命中返回 null。 */
export function resolveSelectedNode(
  roots: readonly ReviewNode[],
  selectedId: string | null | undefined,
): ReviewNode | null {
  if (!selectedId) return null;
  return indexReviewTree(roots).get(selectedId) ?? null;
}

/**
 * 解析节点关联的 mapping 行：
 * 1. node.mapping 非空时优先使用；
 * 2. 否则用 mappingIds 过滤 root component 的 mapping；
 * 3. 否则回退到 root component 的整条 mapping。
 */
export function resolveNodeMapping(
  node: ReviewNode,
  root: ReviewComponent,
): MappingRow[] {
  if (node.mapping && node.mapping.length > 0) return node.mapping;
  if (node.mappingIds && node.mappingIds.length > 0) {
    const wanted = new Set(node.mappingIds);
    return root.mapping.filter((row) => wanted.has(row.id));
  }
  return root.mapping;
}

/** Single-row leaves are displayed in their parent's inspector, without a deeper layer. */
export function isInlineReviewNode(
  node: ReviewNode,
  root: ReviewComponent,
): boolean {
  return (
    !node.children?.length &&
    !node.deepDive &&
    !node.canvas &&
    node.interaction !== "drilldown" &&
    resolveNodeMapping(node, root).length === 1
  );
}

/** 当前层只呈现自身与直接子节点的功能；更深的映射留到对应父节点内。 */
export function resolveLayerMapping(
  root: ReviewComponent,
  node?: ReviewNode,
): MappingRow[] {
  const ownRows = node ? resolveNodeMapping(node, root) : root.mapping;
  const children = node?.children ?? (node ? [] : (root.children ?? []));
  if (children.length === 0) return ownRows;
  const rowIds = (item: ReviewNode) => [
    ...(item.mappingIds ?? []),
    ...(item.mapping?.map((row) => row.id) ?? []),
  ];
  const descendantIds = new Set(flattenReviewTree(children).flatMap(rowIds));
  // Explicit direct ownership remains authoritative even when a legacy descendant reuses the row.
  const directRows = children.flatMap((child) =>
    child.mapping?.length
      ? child.mapping
      : root.mapping.filter((row) => child.mappingIds?.includes(row.id)),
  );
  const visible = new Map(
    [...ownRows.filter((row) => !descendantIds.has(row.id)), ...directRows].map(
      (row) => [row.id, row],
    ),
  );
  const seen = new Set<string>();
  return [...root.mapping, ...ownRows, ...directRows].flatMap((row) => {
    if (!visible.has(row.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    return [visible.get(row.id)!];
  });
}

/** 简单过滤：按 label 大小写不敏感匹配，返回命中的节点列表。 */
export function filterReviewTree(
  roots: readonly ReviewNode[],
  query: string,
): ReviewNode[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return flattenReviewTree(roots);
  return flattenReviewTree(roots).filter((node) =>
    node.label.toLowerCase().includes(keyword),
  );
}

/** 把 component 视作只读根节点视图（不拷贝 children/mapping）。 */
export function componentToNode(component: ReviewComponent): ReviewNode {
  return {
    id: component.id,
    label: component.label,
    interaction: component.interaction ?? "auto",
    ...(component.target !== undefined ? { target: component.target } : {}),
    ...(component.children !== undefined
      ? { children: component.children }
      : {}),
    ...(component.deepDive !== undefined
      ? { deepDive: component.deepDive }
      : {}),
  };
}

/** 全部 component 的根节点视图。 */
export function componentRoots(data: ReviewData): ReviewNode[] {
  return data.components.map(componentToNode);
}

/** 聚合 overview：保留显式 mapping；缺省时汇总全部 component mapping。 */
export function resolveOverview(data: ReviewData): ReviewOverview {
  const overview = data.overview ?? {};
  const usedFallbackIds = new Set<string>();
  const fallbackMapping = data.components.flatMap((component) =>
    resolveLayerMapping(component).map((row) => {
      let scopedId = `${component.id}:${row.id}`;
      let duplicateSuffix = 2;
      while (usedFallbackIds.has(scopedId)) {
        scopedId = `${component.id}:${row.id}#${duplicateSuffix}`;
        duplicateSuffix += 1;
      }
      usedFallbackIds.add(scopedId);
      return { ...row, id: scopedId };
    }),
  );

  return {
    title: overview.title ?? data.title,
    summary: overview.summary ?? data.subtitle,
    mapping: overview.mapping ?? fallbackMapping,
  };
}
