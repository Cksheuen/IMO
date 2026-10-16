import type {
  ApiChangeItem,
  ApiField,
  MappingRow,
  TrdColumnContent,
} from "../../types/review";
import { renderRichText } from "./text";
import { renderContractCodeBlock } from "./code";

/**
 * 渲染单个字段按钮（保持原有点击与高亮行为）
 */
export function renderApiFieldButton(
  field: ApiField,
  activeField: string | undefined,
  onFieldClick: (field: ApiField) => void,
) {
  return (
    <button
      type="button"
      className={`api-field ${activeField === field.name ? "is-field-active" : ""}`}
      key={field.name}
      onClick={(event) => {
        event.stopPropagation();
        onFieldClick(field);
      }}
    >
      <code>{field.name}</code>
      <span>
        {field.type || ""} {field.meaning ? `· ${field.meaning}` : ""}
      </span>
      {!field.target && <span>仅契约证据 · 当前页无独立视觉节点</span>}
    </button>
  );
}

/**
 * 渲染静态字段条目（总览等无字段点击回调的场景）
 */
export function renderApiFieldStatic(field: ApiField) {
  return (
    <div className="api-field is-static" key={field.name}>
      <code>{field.name}</code>
      <span>
        {field.type || ""} {field.meaning ? `· ${field.meaning}` : ""}
      </span>
      {!field.target && <span>仅契约证据 · 当前页无独立视觉节点</span>}
    </div>
  );
}

/**
 * 渲染 API 条目列表（包含契约代码块与变更高亮）。
 * 传入 onFieldClick 时字段渲染为可点击按钮，否则渲染为静态条目。
 */
export function renderApiItems(
  items: ApiChangeItem[],
  activeField?: string,
  onFieldClick?: (field: ApiField) => void,
) {
  return (
    <ol className="trd-api-items">
      {items.map((item, itIdx) => (
        <li key={`api-item-${itIdx}`} className="trd-api-item">
          {(item.title || item.beId) && (
            <div className="trd-api-item-title">
              {item.title && <strong>{renderRichText(item.title)}</strong>}
              {item.beId && <span className="trd-be-badge">{item.beId}</span>}
            </div>
          )}
          {item.code &&
            renderContractCodeBlock(
              item.code,
              item.codeLabel || "契约代码",
              item.codeAnnotations,
            )}
          {item.bullets && item.bullets.length > 0 && (
            <ul className="trd-api-bullets">
              {item.bullets.map((b, bIdx) => (
                <li key={bIdx}>{renderRichText(b)}</li>
              ))}
            </ul>
          )}
          {item.fields && item.fields.length > 0 && (
            <div className="trd-item-fields">
              {item.fields.map((f) =>
                onFieldClick
                  ? renderApiFieldButton(f, activeField, onFieldClick)
                  : renderApiFieldStatic(f),
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * 收集 API 列需要渲染的字段：
 * - trd.apiChange.fields（列级字段，此前被忽略）与 row.api.fields（根级回退）
 *   都会被渲染；
 * - 两者都与 items 内已渲染的字段去重，且彼此去重，避免同一字段重复出现。
 * 总览（静态条目）与 ComponentDetails（可点击按钮）共用同一契约。
 */
export function collectApiFields(
  content: TrdColumnContent | undefined,
  row: MappingRow,
): { columnFields: ApiField[]; rootFields: ApiField[] } {
  const itemFieldNames = new Set(
    content?.items?.flatMap((it) => it.fields?.map((f) => f.name) ?? []) ?? [],
  );
  const columnFields = (content?.fields ?? []).filter(
    (field) => !itemFieldNames.has(field.name),
  );
  const columnFieldNames = new Set(columnFields.map((field) => field.name));
  const rootFields = (row.api.fields ?? []).filter(
    (field) =>
      !itemFieldNames.has(field.name) && !columnFieldNames.has(field.name),
  );
  return { columnFields, rootFields };
}

/** 只去掉已展示且名称、类型、含义完全一致的字段；不同契约证据必须保留。 */
export function omitPresentedApiFields(
  row: MappingRow,
  presented: readonly Pick<ApiField, "name" | "type" | "meaning">[],
): MappingRow {
  if (presented.length === 0) return row;
  const matches = (field: ApiField) =>
    presented.some(
      (shown) =>
        shown.name === field.name &&
        (shown.type ?? "") === (field.type ?? "") &&
        (shown.meaning ?? "") === (field.meaning ?? ""),
    );
  const content = row.trd?.apiChange;
  return {
    ...row,
    api: {
      ...row.api,
      fields: row.api.fields?.filter((field) => !matches(field)),
    },
    ...(content
      ? {
          trd: {
            ...row.trd,
            apiChange: {
              ...content,
              fields: content.fields?.filter((field) => !matches(field)),
              items: content.items?.flatMap((item) => {
                const fields = item.fields?.filter((field) => !matches(field));
                if (
                  item.fields?.length &&
                  !fields?.length &&
                  !item.code &&
                  !item.bullets?.length
                )
                  return [];
                return [{ ...item, fields }];
              }),
            },
          },
        }
      : {}),
  };
}
