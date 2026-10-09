import fs from "node:fs";
import {
  auditReviewAuthoring,
  inventoryImplementation,
} from "../src/lib/authoringAudit.ts";
const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: node scripts/audit-review-authoring.mjs <review.json>",
  );
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const findings = auditReviewAuthoring(data);
console.log(
  JSON.stringify(
    {
      file: input,
      count: findings.length,
      findings,
      implementationInventory: inventoryImplementation(data),
    },
    null,
    2,
  ),
);
