import { CompactRef } from "../../components/CompactRef";
import type { CrossSection } from "../../types/review";
import { renderRichText } from "./text";

/**
 * 渲染跨模块工程折叠区 (cross)
 */
export function renderCrossSection(cross?: CrossSection) {
  if (!cross) return null;

  const hasFlow = cross.flow && cross.flow.length > 0;
  const hasCards =
    (cross.state && cross.state.length > 0) ||
    (cross.dataflow && cross.dataflow.length > 0) ||
    (cross.edge && cross.edge.length > 0) ||
    (cross.files && cross.files.length > 0);

  if (!cross.note && !hasFlow && !hasCards) return null;

  return (
    <details className="trd-cross" aria-label="跨模块工程信息">
      <summary>
        跨模块补充信息（口径 · 时序 / 状态 / 数据流 / 异常兜底 / 相关文件）
      </summary>
      <div className="trd-cross-inner">
        {cross.note && (
          <div className="trd-cross-note">
            <b>关键口径</b>：{renderRichText(cross.note)}
          </div>
        )}
        {hasFlow && (
          <div className="trd-cross-flow">
            <h5>时序 / 交互流程</h5>
            <ol className="trd-flow-list">
              {cross.flow!.map((step, idx) => (
                <li key={idx}>{renderRichText(step)}</li>
              ))}
            </ol>
          </div>
        )}
        {hasCards && (
          <div className="trd-cross-grid">
            {cross.state && cross.state.length > 0 && (
              <div className="trd-cross-card">
                <h5>状态管理</h5>
                <ul>
                  {cross.state.map((s, i) => (
                    <li key={i}>{renderRichText(s)}</li>
                  ))}
                </ul>
              </div>
            )}
            {cross.dataflow && cross.dataflow.length > 0 && (
              <div className="trd-cross-card">
                <h5>数据流</h5>
                <ul>
                  {cross.dataflow.map((d, i) => (
                    <li key={i}>{renderRichText(d)}</li>
                  ))}
                </ul>
              </div>
            )}
            {cross.edge && cross.edge.length > 0 && (
              <div className="trd-cross-card">
                <h5>异常态 &amp; 兜底</h5>
                <ul>
                  {cross.edge.map((e, i) => (
                    <li key={i}>{renderRichText(e)}</li>
                  ))}
                </ul>
              </div>
            )}
            {cross.files && cross.files.length > 0 && (
              <div className="trd-cross-card">
                <h5>涉及文件 / 组件</h5>
                <ul>
                  {cross.files.map((f, i) => (
                    <li key={i}>
                      <CompactRef value={f} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
