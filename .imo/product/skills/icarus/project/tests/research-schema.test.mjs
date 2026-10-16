import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import { research } from "./fixtures/research.mjs";
const bundled = await build({
  entryPoints: ["mods/research-workbench/src/schema.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  loader: { ".css": "empty" },
  alias: { "@david": path.resolve("packages/david-source/src") },
});
const { validateResearch } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
test("structured prose validates table shape and safe source links", () => {
  const s = structuredClone(research);
  const q = s.pages[0].questions[0];
  q.readingSections = [{id:"path",title:"路径",table:{headers:["来源"],rows:[[{text:"file.ts:10",href:"evidence/source.html#L10"}]]}}];
  assert.equal(validateResearch(s),s);
  q.readingSections[0].table.rows[0][0].href = "javascript:alert(1)";
  assert.throws(()=>validateResearch(s),/structured reading/);
  q.readingSections[0].table.rows[0] = [];
  assert.throws(()=>validateResearch(s),/structured reading/);
  delete q.readingSections;
  q.explanations["entry:input"].inputSources = [{id:"source",title:"来源",paragraphs:[]}];
  assert.throws(()=>validateResearch(s),/input sources/);
});
test("independent explanations require node I/O and exclusive code ownership; legacy specs remain supported", () => {
  assert.equal(validateResearch(research), research);
  const mutate = (fn) => {
    const v = structuredClone(research);
    fn(v.pages[0].questions[0]);
    return v;
  };
  assert.throws(
    () =>
      validateResearch(mutate((q) => delete q.explanations["entry:output"])),
    /own explanation/,
  );
  assert.throws(
    () =>
      validateResearch(
        mutate((q) => (q.explanations["entry:input"].inputs = [])),
      ),
    /I\/O/,
  );
  assert.throws(
    () =>
      validateResearch(
        mutate(
          (q) => (q.explanations["entry:output"].codeIds = ["entry-code"]),
        ),
      ),
    /exactly one node/,
  );
  assert.throws(
    () =>
      validateResearch(
        mutate((q) => {
          delete q.explanations["entry:input"].functionGraph;
          delete q.explanations["entry:input"].resource;
          q.explanations["entry:input"].codeIds = [];
        }),
      ),
    /no explanation owner/,
  );
  assert.throws(
    () =>
      validateResearch(
        mutate((q) => {
          delete q.explanations["entry:input"].functionGraph;
          delete q.explanations["entry:input"].resource;
          q.explanations["entry:input"].codeIds = ["missing"];
        }),
      ),
    /exactly one node/,
  );
  assert.throws(
    () =>
      validateResearch(
        mutate((q) => (q.explanations.orphan = q.explanations["entry:output"])),
      ),
    /no graph node/,
  );
});

test("a deployment exclusion cannot conceal executable code or transformations", () => {
  const data = structuredClone(research);
  data.pages[0].questions[0].explanations["entry:input"].flowExclusion =
    "inventory";
  assert.throws(() => validateResearch(data), /Only non-executable/);
});

test("typed contracts validate both directions and annotation ranges", () => {
  const invalid = (change) => {
    const v = structuredClone(research);
    change(v.pages[0].questions[0].explanations["entry:input"].contracts);
    return v;
  };
  assert.throws(
    () => validateResearch(invalid((c) => delete c.outputs)),
    /Invalid typed I\/O/,
  );
  assert.throws(
    () => validateResearch(invalid((c) => (c.inputs.code = ""))),
    /Invalid typed I\/O/,
  );
  assert.throws(
    () =>
      validateResearch(invalid((c) => (c.inputs.annotations[0].endLine = 99))),
    /Invalid typed I\/O/,
  );
});

test("definitions have sources and exclusive ownership; resources and color rules validate", () => {
  const invalid = (mutate) => {
    const data = structuredClone(research);
    const q = data.pages[0].questions[0];
    q.codes.push({
      id: "entry-definition",
      title: "Legacy definition",
      language: "TypeScript",
      code: "type Prompt = {text?:string};",
      source: "/workspace/types.ts:1",
      annotations: [],
    });
    q.explanations["entry:input"].definitionIds = ["entry-definition"];
    mutate(q);
    return data;
  };
  assert.throws(
    () =>
      validateResearch(
        invalid(
          (q) => delete q.codes.find((c) => c.id === "entry-definition").source,
        ),
      ),
    /definitions require/,
  );
  assert.throws(
    () =>
      validateResearch(
        invalid(
          (q) =>
            (q.explanations["entry:output"].definitionIds = [
              "entry-definition",
            ]),
        ),
      ),
    /exactly one/,
  );
  assert.throws(
    () =>
      validateResearch(
        invalid(
          (q) =>
            (q.explanations["entry:input"].resource.fields = [
              { label: "Key", value: 5 },
            ]),
        ),
      ),
    /source resource/,
  );
  assert.throws(
    () =>
      validateResearch(
        invalid((q) => (q.highlights[0].tone = "arbitrary-css")),
      ),
    /code highlights/,
  );
});

test("resource links allow web navigation and reject executable or malformed URLs", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "not-a-url",
    "https://user:password@example.com",
    5,
  ]) {
    const data = structuredClone(research);
    data.pages[0].questions[0].explanations["entry:input"].resource.href = href;
    assert.throws(() => validateResearch(data), /source resource/);
    delete data.pages[0].questions[0].explanations["entry:input"].resource.href;
    delete data.pages[0].questions[0].explanations["entry:input"].resource
      .linkLabel;
    data.pages[0].questions[0].explanations[
      "entry:input"
    ].resource.fields[0].href = href;
    assert.throws(() => validateResearch(data), /source resource/);
  }
  assert.equal(validateResearch(research), research);
});

test("function bindings and source lines reject dangling references and false numbering", () => {
  for (const change of [
    (q) => (q.explanations["entry:input"].resource.afterCodeId = "missing"),
    (q) =>
      (q.explanations["entry:input"].functionGraph.nodes[0].id = "missing"),
    (q) => (q.codes[0].lineNumbers = [0, 1]),
    (q) => (q.codes[0].lineNumbers = [120]),
  ]) {
    const data = structuredClone(research);
    change(data.pages[0].questions[0]);
    assert.throws(() => validateResearch(data));
  }
});

test("service resources, entry functions and lineage reject misleading bindings", () => {
  const fresh = () => structuredClone(research);
  const data = fresh(),
    q = data.pages[0].questions[0];
  const node = q.explanations["entry:input"];
  node.resources = [
    {
      kind: "RDS",
      title: "Database",
      fields: [{ label: "PSM", value: "test.mysql" }],
      status: { state: "partial", label: "Schema unverified" },
      afterCodeId: node.codeIds[0],
    },
  ];
  node.entryFunction = node.functionGraph.nodes[0].id;
  node.serviceTags = ["PSM", "RDS"];
  node.transformations = [
    { input: "query", operation: "normalize", output: "config" },
  ];
  const edge = q.graph.edges[0];
  q.handoffs = [
    {
      from: edge.from,
      to: edge.to,
      mapping: "Only the prompt field is forwarded",
      extraInputs: "Authenticated identity",
      kind: "data",
    },
  ];
  assert.equal(validateResearch(data), data);
  for (const mutate of [
    (q) => (q.explanations["entry:input"].entryFunction = "not-a-function"),
    (q) =>
      (q.explanations["entry:input"].resources[0].afterCodeId = "not-owned"),
    (q) =>
      (q.explanations["entry:input"].resources[0].status.state =
        "deployed-ish"),
    (q) =>
      (q.explanations["entry:input"].resources[0].links = [
        { label: "bad", href: "javascript:alert(1)" },
      ]),
    (q) => (q.explanations["entry:input"].transformations[0].operation = ""),
    (q) =>
      (q.explanations["entry:input"].transformations[0].functionIds = [
        "missing",
      ]),
    (q) => (q.handoffs[0].to = "missing"),
    (q) => (q.handoffs[0].to = q.handoffs[0].from),
  ]) {
    const broken = structuredClone(data);
    mutate(broken.pages[0].questions[0]);
    assert.throws(() => validateResearch(broken));
  }
});
