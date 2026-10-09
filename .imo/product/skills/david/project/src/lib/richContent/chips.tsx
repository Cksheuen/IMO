import { CompactRef } from "../../components/CompactRef";
import type { MappingRow, TrdColumnContent } from "../../types/review";

export const CHANGE_INFO: Record<string, { label: string; className: string }> =
  {
    new: { label: "新增", className: "trd-badge-new" },
    modify: { label: "改造", className: "trd-badge-modify" },
    variant: { label: "复用+新场景", className: "trd-badge-variant" },
    reuse: { label: "复用", className: "trd-badge-reuse" },
    deferred: { label: "暂缓", className: "trd-badge-deferred" },
  };

/**
 * 唯一的 API 展示判据：显式 `api.changed === false` 才隐藏 API 列内容与
 * “查看接口”入口；缺省 / true 保持旧 JSON 兼容（照常展示）。
 * 禁止用“无接口改动”之类文案正则猜测——只认字段。
 */
export function rowApiChanged(row: MappingRow): boolean {
  return row.api?.changed !== false;
}

export const columnContent = (
  row: MappingRow,
  column: "productDesign" | "technical" | "apiChange",
): TrdColumnContent | undefined => row.trd?.[column];

// 与 types/review 的 ReviewBrief 保持结构一致（避免仅类型依赖）
export type ReviewBriefShape = {
  visibleChange?: string;
  trigger?: string;
  d2c?: string;
  status?: string;
  changeType?: string;
};

/**
 * 渲染功能点头部轻量 chips
 */
export function renderBriefChips(brief?: ReviewBriefShape, d2c?: string) {
  const effectiveD2c = brief?.d2c || d2c;
  if (
    !brief?.visibleChange &&
    !brief?.trigger &&
    !effectiveD2c &&
    !brief?.status
  ) {
    return null;
  }

  return (
    <div className="trd-brief-chips" aria-label="功能点摘要标签">
      {brief?.changeType && (
        <span className="trd-bchip trd-bchip-change-type">
          <b>类型</b>
          <span>{brief.changeType}</span>
        </span>
      )}
      {brief?.visibleChange && (
        <span className="trd-bchip trd-bchip-change">
          <b>变化</b>
          <span>{brief.visibleChange}</span>
        </span>
      )}
      {brief?.trigger && (
        <span className="trd-bchip trd-bchip-trigger">
          <b>生效</b>
          <span>{brief.trigger}</span>
        </span>
      )}
      {effectiveD2c && (
        <span className="trd-bchip trd-bchip-d2c">
          <b>D2C</b>
          <span>{effectiveD2c}</span>
        </span>
      )}
      {brief?.status && (
        <span className="trd-bchip trd-bchip-status">
          <b>状态</b>
          <span>{brief.status}</span>
        </span>
      )}
    </div>
  );
}

/**
 * 渲染代码路径引用条：≤2 条内联紧凑展示；更多时默认折叠（按需展开），
 * 展开后完整可读。每条路径走 CompactRef（省略显示 / hover-focus 读全 / 点击复制）。
 */
const CODE_PATHS_INLINE_LIMIT = 2;

export function renderCodePaths(codePaths?: string[]) {
  if (!codePaths?.length) return null;
  const list = (
    <ul className="trd-code-paths-list">
      {codePaths.map((path, index) => (
        <li key={index}>
          <CompactRef value={path} />
        </li>
      ))}
    </ul>
  );
  if (codePaths.length <= CODE_PATHS_INLINE_LIMIT) {
    return (
      <div className="trd-code-paths" title="涉及真实代码路径">
        <span className="trd-code-paths-label">CODE PATHS</span>
        {list}
      </div>
    );
  }
  return (
    <details className="trd-code-paths trd-code-paths-details">
      <summary>
        <span className="trd-code-paths-label">CODE PATHS</span>
        <span className="trd-code-paths-count">{codePaths.length} 个路径</span>
      </summary>
      {list}
    </details>
  );
}
