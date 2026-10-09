import assert from "node:assert/strict";
import fs from "node:fs";
import { parseReviewSpec } from "../src/lib/reviewSpec.ts";

const document = fs.readFileSync(
  new URL("../../references/authoring-data.md", import.meta.url),
  "utf8",
);
const examples = [];
for (const match of document.matchAll(/```json\n([\s\S]*?)\n```/g)) {
  const snippet = JSON.parse(match[1]);
  parseReviewSpec(snippet);
  examples.push(snippet);
}
assert.equal(examples.length, 1, "one complete authoring-data example");
const example = examples[0];
assert.ok(example.apiContracts.length > 0);
for (const contract of example.apiContracts) {
  assert.equal(contract.status, "proposed");
  assert.equal(contract.endpoint, undefined, "unknown endpoint is omitted");
  assert.equal(contract.request, undefined, "unknown request is omitted");
}

const fixtureName = "open-questions-contracts.example.review.json";
assert.ok(document.includes(`../examples/${fixtureName}`));
const fixture = JSON.parse(
  fs.readFileSync(
    new URL(`../../examples/${fixtureName}`, import.meta.url),
    "utf8",
  ),
);
parseReviewSpec(fixture);
assert.ok(fixture.openQuestions.length > 0);
const fragment = { openQuestions: fixture.openQuestions };
assert.throws(() => parseReviewSpec(fragment), /title/);
parseReviewSpec({ ...example, ...fragment });

console.log(
  "authoring examples: complete contract example, linked questions fixture and merged fragment pass; unknown protocol fields omitted",
);
