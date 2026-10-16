import React from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import { CodeBlock } from "./public";
function View({ data }: ViewProps) {
  return <CodeBlock {...data} />;
}
export default reactMod("rich-code", View, (data) => {
  if (typeof data.code !== "string")
    throw new Error("rich-code requires code text");
  return data;
});
