import React from "react";
import { RichDocument, isValidRichSections } from "./public";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import {
  renderRichText,
  renderProductSections,
  renderTechGroups,
  renderDeepDive,
} from "@david/lib/richContent/index";
function View({ data }: ViewProps) {
  return (
    <article className="icarus-rich-content">
      {isValidRichSections(data.document) && <RichDocument sections={data.document} />}
      {data.text && <p>{renderRichText(data.text)}</p>}
      {renderProductSections(data.sections)}
      {renderTechGroups(data.points ?? [], data.modules)}
      {data.deepDive && renderDeepDive(data.deepDive)}
    </article>
  );
}
export default reactMod("rich-content", View);
