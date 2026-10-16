/**
 * Flat API contract panel components.
 *
 * - ContractSchemaPanel: renders resolved ApiContract cards.
 * - ContractFieldRow:   one field button wired to the shared
 *   data-api-field highlight channel.
 * - RowContractPanel:   mapping-row adapter (api.contractIds resolution).
 */
export { ContractSchemaPanel } from "./ContractSchemaPanel";
export type { ContractSchemaPanelProps } from "./ContractSchemaPanel";
export { ContractFieldRow } from "./ContractFieldRow";
export type { ContractFieldRowProps } from "./ContractFieldRow";
export { RowContractPanel } from "./RowContractPanel";
export type { RowContractPanelProps } from "./RowContractPanel";
export { resolveContractsByIds, useResolvedContracts } from "./useApiContracts";
export {
  CONTRACT_FIELD_PREVIEW_EVENT,
  findContractFieldTargets,
  getStickyContractField,
  locateContractField,
  previewContractField,
  releaseContractFieldHighlight,
  toggleContractField,
  type ContractFieldPreviewDetail,
} from "./fieldHighlightChannel";
