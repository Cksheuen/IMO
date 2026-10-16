import { CompactRef } from "../../components/CompactRef";
import type { DeepDive } from "../../types/review";
import { renderRichText } from "./text";

const DEEP_DIVE_SECTIONS: Array<{ key: keyof DeepDive; label: string }> = [
  { key: "summary", label: "摘要" },
  { key: "codePaths", label: "代码路径" },
  { key: "logic", label: "实现逻辑" },
  { key: "state", label: "状态管理" },
  { key: "edgeCases", label: "异常与边界" },
  { key: "tests", label: "测试要点" },
];

const DEEP_DIVE_CODE_PATHS_LIMIT = 4;

/**
 * 渲染节点下钻补充信息（空分类不渲染，codePaths 以 code 呈现）
 */
export function renderDeepDive(deepDive: DeepDive) {
  return (
    <div className="david-deep-dive" data-testid="david-deep-dive">
      {DEEP_DIVE_SECTIONS.map(({ key, label }) => {
        const items = deepDive[key];
        if (!items?.length) return null;
        return (
          <section key={key} className={`david-dd-section david-dd-${key}`}>
            <h4>{label}</h4>
            {key === "codePaths" ? (
              items.length > DEEP_DIVE_CODE_PATHS_LIMIT ? (
                <details className="david-dd-code-paths-details">
                  <summary>代码路径（{items.length}，点击展开）</summary>
                  <ul className="david-dd-code-paths">
                    {items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        <CompactRef value={item} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <ul className="david-dd-code-paths">
                  {items.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      <CompactRef value={item} />
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <ul>
                {items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderRichText(item)}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
