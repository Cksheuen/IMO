import { useState } from "react";
import { CodeBlock } from "../../rich-code/src/public";
import "./mock-cases.css";
export type MockCase = {
  id: string;
  label: string;
  note: string;
  payload: unknown;
  previewHtml?: string;
};
export type MockCasesData = {
  id: string;
  cases?: MockCase[];
  collapsible?: boolean;
};
export function MockCases({ id, cases, collapsible = false }: MockCasesData) {
  const [selected, setSelected] = useState(cases?.[0]?.id);
  const active = cases?.find((item) => item.id === selected) ?? cases?.[0];
  if (!active) return null;
  const section = (
    <section
      className="icarus-mock-cases research-mock"
      data-review-target={`mock:${id}`}
      data-review-label="具体 Mock 数据"
    >
      <h3>具体 Mock</h3>
      <label>
        选择验证场景{" "}
        <select
          aria-label="Mock 场景"
          value={active.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {cases?.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p>{active.note}</p>
      {active.previewHtml && (
        <div
          className="icarus-mock-preview research-mock-preview"
          data-testid="mock-preview"
          dangerouslySetInnerHTML={{ __html: active.previewHtml }}
        />
      )}
      <CodeBlock
        code={JSON.stringify(active.payload, null, 2)}
        codeLabel="JSON · 本地 Mock"
      />
    </section>
  );
  return collapsible ? (
    <details className="icarus-mock-example">
      <summary>Example / Mock 场景</summary>
      {section}
    </details>
  ) : (
    section
  );
}

export function validateMockCases(data: any): MockCasesData {
  if (
    !data ||
    typeof data.id !== "string" ||
    !data.id.trim() ||
    !Array.isArray(data.cases) ||
    !data.cases.length ||
    data.cases.some(
      (c: any) =>
        !c ||
        ![c.id, c.label, c.note].every(
          (v) => typeof v === "string" && v.trim(),
        ) ||
        !("payload" in c) ||
        (c.previewHtml !== undefined && typeof c.previewHtml !== "string"),
    )
  )
    throw new Error(
      "mock-cases requires id and unique cases with label, note and payload",
    );
  if (new Set(data.cases.map((c: any) => c.id)).size !== data.cases.length)
    throw new Error("Duplicate mock case id");
  return data;
}
