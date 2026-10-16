import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import {
  SourceResource,
  isValidServiceResource,
  type ServiceResource,
} from "./public";
function View({ data }: ViewProps) {
  return (
    <>
      {data.resources.map((resource: ServiceResource, i: number) => (
        <SourceResource key={resource.id ?? i} resource={resource} />
      ))}
    </>
  );
}
export default reactMod("resource-cards", View, (data) => {
  if (
    !Array.isArray(data.resources) ||
    !data.resources.every(isValidServiceResource)
  )
    throw Error("resource-cards requires valid resources");
  return data;
});
