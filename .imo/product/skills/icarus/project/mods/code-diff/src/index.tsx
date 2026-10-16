import React from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import {
  DiffCodeBlock,
  ChangeRationale,
} from "@david/components/change-block/index";
import { assertChangeBlock } from "@david/lib/changeModel";
function View({ data }: ViewProps) {
  return (
    <section>
      <ChangeRationale block={data} />
      <DiffCodeBlock {...data} />
    </section>
  );
}
export default reactMod("code-diff", View, (data) => {
  assertChangeBlock(data, "code-diff");
  return data;
});
