import type { AppearanceSelection } from "../globalSelection";
import type { ReactNode } from "react";
import type { MappingRow } from "../../types/review";
import { renderRichText } from "./text";
import { columnContent, renderCodePaths } from "./chips";
import {
  renderBullets,
  renderPoints,
  renderPseudoCode,
  renderProductSections,
  renderTechGroups,
} from "./trd";
import { collectApiFields, renderApiFieldStatic, renderApiItems } from "./api";
import { renderCrossSection } from "./cross";
import { renderChangeBlock } from "./change";

export type OverviewColumn = "requirement" | "change" | "api";

/**
 * 列内容富渲染（scoped detail 主体）：
 * - 有 trd 列内容时渲染产品小节 / 技术模块 / API 契约等富结构；
 * - 无 trd 时回退到 requirement / change / api.summary 纯文本字段；
 * - 只渲染该列内容，不挂行级 meta（chips / codePaths / cross）——
 *   行级 meta 由行 header / 行尾 cross / dialog header 各展示一次，
 *   避免同一段摘要、口径、元信息在 header 与正文反复出现。
 * - heading / positioning 在有意义时保留（紧凑排版）。
 * 总览字段不提供点击回调，统一渲染为静态条目。
 */
export function renderOverviewCell(
  row: MappingRow,
  column: OverviewColumn,
  focusSelection?: AppearanceSelection,
  showHeading = true,
): ReactNode {
  if (column === "requirement") {
    const content = columnContent(row, "productDesign");
    return (
      <div className="rich-cell rich-cell-requirement">
        {showHeading && content?.heading && (
          <div className="rich-cell-heading">
            {renderRichText(content.heading)}
          </div>
        )}
        {content?.positioning && (
          <div className="trd-pos-line">
            <em>{renderRichText(content.positioning)}</em>
          </div>
        )}
        {content?.sections && content.sections.length > 0 ? (
          renderProductSections(content.sections)
        ) : (
          <>
            <p>{renderRichText(content?.summary ?? row.requirement)}</p>
            {renderPoints(content)}
          </>
        )}
      </div>
    );
  }

  if (column === "change") {
    const content = columnContent(row, "technical");
    return (
      <div className="rich-cell rich-cell-change">
        {showHeading && content?.heading && (
          <div className="rich-cell-heading">
            {renderRichText(content.heading)}
          </div>
        )}
        {content?.techPoints && content.techPoints.length > 0 ? (
          renderTechGroups(
            content.techPoints,
            content.modules,
            content.codeFlow,
            focusSelection,
          )
        ) : (
          <>
            <p>{renderRichText(content?.summary ?? row.change)}</p>
            {renderBullets(content?.bullets, true)}
            {renderPseudoCode(content)}
          </>
        )}
        {renderChangeBlock(row.changeBlock)}
      </div>
    );
  }

  const content = columnContent(row, "apiChange");
  const { columnFields, rootFields } = collectApiFields(content, row);

  return (
    <div className="rich-cell rich-cell-api">
      {showHeading && content?.heading && (
        <div className="rich-cell-heading">
          {renderRichText(content.heading)}
        </div>
      )}
      {content?.head && (
        <div className="trd-api-head">{renderRichText(content.head)}</div>
      )}
      {content?.items && content.items.length > 0 ? (
        renderApiItems(content.items)
      ) : (
        <>
          {(content?.summary || row.api.summary) && (
            <p>{renderRichText(content?.summary ?? row.api.summary ?? "")}</p>
          )}
          {renderBullets(content?.bullets)}
          {renderPseudoCode(content)}
        </>
      )}
      {columnFields.map((field) => renderApiFieldStatic(field))}
      {rootFields.map((field) => renderApiFieldStatic(field))}
    </div>
  );
}

/**
 * 行级补充信息（codePaths / cross）：只在无法触达行级条目的 surface 渲染一次。
 * 目前用于 overview 级 scoped detail——overview 单元格只有短摘要，
 * 行 header chips / 行尾 cross 在该 surface 不可达，需由详情补齐；
 * component / node 级 surface 自身已有行 header 与行尾 cross，不得再调。
 */
export function renderRowExtras(row: MappingRow): ReactNode {
  if (!row.codePaths?.length && !row.cross) return null;
  return (
    <div className="rich-row-extras">
      {renderCodePaths(row.codePaths)}
      {renderCrossSection(row.cross)}
    </div>
  );
}
