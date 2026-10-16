import { CodeBlock as DavidCodeBlock } from "@david/components/CodeBlock";
import type { ComponentProps } from "react";
import { codeDefinitionLinks, type CodeDefinitions } from "./definitions";
import { symbolHighlights } from "./symbols";
/** Keep the David renderer, line anchors and annotation behavior intact. */
export function CodeBlock({
  symbols = [],
  highlights = [],
  definitions = {},
  ...props
}: ComponentProps<typeof DavidCodeBlock> & {
  symbols?: string[];
  definitions?: CodeDefinitions;
}) {
  return (
    <DavidCodeBlock
      {...props}
      definitionLinks={
        props.definitionLinks ??
        codeDefinitionLinks(props.code ?? "", symbols, definitions)
      }
      highlights={[...symbolHighlights(symbols), ...highlights]}
    />
  );
}
