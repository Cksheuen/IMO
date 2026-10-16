import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["packages/david-source/src/lib/codeHighlights.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { highlightCode, isValidCodeHighlights } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const settings = {
  kind: "settings",
  label: "Settings",
  tone: "violet",
  tokens: ["settings.Conf", "settings.Conf.PromptCandidates()"],
};
test("literal matching preserves text, prefers longest overlapping token and supports independent categories", () => {
  const rules = [
    settings,
    { kind: "rpc-call", label: "RPC", tone: "blue", tokens: ["rpc.Call()"] },
  ];
  const source =
    "const x = settings.Conf.PromptCandidates(); rpc.Call(); // <b>unchanged</b>";
  assert.ok(isValidCodeHighlights(rules));
  const parts = highlightCode(source, rules);
  assert.equal(parts.map((p) => p.text).join(""), source);
  assert.deepEqual(
    parts.filter((p) => p.rule).map((p) => [p.text, p.rule.kind]),
    [
      ["settings.Conf.PromptCandidates()", "settings"],
      ["rpc.Call()", "rpc-call"],
    ],
  );
  assert.deepEqual(
    highlightCode("settings.Conf settings.Conf", [settings])
      .filter((p) => p.rule)
      .map((p) => p.text),
    ["settings.Conf", "settings.Conf"],
  );
  assert.deepEqual(highlightCode("text", []), [{ text: "text" }]);
  assert.deepEqual(highlightCode("", [settings]), []);
});
test("invalid categories and unbounded tokens are rejected", () => {
  for (const value of [
    null,
    {},
    [null],
    [{ ...settings, kind: 1 }],
    [{ ...settings, kind: "Bad Kind" }],
    [{ ...settings, label: "" }],
    [{ ...settings, tone: "red" }],
    [{ ...settings, tokens: [""] }],
    [{ ...settings, tokens: ["a\nb"] }],
    [{ ...settings, tokens: ["x".repeat(161)] }],
    [settings, settings],
  ])
    assert.equal(isValidCodeHighlights(value), false);
});
