import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root: projectRoot,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
try {
  const mod = await server.ssrLoadModule("/src/lib/davidFeedback.ts");
  const keys = [
    "parseFeedback",
    "createFeedbackDocument",
    "mergeFeedbackDocuments",
    "setFeedbackEntryStatus",
    "setFeedbackEntryDecision",
    "setFeedbackEntrySuggestion",
    "buildFeedbackIndex",
    "DAVID_FEEDBACK_SCHEMA",
  ];
  console.log("exports:", keys.map((k) => `${k}=${typeof mod[k]}`).join(", "));
  const doc = mod.createFeedbackDocument("probe");
  const parsed = mod.parseFeedback(doc);
  const idx = mod.buildFeedbackIndex([parsed]);
  console.log(
    "roundtrip slug:",
    parsed.slug,
    "schema:",
    parsed.schema,
    "index:",
    idx.schema,
  );
  const mod2 = await server.ssrLoadModule("/src/lib/davidFeedback.ts");
  console.log("same module instance:", mod2 === mod);
} finally {
  await server.close();
}
console.log("vite closed");
