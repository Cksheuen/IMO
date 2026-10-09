import { API_CONTRACT_PROVISION_LABELS } from "../../lib/contractModel";
import { useEffect, useState } from "react";
import type {
  ApiContract,
  ApiContractField,
  ApiContractProvision,
  ApiField,
} from "../../types/review";
import { Disclosure } from "../ui/Disclosure";
import { ContractFieldRow } from "./ContractFieldRow";
import {
  CONTRACT_FIELD_PREVIEW_EVENT,
  getStickyContractField,
  type ContractFieldPreviewDetail,
} from "./fieldHighlightChannel";
import "./api-contracts.css";

export type ContractSchemaPanelProps = {
  contracts: ApiContract[];
  /** Dense rendering for narrow API cells. */
  compact?: boolean;
  /** Optional existing-field click bridge (same callback shape as api fields). */
  onFieldClick?: (field: ApiField) => void;
  /** Stable identifier for test hooks. */
  testId?: string;
};

type StatusKind = ApiContract["status"];

const STATUS_LABEL: Record<StatusKind, string> = {
  proposed: "预期契约 · 待后端确认",
  confirmed: "已确认契约",
};

function FieldSection({
  provision,
  label,
  fields,
  section,
  activeField,
  compact,
  onSelect,
}: {
  provision?: ApiContractProvision;
  label: string;
  fields: ApiContractField[];
  section: "request" | "response";
  activeField?: string;
  compact?: boolean;
  onSelect: (field: ApiField) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <section className="dv-contract-section">
      <h5 className="dv-contract-section-title">{label}</h5>
      <div className="dv-contract-field-list">
        {fields.map((field) => (
          <ContractFieldRow
            key={`${section}-${field.name}`}
            field={{ ...field, provision: field.provision ?? provision }}
            section={section}
            compact={compact}
            active={activeField === field.name}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function ContractCard({
  contract,
  compact,
  activeField,
  onSelect,
}: {
  contract: ApiContract;
  compact?: boolean;
  activeField?: string;
  onSelect: (field: ApiField) => void;
}) {
  const status: StatusKind = contract.status;
  const request = contract.request ?? [];
  const response = contract.response ?? [];
  const hasMissing = [...request, ...response].some(
    (field) => (field.provision ?? contract.provision) === "missing",
  );
  return (
    <article
      className={`dv-contract-card dv-contract-card--${status}${
        compact ? " dv-contract-card--compact" : ""
      }`}
      data-contract-id={contract.id}
      data-contract-status={status}
      data-contract-provision={contract.provision}
    >
      <Disclosure
        defaultOpen={false}
        summary={
          <span className="dv-contract-head">
            <span className="dv-contract-head-main">
              <span className="dv-contract-title">
                {contract.title?.trim() ? contract.title : contract.id}
              </span>
              {(contract.method || contract.endpoint) && (
                <span className="dv-contract-endpoint">
                  {contract.method && (
                    <span className="dv-contract-method">
                      {contract.method}
                    </span>
                  )}
                  {contract.endpoint && (
                    <code className="dv-contract-path">
                      {contract.endpoint}
                    </code>
                  )}
                </span>
              )}
            </span>
            {contract.provision && (
              <span
                className={`dv-contract-provision dv-contract-provision--${contract.provision}`}
              >
                {API_CONTRACT_PROVISION_LABELS[contract.provision]}
              </span>
            )}
            <span
              className={`dv-contract-badge dv-contract-badge--${status}`}
              data-contract-badge={status}
            >
              {hasMissing && status === "confirmed"
                ? "含待补字段"
                : STATUS_LABEL[status]}
            </span>
          </span>
        }
      >
        <FieldSection
          provision={contract.provision}
          label="请求字段"
          fields={request}
          section="request"
          activeField={activeField}
          compact={compact}
          onSelect={onSelect}
        />
        <FieldSection
          provision={contract.provision}
          label="响应字段"
          fields={response}
          section="response"
          activeField={activeField}
          compact={compact}
          onSelect={onSelect}
        />
        {contract.notes?.trim() && (
          <details className="dv-contract-notes">
            <summary>迁移备注</summary>
            <p>{contract.notes}</p>
          </details>
        )}
      </Disclosure>
    </article>
  );
}

/**
 * Persistent flat API contract panel. Rendered beside (not inside) the
 * contract code blocks so it stays visible even when the rich code view
 * is collapsed. `contracts` is expected to be already resolved from
 * mapping row api.contractIds; empty input renders nothing at call sites.
 */
export function ContractSchemaPanel({
  contracts,
  compact = false,
  onFieldClick,
  testId = "dv-contract-panel",
}: ContractSchemaPanelProps) {
  // Pinned (click-selected) field is owned by the highlight channel and
  // broadcast on the preview event, so every mounted panel instance
  // (inspector cell and the opened rich-detail dialog) stays in sync.
  // The lazy initializer covers a dialog that mounts after the pin.
  const [activeField, setActiveField] = useState<string | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : (getStickyContractField() ?? undefined),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePreview = (event: Event) => {
      const detail = (event as CustomEvent<ContractFieldPreviewDetail>).detail;
      if (detail) {
        setActiveField(detail.name ?? undefined);
      }
    };
    window.addEventListener(CONTRACT_FIELD_PREVIEW_EVENT, handlePreview);
    return () =>
      window.removeEventListener(CONTRACT_FIELD_PREVIEW_EVENT, handlePreview);
  }, []);

  if (contracts.length === 0) return null;

  const handleSelect = (field: ApiField) => {
    onFieldClick?.(field);
  };

  return (
    <div
      className={`dv-contract-panel${
        compact ? " dv-contract-panel--compact" : ""
      }`}
      data-testid={testId}
    >
      <div className="dv-contract-panel-title">接口契约</div>
      {contracts.map((contract) => (
        <ContractCard
          key={contract.id}
          contract={contract}
          compact={compact}
          activeField={activeField}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
