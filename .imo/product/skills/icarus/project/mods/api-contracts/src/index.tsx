import React from "react";
import {
  reactMod,
  type ViewProps,
  type ModContext,
} from "../../../packages/david-shared/src/mod";
import { ContractSchemaPanel } from "@david/components/api-contracts/ContractSchemaPanel";
import {
  installPageFieldBridge,
  clearSelectedField,
} from "@david/components/api-contracts/fieldHighlightChannel";
export * from "@david/components/api-contracts/fieldHighlightChannel";
function View({ data }: ViewProps) {
  return <ContractSchemaPanel contracts={data.contracts} />;
}
const panel = reactMod(
  "api-contracts",
  View,
  (data) => {
    if (!Array.isArray(data.contracts))
      throw new Error("api-contracts requires contracts");
    return data;
  },
  { optionalSlots: true },
);
export default {
  ...panel,
  mount(context: ModContext, options: unknown) {
    const cleanup = installPageFieldBridge();
    context.onCleanup(() => {
      cleanup();
      clearSelectedField();
    });
    return panel.mount(context, options);
  },
};
