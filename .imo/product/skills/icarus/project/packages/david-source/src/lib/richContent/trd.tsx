import { CodeFlow } from "../../components/details/CodeFlow";
import { GraphPresentation } from "../../components/details/GraphPresentation";
import type { AppearanceSelection } from "../globalSelection";
import { LogicCanvas } from "../../components/canvas/LogicCanvas";
import { CodeBlock } from "../../components/CodeBlock";
import type {
  ProductSection,
  LogicGraph,
  TechBullet,
  TechModule,
  TechPoint,
  TrdColumnContent,
} from "../../types/review";
import { renderRichText } from "./text";
import { CHANGE_INFO } from "./chips";
import { renderChangeBlock } from "./change";

/**
 * 渲染文档式产品小节 (sections)
 */
export function renderProductSections(sections?: ProductSection[]) {
  if (!sections?.length) return null;
  return (
    <ol className="trd-sections-list">
      {sections.map((section, sIndex) => (
        <li
          key={`${section.title ?? "section"}-${sIndex}`}
          className="trd-section-item"
        >
          <div className="trd-section-head">
            <strong className="trd-section-title">{section.title}</strong>
            {section.moduleId && (
              <span
                className="trd-mod-pill"
                title={`关联模块 ${section.moduleId}`}
              >
                {section.moduleId}
              </span>
            )}
          </div>
          {section.items && section.items.length > 0 && (
            <ul className="trd-section-subitems">
              {section.items.map((item, itIndex) => (
                <li key={`${item.label ?? "item"}-${itIndex}`}>
                  {item.label && (
                    <span className="trd-item-label">【{item.label}】</span>
                  )}
                  <span className="trd-item-text">
                    {renderRichText(item.text)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * 渲染兼容性 points
 */
export const renderPoints = (content?: TrdColumnContent) => {
  if (!content?.points?.length) return null;
  return (
    <ul className="trd-points">
      {content.points.map((point, index) => (
        <li key={`${point.label ?? "point"}-${index}`}>
          {point.label && <strong>{point.label}</strong>}
          {point.label && "："}
          <span>{renderRichText(point.text)}</span>
        </li>
      ))}
    </ul>
  );
};

/**
 * 渲染嵌套 bullets
 */
export const renderBullets = (bullets?: TechBullet[], ordered = false) => {
  if (!bullets?.length) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <List className={`trd-circ${ordered ? " trd-circ--ordered" : ""}`}>
      {bullets.map((bullet, index) => {
        if (typeof bullet === "string") {
          return <li key={index}>{renderRichText(bullet)}</li>;
        }
        return (
          <li key={index}>
            {renderRichText(bullet.text)}
            {bullet.sub && bullet.sub.length > 0 && (
              <ol className="trd-sub-list">
                {bullet.sub.map((subItem, sIdx) => (
                  <li key={sIdx}>{renderRichText(subItem)}</li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </List>
  );
};

/**
 * 渲染伪代码
 */
export const renderPseudoCode = (content?: TrdColumnContent) => {
  if (!content?.pseudoCode) return null;
  return (
    <CodeBlock
      code={content.pseudoCode}
      codeLabel={content.codeLabel || "伪代码"}
    />
  );
};

export type ModuleGroup = {
  moduleId?: string;
  moduleName?: string;
  moduleChange?: string;
  entries: TechPoint[];
};

export function groupTechPoints(
  techPoints: TechPoint[],
  modules?: TechModule[],
): ModuleGroup[] {
  const moduleMap = new Map<string, TechModule>();
  for (const m of modules || []) {
    moduleMap.set(m.id, m);
  }

  const groups: ModuleGroup[] = [];
  for (const tp of techPoints) {
    const mid = tp.moduleId;
    const mod = mid ? moduleMap.get(mid) : undefined;
    const moduleName = mod?.name || tp.moduleName;
    const moduleChange = mod?.change || tp.moduleChange;

    const last = groups[groups.length - 1];
    if (last && mid && last.moduleId === mid) {
      last.entries.push(tp);
    } else {
      groups.push({
        moduleId: mid,
        moduleName,
        moduleChange,
        entries: [tp],
      });
    }
  }
  return groups;
}

/**
 * 渲染技术模块分组
 */
export function renderTechGroups(
  techPoints: TechPoint[],
  modules?: TechModule[],
  codeFlow?: LogicGraph,
  focusSelection?: AppearanceSelection,
) {
  if (codeFlow)
    return (
      <CodeFlow
        key={codeFlow.nodes.map((n) => n.id).join(":")}
        graph={codeFlow}
        points={techPoints}
        modules={modules}
        focusSelection={focusSelection}
      />
    );
  const groups = groupTechPoints(techPoints, modules);

  return (
    <div className="trd-module-groups">
      {groups.map((group, gIdx) => {
        const changeTag = group.moduleChange
          ? CHANGE_INFO[group.moduleChange]
          : undefined;
        const multiSub = group.entries.length >= 2;

        return (
          <div
            key={`group-${group.moduleId ?? "neutral"}-${gIdx}`}
            className="trd-mg"
            data-module-id={group.moduleId}
          >
            {(group.moduleId || group.moduleName) && (
              <div className="trd-mg-head">
                {group.moduleId && (
                  <span className="trd-mid">{group.moduleId}</span>
                )}
                <span className="trd-mname">
                  {group.moduleName || "技术模块"}
                </span>
                {changeTag && (
                  <span className={`trd-badge ${changeTag.className}`}>
                    {changeTag.label}
                  </span>
                )}
              </div>
            )}
            <div className="trd-mg-body">
              {group.entries.map((tp, eIdx) => {
                const letter = multiSub
                  ? `${String.fromCharCode(97 + eIdx)}. `
                  : "";
                const graphOnly =
                  tp.graph &&
                  !tp.bullets?.length &&
                  !tp.pseudoCode &&
                  !tp.changeBlock;
                if (graphOnly)
                  return (
                    <GraphPresentation key={`sub-${eIdx}`}>
                      <div
                        className="trd-sub-entry"
                        data-review-target={
                          tp.id ? `tech-point:${tp.id}` : undefined
                        }
                      >
                        {tp.title && (
                          <h4 className="trd-sub-title">
                            {letter}
                            {renderRichText(tp.title)}
                          </h4>
                        )}
                        <LogicCanvas graph={tp.graph!} label={tp.title} />
                      </div>
                    </GraphPresentation>
                  );
                return (
                  <div
                    key={`sub-${eIdx}`}
                    className="trd-sub-entry"
                    data-review-target={
                      tp.id ? `tech-point:${tp.id}` : undefined
                    }
                  >
                    {tp.title && (
                      <h4 className="trd-sub-title">
                        {letter}
                        {renderRichText(tp.title)}
                      </h4>
                    )}
                    {tp.bullets && renderBullets(tp.bullets, true)}
                    {tp.graph && (
                      <GraphPresentation
                        title={tp.title ? renderRichText(tp.title) : undefined}
                        target={tp.id ? `logic-graph:${tp.id}` : undefined}
                      >
                        <LogicCanvas graph={tp.graph} label={tp.title} />
                      </GraphPresentation>
                    )}
                    {tp.pseudoCode && (
                      <CodeBlock
                        code={tp.pseudoCode}
                        codeLabel={tp.codeLabel || "实现逻辑"}
                        annotations={tp.codeAnnotations}
                      />
                    )}
                    {renderChangeBlock(tp.changeBlock)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
