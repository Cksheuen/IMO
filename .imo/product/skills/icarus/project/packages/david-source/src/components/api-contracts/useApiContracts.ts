import { createContext, useContext, useMemo } from "react";
import type { ApiContract, MappingRow } from "../../types/review";

/** Contracts belong to the currently imported ReviewData, never the boot script. */
export const ApiContractsContext = createContext<ApiContract[]>([]);

/**
 * Resolve a mapping row's api.contractIds against the top-level contract
 * table. Order follows contractIds; unknown / duplicate ids are filtered
 * defensively (validation already guarantees well-formed references).
 */
export function resolveContractsByIds(
  contracts: ApiContract[] | undefined,
  contractIds: readonly string[] | undefined,
): ApiContract[] {
  if (
    !contracts ||
    contracts.length === 0 ||
    !contractIds ||
    contractIds.length === 0
  ) {
    return [];
  }
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const seen = new Set<string>();
  const resolved: ApiContract[] = [];
  for (const id of contractIds) {
    if (seen.has(id)) continue;
    const contract = byId.get(id);
    if (contract) {
      seen.add(id);
      resolved.push(contract);
    }
  }
  return resolved;
}

/** Resolve the contracts referenced by one mapping row. */
export function useResolvedContracts(row: MappingRow): ApiContract[] {
  const contracts = useContext(ApiContractsContext);
  const contractIds = row.api?.contractIds;
  return useMemo(
    () => resolveContractsByIds(contracts, contractIds),
    [contracts, contractIds],
  );
}
