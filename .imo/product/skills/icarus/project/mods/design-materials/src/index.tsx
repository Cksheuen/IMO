import React, { useState } from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import { ReviewMaterialsPanel } from "@david/components/materials/ReviewMaterialsPanel";
function View({ data, context }: ViewProps) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button onClick={() => setOpen(true)}>设计资料</button>
      <ReviewMaterialsPanel
        open={open}
        onClose={() => setOpen(false)}
        slug={context.documentId}
        pages={data.pages ?? []}
        activePageId={data.activePageId ?? ""}
        serviceBaseUrl={context.david?.baseUrl}
      />
    </section>
  );
}
export default reactMod("design-materials", View);
