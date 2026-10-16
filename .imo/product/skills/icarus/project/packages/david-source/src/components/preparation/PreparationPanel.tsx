import { useContext, useId, useState } from "react";
import type { Preparation } from "../../lib/preparationModel";
import { PreparationContext } from "./preparationContext";
import { usePreparationState } from "./usePreparationState";
import "./PreparationPanel.css";

export function PreparationPanel({
  data,
  compact = false,
}: {
  data: Preparation;
  compact?: boolean;
}) {
  const slug = useContext(PreparationContext);
  const prefix = useId();
  const { values, update } = usePreparationState(
    `david:${slug}:preparation:${data.id}`,
  );
  const [saved, setSaved] = useState(true);
  const write = (id: string, value: string | boolean) =>
    setSaved(update(id, value));
  const checked = data.tasks.filter((task) => values[task.id] === true).length;
  const filled = data.fields.filter((field) =>
    String(values[field.id] ?? field.value ?? "").trim(),
  ).length;
  if (compact)
    return (
      <div className="preparation-summary" data-preparation-id={data.id}>
        <strong>{data.title}</strong>
        <span>
          已勾选 {checked}/{data.tasks.length} · 已填写 {filled}/
          {data.fields.length}
        </span>
      </div>
    );
  return (
    <details
      className="preparation-panel"
      data-preparation-id={data.id}
      open={!compact}
    >
      <summary>
        <strong>{data.title}</strong>
        <span>
          已勾选 {checked}/{data.tasks.length} · 已填写 {filled}/
          {data.fields.length}
        </span>
      </summary>
      <div className="preparation-content">
        {data.tasks.length > 0 && (
          <fieldset>
            <legend>待创建与登记</legend>
            {data.tasks.map((task) => (
              <div className="preparation-task" key={task.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={values[task.id] === true}
                    onChange={(event) => write(task.id, event.target.checked)}
                  />
                  <span>{task.label}</span>
                </label>
                {task.detail && <small>{task.detail}</small>}
              </div>
            ))}
          </fieldset>
        )}
        {data.fields.length > 0 && (
          <fieldset>
            <legend>待填写资料</legend>
            <div className="preparation-fields">
              {data.fields.map((field) => (
                <label key={field.id} htmlFor={`${prefix}-${field.id}`}>
                  <span>
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  <input
                    id={`${prefix}-${field.id}`}
                    type="text"
                    autoComplete="off"
                    maxLength={1000}
                    value={String(values[field.id] ?? field.value ?? "")}
                    placeholder={field.placeholder}
                    onChange={(event) => write(field.id, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <small className="preparation-save-note" role="status">
          {saved
            ? "勾选与填写记录保存在本机浏览器。"
            : "浏览器存储不可用，当前修改仅保留在本次打开的页面。"}
        </small>
      </div>
    </details>
  );
}
