import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import { MockCases, validateMockCases } from "./public";
function View({ data }: ViewProps) {
  return <MockCases {...data} />;
}
export default reactMod("mock-cases", View, validateMockCases);
