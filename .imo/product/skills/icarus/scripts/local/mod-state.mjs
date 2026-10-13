import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { atomicJSON, readJSON, runtimeRoot, configuration } from "./store.mjs";
export const MOD_STATE_LIMIT = 32 * 1024 * 1024;
function file(document, id, root) {
  configuration(document, root);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id))
    throw Object.assign(new Error("Invalid mod id"), { status: 422 });
  return path.join(root, "mod-data", document, id + ".json");
}
export function readModState(document, id, root = runtimeRoot()) {
  return readJSON(file(document, id, root)) ?? { version: 0, value: null };
}
export function writeModState(document, id, body, root = runtimeRoot()) {
  const current = readModState(document, id, root);
  if (
    !body ||
    Object.keys(body).some((k) => !["expectedVersion", "value"].includes(k)) ||
    !Object.hasOwn(body, "value") ||
    !Number.isSafeInteger(body.expectedVersion)
  )
    throw Object.assign(new Error("Invalid mod state"), { status: 422 });
  if (body.expectedVersion !== current.version)
    throw Object.assign(new Error("Mod state changed; reread before retry"), {
      status: 409,
    });
  if (Buffer.byteLength(JSON.stringify(body.value)) > MOD_STATE_LIMIT)
    throw Object.assign(new Error("Mod data exceeds 32 MB"), { status: 413 });
  if (isDeepStrictEqual(current.value, body.value)) return current;
  const next = { version: current.version + 1, value: body.value };
  atomicJSON(file(document, id, root), next);
  return next;
}
