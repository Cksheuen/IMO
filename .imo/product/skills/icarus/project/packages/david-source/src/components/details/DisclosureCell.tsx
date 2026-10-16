import {
  renderProductSections,
  renderPoints,
  renderBullets,
  renderTechGroups,
} from "../../lib/richContent";
import {
  shouldInlineDisclosure,
  legacySummary,
  normalizeDetailText,
} from "../../lib/disclosureContent";
import { PreparationPanel } from "../preparation/PreparationPanel";
import { highlightMapping } from "../../lib/mappingHighlight";
import { useState } from "react";
import "../../styles/detail-disclosure.css";
import { renderRichText, rowApiChanged } from "../../lib/richContent";
import {
  columnContent,
  getDisclosureSummary,
  hasDisclosureDetail,
  hasOverviewApiSummary,
  type DisclosureColumn,
} from "../../lib/disclosureContent";
import type { ApiField, MappingRow, TechBullet } from "../../types/review";
import { RichDetailDialog } from "./RichDetailDialog";
import { closeOpenRichDetails } from "../../lib/richDetailEvents";

export type { DisclosureColumn } from "../../lib/disclosureContent";
export type DisclosureLevel = "overview" | "component" | "node";

export type DisclosureCellProps = {
  row: MappingRow;
  column: DisclosureColumn;
  level: DisclosureLevel;
  componentId?: string;
  nodeId?: string;
  onFieldClick?: (field: ApiField) => void;
};

const COLUMN_HEADING: Record<DisclosureColumn, string> = {
  requirement: "需求说明",
  change: "实现方案",
  api: "接口变更",
};

const COLUMN_OPEN_LABEL: Record<DisclosureColumn, string> = {
  requirement: "查看设计",
  change: "查看实现",
  api: "查看接口",
};

function take<T>(items: T[] | undefined, max: number) {
  const list = items ?? [];
  return { shown: list.slice(0, max), total: list.length };
}

function renderTechBullet(bullet: TechBullet, index: number) {
  const text = typeof bullet === "string" ? bullet : bullet.text;
  const subs = typeof bullet === "string" ? undefined : bullet.sub;
  return (
    <li key={index} className="disclosure-bullet">
      <span className="disclosure-bullet-text">{renderRichText(text)}</span>
      {subs && subs.length > 0 && (
        <ol className="disclosure-bullet-subs">
          {subs.map((sub, subIdx) => (
            <li key={subIdx}>{sub}</li>
          ))}
        </ol>
      )}
    </li>
  );
}

function ComponentExtras({
  row,
  column,
}: {
  row: MappingRow;
  column: DisclosureColumn;
}) {
  const content = columnContent(row, column);
  const bullets = take(content?.bullets, 3);
  const modules = take(content?.modules, 3);
  const items = content?.items ?? [];
  const fields = content?.fields ?? [];
  const hasAny =
    bullets.total > 0 ||
    modules.total > 0 ||
    items.length > 0 ||
    fields.length > 0 ||
    Boolean(content?.positioning);
  if (!hasAny) return null;
  return (
    <div className="disclosure-extras">
      {content?.positioning && (
        <p className="disclosure-note">{content.positioning}</p>
      )}
      {bullets.total > 0 && (
        <div className="disclosure-group">
          <div className="disclosure-group-title">
            关键职责
            {bullets.total > bullets.shown.length
              ? `（共 ${bullets.total} 条）`
              : ""}
          </div>
          <ol className="disclosure-bullets">
            {bullets.shown.map((bullet, idx) => renderTechBullet(bullet, idx))}
          </ol>
        </div>
      )}
      {modules.total > 0 && (
        <div className="disclosure-group">
          <span className="disclosure-group-title">
            技术模块（{modules.total}）：
          </span>
          <span className="disclosure-inline-list">
            {modules.shown.map((module) => module.name).join("、")}
            {modules.total > modules.shown.length ? " 等" : ""}
          </span>
        </div>
      )}
      {column === "api" && (items.length > 0 || fields.length > 0) && (
        <div className="disclosure-group">
          <span className="disclosure-group-title">契约：</span>
          <span className="disclosure-inline-list">
            {items.length > 0 ? `${items.length} 个改动条目` : ""}
            {items.length > 0 && fields.length > 0 ? "，" : ""}
            {fields.length > 0 ? `${fields.length} 个字段` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function NodeExtras({
  row,
  column,
  onOpenPoint,
}: {
  row: MappingRow;
  column: DisclosureColumn;
  onOpenPoint: (index: number) => void;
}) {
  const content = columnContent(row, column);
  const techPoints = take(content?.techPoints, 3);
  const hasAny = techPoints.total > 0;
  if (!hasAny) return null;
  return (
    <div className="disclosure-extras disclosure-extras-node">
      {techPoints.total > 0 && (
        <div className="disclosure-group">
          <div className="disclosure-group-title">
            逻辑要点（共 {techPoints.total} 节）
          </div>
          <ol className="disclosure-bullets">
            {techPoints.shown.map((point, idx) => (
              <li key={idx} className="disclosure-bullet">
                <button
                  type="button"
                  className="disclosure-tech-point"
                  data-tech-point-index={idx}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPoint(idx);
                  }}
                >
                  {point.title ?? point.moduleName ?? `要点 ${idx + 1}`}
                  {point.preview && <span>查看交互</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function DisclosureCell({
  row,
  column,
  level,
  componentId,
  nodeId,
  onFieldClick,
}: DisclosureCellProps) {
  const [open, setOpen] = useState(false);
  const [techPointIndex, setTechPointIndex] = useState<number | undefined>();
  // 无接口改动（显式 api.changed=false）：整列不展示，也不提供“查看接口”入口。
  // 判据唯一来自 rowApiChanged，缺省/true 保持旧 JSON 兼容。
  if (column === "api" && !rowApiChanged(row)) {
    return null;
  }
  if (column === "api" && level === "overview" && !hasOverviewApiSummary(row))
    return null;
  const content = columnContent(row, column);
  const heading = content?.heading ?? COLUMN_HEADING[column];
  const summary = getDisclosureSummary(row, column, level);
  const inline = shouldInlineDisclosure(row, column, level);
  const hasDetail = hasDisclosureDetail(row, column, level);
  // A row may be fully expressed by its adjacent contract panel.
  if (column === "api" && !summary.trim() && !hasDetail) return null;
  const displaySummary = inline
    ? (content?.summary ?? legacySummary(row, column))
    : summary;
  const summaryCoveredInline =
    inline &&
    Boolean(displaySummary) &&
    [
      content?.positioning,
      ...(content?.points ?? []).map((point) => point.text),
      ...(content?.sections ?? []).flatMap((section) =>
        (section.items ?? []).map((item) => item.text),
      ),
      ...(content?.bullets ?? []).map((bullet) =>
        typeof bullet === "string" ? bullet : bullet.text,
      ),
    ].some(
      (text) =>
        text &&
        normalizeDetailText(text) === normalizeDetailText(displaySummary),
    );
  const depthHints: string[] = [];
  if (content?.sections?.length)
    depthHints.push(`${content.sections.length} 个小节`);
  if (content?.bullets?.length)
    depthHints.push(`${content.bullets.length} 条要点`);
  if (content?.techPoints?.length)
    depthHints.push(`${content.techPoints.length} 个逻辑要点`);
  if (content?.items?.length)
    depthHints.push(`${content.items.length} 个契约条目`);
  if (row.cross?.flow?.length)
    depthHints.push(`${row.cross.flow.length} 步流程`);

  return (
    <div
      className="disclosure-cell"
      data-disclosure-column={column}
      data-disclosure-level={level}
    >
      <div className="disclosure-head">
        <h4 className="disclosure-heading">{heading}</h4>
      </div>
      {column === "change" && row.preparation && (
        <PreparationPanel
          data={row.preparation}
          compact={level === "overview"}
        />
      )}
      {displaySummary && !summaryCoveredInline && (
        <p className="disclosure-summary">{renderRichText(displaySummary)}</p>
      )}
      {inline && (
        <div className="disclosure-inline-content">
          {content?.positioning && (
            <p className="disclosure-note">
              {renderRichText(content.positioning)}
            </p>
          )}
          {renderProductSections(content?.sections)}
          {renderPoints(content)}
          {renderBullets(content?.bullets, true)}
          {content?.techPoints &&
            renderTechGroups(content.techPoints, content.modules)}
        </div>
      )}
      {!inline && level !== "overview" && (
        <ComponentExtras row={row} column={column} />
      )}
      {!inline && level !== "overview" && column === "change" && (
        <NodeExtras
          row={row}
          column={column}
          onOpenPoint={(index) => {
            closeOpenRichDetails();
            if (componentId) highlightMapping(componentId, row.id);
            setTechPointIndex(index);
            setOpen(true);
          }}
        />
      )}
      {hasDetail && !inline && (
        <div className="disclosure-foot">
          <button
            type="button"
            className="disclosure-open"
            onClick={(event) => {
              event.stopPropagation();
              closeOpenRichDetails();
              if (componentId) highlightMapping(componentId, row.id);
              setTechPointIndex(undefined);
              setOpen(true);
            }}
          >
            {COLUMN_OPEN_LABEL[column]}
          </button>
          {level !== "overview" && depthHints.length > 0 && (
            <span className="disclosure-depth">
              详情含 {depthHints.join("、")}
            </span>
          )}
        </div>
      )}
      {open && hasDetail && !inline && (
        <RichDetailDialog
          row={row}
          column={column}
          level={level}
          componentId={componentId}
          nodeId={nodeId}
          techPointIndex={techPointIndex}
          onClose={() => setOpen(false)}
          onFieldClick={onFieldClick}
        />
      )}
    </div>
  );
}
