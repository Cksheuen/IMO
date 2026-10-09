import { Collapsible } from "../ui/Collapsible";
import { IconButton } from "../ui/IconButton";
import { ChevronIcon } from "../ui/ChevronIcon";
import { highlightMapping } from "../../lib/mappingHighlight";
import type {
  ApiField,
  MappingRow,
  ReviewComponent,
  ReviewNode,
} from "../../types/review";
import {
  renderBriefChips,
  renderCodePaths,
  renderCrossSection,
  renderDeepDive,
  rowApiChanged,
} from "../../lib/richContent";
import { RowContractPanel } from "../api-contracts";
import { DisclosureCell } from "./DisclosureCell";
import { hasOverviewApiSummary } from "../../lib/disclosureContent";
import {
  isInlineReviewNode,
  resolveLayerMapping,
  resolveNodeMapping,
} from "../../lib/reviewTree";

function nodeForMapping(
  nodes: ReviewNode[],
  rowId: string,
): ReviewNode | undefined {
  for (const candidate of nodes) {
    const child = nodeForMapping(candidate.children ?? [], rowId);
    if (child) return child;
    if (
      candidate.mappingIds?.includes(rowId) ||
      candidate.mapping?.some((row) => row.id === rowId)
    )
      return candidate;
  }
  return undefined;
}

type Props = {
  component: ReviewComponent;
  activeField?: string;
  index: number;
  total: number;
  onFieldClick: (field: ApiField) => void;
  onClose: () => void;
  onSwitch: (index: number) => void;
  node?: ReviewNode;
  mapping?: MappingRow[];
  breadcrumbs?: Array<{
    id?: string;
    label: string;
    kind: "overview" | "component" | "node";
  }>;
  onBreadcrumb?: (id?: string) => void;
  /**
   * 行 hover 联动画板高亮：进入某行时回传该 mapping 的 token
   * （`<componentId>:<rowId>`），离开回传 null。详情态 TRD 行 hover 与
   * overview 表格 hover 走同一套 linked 高亮，避免「行与画板无联动」。
   */
  onRowHover?: (token: string | null) => void;
  onNodeSelect?: (nodeId: string) => void;
  expandedRows?: Record<string, boolean>;
  onRowToggle?: (rowId: string) => void;
};

export function ComponentDetails({
  component,
  index,
  total,
  onFieldClick,
  onClose,
  onSwitch,
  node,
  mapping,
  breadcrumbs,
  onBreadcrumb,
  onRowHover,
  onNodeSelect,
  expandedRows,
  onRowToggle,
}: Props) {
  const effectiveMapping = mapping ?? resolveLayerMapping(component, node);
  const effectiveLabel = node?.label ?? component.label;
  const scopeId = node?.id ?? component.id;
  const backLabel = node ? "返回上一级" : "返回总览";
  // 无接口改动的行不渲染 API 列；全部行都无 API 改动时整表切两列。
  const childNodes = node?.children ?? (node ? [] : (component.children ?? []));
  const inlineChild = (row: MappingRow) => {
    const child = nodeForMapping(childNodes, row.id);
    const childRows = child ? resolveNodeMapping(child, component) : [];
    return Boolean(
      child &&
      childNodes.includes(child) &&
      isInlineReviewNode(child, component) &&
      childRows[0] === row,
    );
  };
  const shallowRow = (row: MappingRow) =>
    Boolean(nodeForMapping(childNodes, row.id)) && !inlineChild(row);
  const showApi = (row: MappingRow) =>
    rowApiChanged(row) && (!shallowRow(row) || hasOverviewApiSummary(row));
  const apiChangedRows = effectiveMapping.filter(showApi);
  const twoCol = apiChangedRows.length === 0;

  return (
    <aside
      className="inspector component-details is-open"
      aria-live="polite"
      aria-label={effectiveLabel}
    >
      <div className="inspector-head">
        <div>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav
              className="david-breadcrumb"
              data-testid="david-breadcrumb"
              aria-label="评审路径"
            >
              {breadcrumbs.map((crumb, crumbIndex) => {
                const isCurrent = crumbIndex === breadcrumbs.length - 1;
                return (
                  <button
                    key={`${crumb.kind}-${crumb.id ?? "overview"}-${crumbIndex}`}
                    type="button"
                    className="david-breadcrumb-item"
                    disabled={isCurrent}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => onBreadcrumb?.(crumb.id)}
                  >
                    {crumb.label}
                  </button>
                );
              })}
            </nav>
          )}
          {!breadcrumbs?.length && <h2>{effectiveLabel}</h2>}
        </div>
        <div className="inspector-actions">
          <button
            type="button"
            className="switch"
            onClick={() => onSwitch(index - 1)}
            disabled={index <= 0}
            aria-label="上一个同级"
            title="上一个同级"
          >
            ‹
          </button>
          <span className="switch-count">{`同级 ${index + 1}/${total}`}</span>
          <button
            type="button"
            className="switch"
            onClick={() => onSwitch(index + 1)}
            disabled={index >= total - 1}
            aria-label="下一个同级"
            title="下一个同级"
          >
            ›
          </button>
          <button
            className="close"
            type="button"
            onClick={onClose}
            aria-label={backLabel}
            title={backLabel}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span aria-hidden="true">←</span>
            <span>{backLabel}</span>
          </button>
        </div>
      </div>
      {node?.deepDive && renderDeepDive(node.deepDive)}
      <div
        className={`mapping trd-table${twoCol ? " trd-table--two-col" : ""}`}
        data-trd-table
        role="table"
        aria-label={twoCol ? "组件 TRD 两列映射" : "组件 TRD 三列映射"}
      >
        <div className="trd-table-head" role="row">
          <div role="columnheader">
            <span className="trd-column-index">01</span>
            <span>产品&amp;设计要点</span>
            <small>为什么做 · 业务诉求</small>
          </div>
          <div role="columnheader">
            <span className="trd-column-index">02</span>
            <span>实现要点</span>
            <small>怎么实现 · 模块架构</small>
          </div>
          {!twoCol && (
            <div role="columnheader">
              <span className="trd-column-index">03</span>
              <span>API 改动</span>
              <small>数据契约 · 字段映射</small>
            </div>
          )}
        </div>
        {effectiveMapping.map((row, rowIndex) => {
          const apiChanged = showApi(row);
          const expanded = expandedRows?.[row.id] ?? rowIndex === 0;
          const rowTitle =
            row.title || row.trd?.productDesign?.heading || row.id;
          const bodyId = `trd-body-${component.id}-${scopeId}-${row.id}`;
          const child = nodeForMapping(childNodes, row.id);
          return (
            <div
              className="mapping-row trd-table-row"
              key={row.id}
              data-trd-row={row.id}
              data-row-expanded={expanded}
              role="row"
              onClick={() => highlightMapping(component.id, row.id)}
              onPointerEnter={() =>
                // token 必须与 render 注入的 data-review-mapping-id 一致：
                // 注入恒为 <componentId>:<rowId>（节点视图也用 component id）。
                onRowHover?.(`${component.id}:${row.id}`)
              }
              onPointerLeave={() => onRowHover?.(null)}
            >
              {/* 功能点头部信息：标题、代码路径、轻量 chips */}
              <div
                className="trd-row-header"
                onClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      "button, a, input, textarea, select, summary",
                    )
                  )
                    onRowToggle?.(row.id);
                }}
              >
                <div className="trd-row-header-main">
                  <button
                    type="button"
                    className="trd-row-toggle"
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    aria-label={`${expanded ? "收起" : "展开"}${rowTitle}`}
                    onClick={() => onRowToggle?.(row.id)}
                  >
                    <ChevronIcon />
                  </button>
                  {/* 单功能点时不渲染序号：只有一条时编号没有信息量，
                      只会在唯一标题前多出一层冗余前缀。 */}
                  {effectiveMapping.length > 1 && (
                    <span className="trd-feature-tag">
                      功能点 {String(rowIndex + 1).padStart(2, "0")}
                    </span>
                  )}
                  <button
                    type="button"
                    className="trd-feature-title"
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={() => onRowToggle?.(row.id)}
                  >
                    {rowTitle}
                  </button>
                  {child && !inlineChild(row) && onNodeSelect && (
                    <span className="trd-row-enter">
                      <IconButton
                        label={`进入${rowTitle}`}
                        onClick={() => onNodeSelect(child.id)}
                      >
                        <ChevronIcon />
                      </IconButton>
                    </span>
                  )}
                </div>
                {expanded && renderCodePaths(row.codePaths)}
                {expanded && renderBriefChips(row.reviewBrief, row.d2c)}
              </div>

              <Collapsible id={bodyId} className="trd-row-body" open={expanded}>
                {/* 三列网格主体 */}
                <div className="trd-cells-grid">
                  {/* 列 1：产品 & 设计要点 */}
                  <article
                    className="map-card trd-cell trd-cell-product"
                    data-review-target={`${scopeId}:${row.id}:requirement`}
                    data-review-label={`${effectiveLabel} · 产品&设计要点 ${rowIndex + 1}`}
                    role="cell"
                  >
                    <DisclosureCell
                      row={row}
                      column="requirement"
                      level={node || inlineChild(row) ? "node" : "component"}
                      componentId={component.id}
                      nodeId={node?.id}
                      onFieldClick={onFieldClick}
                    />
                  </article>

                  {/* 列 2：技术要求 / 伪代码 */}
                  <article
                    className={`map-card trd-cell trd-cell-technical${!apiChanged && !twoCol ? " trd-cell--wide" : ""}`}
                    data-review-target={`${scopeId}:${row.id}:change`}
                    data-review-label={`${effectiveLabel} · 技术要求 ${rowIndex + 1}`}
                    role="cell"
                  >
                    <DisclosureCell
                      row={row}
                      column="change"
                      level={node || inlineChild(row) ? "node" : "component"}
                      componentId={component.id}
                      nodeId={node?.id}
                      onFieldClick={onFieldClick}
                    />
                  </article>

                  {/* 列 3：API 改动（显式 api.changed=false 的行不渲染） */}
                  {apiChanged && (
                    <article
                      className="map-card trd-cell trd-cell-api"
                      data-review-target={`${scopeId}:${row.id}:api`}
                      data-review-label={`${effectiveLabel} · API 改动 ${rowIndex + 1}`}
                      role="cell"
                    >
                      {/* Flat contract panel: persistent at the top of the API
                        column, visible even when the rich code detail dialog
                        is closed. Drives the shared data-api-field highlight
                        channel itself. */}
                      {!shallowRow(row) && (
                        <RowContractPanel row={row} compact />
                      )}
                      <DisclosureCell
                        row={row}
                        column="api"
                        level={
                          shallowRow(row)
                            ? "overview"
                            : node || inlineChild(row)
                              ? "node"
                              : "component"
                        }
                        componentId={component.id}
                        nodeId={node?.id}
                        onFieldClick={onFieldClick}
                      />
                    </article>
                  )}
                </div>

                {/* 行尾折叠补充信息 */}
                {renderCrossSection(row.cross)}
              </Collapsible>
            </div>
          );
        })}
      </div>
      {component.evidence && component.evidence.length > 0 && (
        <details className="evidence">
          <summary>证据依据（{component.evidence.length}）</summary>
          <ul>
            {component.evidence.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
