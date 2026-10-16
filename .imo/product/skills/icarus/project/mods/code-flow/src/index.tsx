import React from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import { CodeFlow } from "@david/components/details/CodeFlow";
import { isValidCodeFlow } from "@david/lib/logicGraph";
function View({ data }: ViewProps) {
  return <CodeFlow {...data} />;
}
export default reactMod("code-flow", View, (data) => {
  if (!isValidCodeFlow(data.graph, data.points))
    throw new Error("code-flow requires graph and points");
  return data;
});
