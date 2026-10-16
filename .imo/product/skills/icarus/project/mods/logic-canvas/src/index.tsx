import React, { useState } from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import { isValidLogicGraph } from "./public";
import { LogicCanvas, FoldableLogicCanvas } from "./public";
function View({ data }: ViewProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const Canvas = data.foldable ? FoldableLogicCanvas : LogicCanvas;
  return (
    <Canvas
      graph={data.graph}
      label={data.label}
      nodeBadges={data.nodeBadges}
      selectedNodeIds={selected}
      selectableNodeIds={data.graph.nodes.map((x: any) => x.id)}
      onSelectNode={(id) =>
        setSelected((s) =>
          s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
        )
      }
    />
  );
}
export default reactMod("logic-canvas", View, (data) => {
  if (!isValidLogicGraph(data.graph))
    throw new Error("logic-canvas requires graph nodes/edges");
  return data;
});
