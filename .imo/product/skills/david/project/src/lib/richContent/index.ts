/**
 * Shared safe rich rendering for OverviewDetails and ComponentDetails.
 *
 * Split by responsibility:
 * - text.tsx:     safe inline markup (code/b/strong/mark + BE-F badges)
 * - code.tsx:     contract code block delegation
 * - chips.tsx:    row-level meta (brief chips / code paths / api-changed判据)
 * - trd.tsx:      product sections / bullets / tech module groups
 * - api.tsx:      API contract items / field buttons / field collection
 * - cross.tsx:    cross-module disclosure card
 * - deepDive.tsx: node deep-dive sections
 * - change.tsx:   contract-1 change blocks (before/after diff + rationale)
 * - overview.tsx: column cell assembly + row extras
 *
 * 安全约束：
 * - 不使用 dangerouslySetInnerHTML / eval；所有文本按 React 文本节点转义。
 * - 仅允许 <code>/<b>/<strong>/<mark> 白名单标签与 BE-F 契约徽章，
 *   其余内容（包括 <script>、<img onerror> 等）一律按纯文本渲染。
 */
import "../../styles/rich-content.css";

export { renderRichText } from "./text";
export { renderContractCodeBlock } from "./code";
export {
  CHANGE_INFO,
  rowApiChanged,
  columnContent,
  renderBriefChips,
  renderCodePaths,
  type ReviewBriefShape,
} from "./chips";
export {
  renderProductSections,
  renderPoints,
  renderBullets,
  renderPseudoCode,
  groupTechPoints,
  renderTechGroups,
  type ModuleGroup,
} from "./trd";
export {
  renderApiFieldButton,
  omitPresentedApiFields,
  renderApiFieldStatic,
  renderApiItems,
  collectApiFields,
} from "./api";
export { renderCrossSection } from "./cross";
export { renderDeepDive } from "./deepDive";
export { renderChangeBlock } from "./change";
export {
  renderOverviewCell,
  renderRowExtras,
  type OverviewColumn,
} from "./overview";
