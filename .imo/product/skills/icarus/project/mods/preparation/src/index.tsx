import React from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import { PreparationPanel } from "@david/components/preparation/PreparationPanel";
import { PreparationContext } from "@david/components/preparation/preparationContext";
import { assertPreparation } from "@david/lib/preparationModel";
function View({ data, context }: ViewProps) {
  return (
    <PreparationContext value={context.documentId}>
      <PreparationPanel data={data} />
    </PreparationContext>
  );
}
export default reactMod("preparation", View, (data) => {
  assertPreparation(data, "preparation");
  return data;
});
