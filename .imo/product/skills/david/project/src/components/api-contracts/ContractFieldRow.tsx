import { API_CONTRACT_PROVISION_LABELS } from "../../lib/contractModel";
import type { ApiContractField, ApiField } from "../../types/review";
import {
  previewContractField,
  toggleContractField,
} from "./fieldHighlightChannel";

export type ContractFieldRowProps = {
  field: ApiContractField;
  section: "request" | "response";
  active?: boolean;
  compact?: boolean;
  /** Called after the click highlight/locate side effect ran. */
  onSelect?: (field: ApiField) => void;
};

/**
 * One flat contract field row. The field name is a keyboard-reachable
 * button; hover/focus/click all drive the shared page-highlight channel
 * (fieldHighlightChannel). Token matching is whitespace-split
 * data-api-field, same as api.fields[].target.
 */
export function ContractFieldRow({
  field,
  section,
  active = false,
  compact = false,
  onSelect,
}: ContractFieldRowProps) {
  const classNames = [
    "dv-contract-field",
    field.provision === "missing" ? "dv-contract-field--missing" : "",
    active ? "is-field-active" : "",
    compact ? "dv-contract-field--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classNames}
      data-contract-field={field.name}
      data-contract-provision={field.provision}
      data-contract-section={section}
      aria-pressed={active}
      title={field.meaning}
      onPointerEnter={() => previewContractField(field.name)}
      onPointerLeave={() => previewContractField(null)}
      onFocus={() => previewContractField(field.name)}
      onBlur={() => previewContractField(null)}
      onClick={(event) => {
        // Stop the mapping row / details toggles from reacting, same as
        // the existing api-field buttons.
        event.stopPropagation();
        const outcome = toggleContractField(field.name);
        if (outcome !== "cleared") {
          onSelect?.({
            name: field.name,
            type: field.type,
            meaning: field.meaning,
          });
        }
      }}
    >
      <code className="dv-contract-field-name">
        {field.required && (
          <span
            className="dv-contract-required"
            aria-label="必填字段"
            title="必填字段"
          >
            *
          </span>
        )}
        {field.name}
      </code>
      <span className="dv-contract-field-type">{field.type || "—"}</span>
      <span className="dv-contract-field-meaning">
        {field.provision && (
          <span
            className={`dv-contract-provision dv-contract-provision--${field.provision}`}
          >
            {API_CONTRACT_PROVISION_LABELS[field.provision]}
          </span>
        )}
        {field.meaning || ""}
      </span>
    </button>
  );
}
