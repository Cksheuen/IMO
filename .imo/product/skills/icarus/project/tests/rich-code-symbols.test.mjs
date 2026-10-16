import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './mods/rich-code/src/symbols'; export * from './mods/rich-code/src/definitions'; export * from '@david/lib/codeHighlights';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@david": path.resolve("packages/david-source/src") },
});
const {
  codeDefinitionLinks,
  symbolHighlights,
  isValidCodeSymbols,
  highlightCode,
  isValidCodeHighlights,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].text).toString("base64")
);
test("complete identifiers share a deterministic palette without changing code text", () => {
  const names = [
    "Input",
    "Output",
    "SelectionABResult",
    "PromptCandidates",
    "PromptCandidate",
  ];
  const rules = symbolHighlights(names);
  assert.ok(isValidCodeHighlights(rules));
  assert.notEqual(rules[0].tone, rules[1].tone);
  assert.equal(new Set(rules.map((r) => r.tone)).size, names.length);
  const code =
    "Input InputConfig _Input 参数Input model.Input Output\nSelectionABResult PromptCandidates []model.PromptCandidate Input";
  const parts = highlightCode(code, rules);
  assert.equal(parts.map((p) => p.text).join(""), code);
  assert.deepEqual(
    parts.filter((p) => p.rule).map((p) => p.text),
    [
      "Input",
      "Input",
      "Output",
      "SelectionABResult",
      "PromptCandidates",
      "PromptCandidate",
      "Input",
    ],
  );
  assert.equal(
    parts
      .filter((p) => p.text === "Input")
      .every((p) => p.rule.tone === rules[0].tone),
    true,
  );
  assert.deepEqual(
    symbolHighlights([...names, "Added"]).slice(0, names.length),
    rules,
  );
  assert.ok(rules.every((r) => r.legend === false));
});
test("rejects regex syntax, duplicate names and invalid declarations; literal matching stays compatible", () => {
  for (const bad of [
    ["Input.*"],
    ["x", "x"],
    [null],
    Array(65).fill("x"),
    "Input",
  ])
    assert.equal(isValidCodeSymbols(bad), false);
  assert.equal(
    highlightCode("InputConfig", [
      { kind: "old", label: "Old", tone: "blue", tokens: ["Input"] },
    ])[0].text,
    "Input",
  );
  assert.equal(
    isValidCodeHighlights([
      { kind: "x", label: "x", tone: "rose", tokens: ["x"], match: "regex" },
    ]),
    false,
  );
});

test("definition links resolve types and typed fields within their own block", () => {
  const code =
    "type Input struct {\n  PromptCandidates []model.PromptCandidate\n  Plain string\n}\ntype PromptCandidate struct {\n  Icon PromptCandidateIcon\n}\ntype PromptCandidateIcon struct {}";
  const links = codeDefinitionLinks(code, [
    "Input",
    "PromptCandidates",
    "PromptCandidate",
    "Plain",
    "Icon",
    "PromptCandidateIcon",
    "Missing",
  ]);
  assert.equal(links.Input.line, 1);
  assert.deepEqual(links.PromptCandidates, {
    line: 5,
    label: "PromptCandidate",
  });
  assert.equal(links.Icon.line, 8);
  assert.equal(links.Plain.line, 3);
  assert.equal(links.Missing, undefined);
  assert.equal(
    codeDefinitionLinks(code, ["Input"], { Input: 5 }).Input.line,
    5,
  );
  assert.throws(() => codeDefinitionLinks(code, ["Input"], { Input: 999 }));
});
test("ambiguous definitions and text inside comments or strings do not create false links", () => {
  const code =
    "/*\ntype Ghost struct {}\n*/\nconst example = `\ntype Quoted struct {}\n`;\ntype Value = number;\ntype Value = string;";
  const links = codeDefinitionLinks(code, [
    "Ghost",
    "Quoted",
    "Value",
    "constructor",
  ]);
  assert.deepEqual(Object.keys(links), []);
  const fields =
    "type First struct {\n  Value string\n}\ntype Second struct {\n  Value int\n}";
  assert.equal(codeDefinitionLinks(fields, ["Value"]).Value, undefined);
});
