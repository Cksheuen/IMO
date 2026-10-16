import { useMemo, type ComponentProps } from "react";
import { LogicCanvas as DavidLogicCanvas } from "@david/components/canvas/LogicCanvas";
import { conciseEdgeLabels } from "./edgeLabels";

/** Reuse David's rendering and gestures, with Icarus edge-label compatibility. */
export function LogicCanvas(props: ComponentProps<typeof DavidLogicCanvas>) {
  const graph = useMemo(() => conciseEdgeLabels(props.graph), [props.graph]);
  return <DavidLogicCanvas {...props} graph={graph} />;
}
