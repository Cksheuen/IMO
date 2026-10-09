import type { ApiField, MappingRow } from "../../types/review";
import { useResolvedContracts } from "./useApiContracts";
import { ContractSchemaPanel } from "./ContractSchemaPanel";

export type RowContractPanelProps = {
  row: MappingRow;
  compact?: boolean;
  /**
   * Optional bridge to the existing api.fields click flow. Contract fields
   * already drive the shared page-highlight channel directly; this callback
   * additionally notifies outer surfaces when they want to stay in sync.
   */
  onFieldClick?: (field: ApiField) => void;
};

/**
 * Resolve one mapping row's api.contractIds against the top-level
 * apiContracts table and render the persistent panel. Renders null when
 * the row references no contracts (or the table is absent), so call sites
 * can mount it unconditionally at the top of the API column.
 */
export function RowContractPanel({
  row,
  compact,
  onFieldClick,
}: RowContractPanelProps) {
  const contracts = useResolvedContracts(row);
  if (contracts.length === 0) return null;
  return (
    <ContractSchemaPanel
      contracts={contracts}
      compact={compact}
      onFieldClick={onFieldClick}
    />
  );
}
