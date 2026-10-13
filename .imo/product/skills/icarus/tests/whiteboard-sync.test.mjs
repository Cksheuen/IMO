import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  graphToMermaid,
  readResearchSource,
  exportGraphs,
} from "../scripts/whiteboard-source.mjs";

const cli = fileURLToPath(
  new URL("../scripts/cli.mjs", import.meta.url),
);
const graph = {
  nodes: [
    { id: "a", label: '输入 "a" | b' },
    { id: "b", label: "执行\n输出" },
  ],
  edges: [{ from: "a", to: "b", kind: "control", label: "a | b" }],
  groups: [{ id: "module", label: "处理模块", nodeIds: ["b"] }],
};
const question = { id: "q", graph };
const spec = {
  schema: "icarus-research/v1",
  pages: [{ id: "p", label: "页面", questions: [question] }],
};

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-whiteboard-unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "spec.json");
  fs.writeFileSync(source, JSON.stringify(spec));
  return { dir, source };
}

test("Mermaid preserves group membership and edge kind without duplicate nodes", () => {
  const mmd = graphToMermaid({
    page: spec.pages[0],
    question,
    view: { id: "logic", label: "逻辑图", graph },
  });
  assert.match(mmd, /subgraph group_0\["处理模块"\]/);
  assert.match(mmd, /node_1_b\["执行<br\/>输出"\]\n  end/);
  assert.equal(mmd.match(/node_1_b\[/g).length, 1);
  assert.match(mmd, /==>\|"control: a #124; b"\|/);
  assert.match(mmd, /&quot;a&quot;/);
});

test("source selection ignores other mod payloads and rejects attached review HTML", (t) => {
  const { dir } = setup(t);
  const source = path.join(dir, "source.html");
  const html = `<script data-icarus-props>{"other":true}</script><script data-icarus-props>${JSON.stringify(spec)}</script>`;
  fs.writeFileSync(source, html);
  assert.deepEqual(readResearchSource(source).spec, spec);
  fs.writeFileSync(source, html + '<script id="icarus-bootstrap"></script>');
  assert.throws(() => readResearchSource(source), /not review.html/);
});

test("bad edges, duplicate node ids and invalid membership cannot silently disappear", (t) => {
  const { source, dir } = setup(t);
  for (const mutate of [
    (g) => g.edges.push({ from: "missing", to: "a" }),
    (g) => g.nodes.push({ id: "a", label: "duplicate" }),
    (g) => g.groups[0].nodeIds.push("missing"),
  ]) {
    const data = structuredClone(spec);
    mutate(data.pages[0].questions[0].graph);
    fs.writeFileSync(source, JSON.stringify(data));
    assert.throws(() => exportGraphs(source, path.join(dir, "out")));
    assert.equal(fs.existsSync(path.join(dir, "out")), false);
  }
});

function harness(t) {
  const base = setup(t);
  const lark = path.join(base.dir, "lark.mjs"),
    check = path.join(base.dir, "check.mjs"),
    log = path.join(base.dir, "calls.json");
  fs.writeFileSync(
    check,
    "#!/usr/bin/env node\nconsole.log(JSON.stringify({code:0,data:{check:{errors:Number(process.env.CHECK_ERRORS||0),warnings:0}}}));",
  );
  fs.writeFileSync(
    lark,
    `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2);
const index=args.indexOf(args[0]==='docs'?'--content':'--source');
const content=fs.readFileSync(args[index+1].slice(1),'utf8');
fs.writeFileSync(process.env.CALL_LOG,JSON.stringify({args,content}));
console.log(JSON.stringify(process.env.LARK_FAIL?{ok:false,error:'remote rejected'}:{ok:true,data:{},dry_run:args.includes('--dry-run')}));
`,
  );
  fs.chmodSync(lark, 0o755);
  fs.chmodSync(check, 0o755);
  const run = (args = [], env = {}) =>
    spawnSync(
      process.execPath,
      [
        cli,
        "whiteboard",
        "sync",
        base.source,
        "--page",
        "p",
        "--view",
        "logic",
        "--lark-cli",
        lark,
        ...args,
      ],
      {
        cwd: base.dir,
        encoding: "utf8",
        env: {
          ...process.env,
          ICARUS_WHITEBOARD_CLI: check,
          CALL_LOG: log,
          ...env,
        },
      },
    );
  const clean = () =>
    assert.deepEqual(
      fs
        .readdirSync(base.dir)
        .filter((x) => x.startsWith(".icarus-whiteboard-")),
      [],
    );
  return { ...base, log, run, clean };
}

test("board dry-run forwards the identity, overwrite and stable request token", (t) => {
  const h = harness(t);
  const args = [
    "--whiteboard-token",
    "wbcn-test",
    "--overwrite",
    "--dry-run",
    "--as",
    "bot",
  ];
  const first = h.run(args);
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout),
    request = JSON.parse(fs.readFileSync(h.log));
  assert.equal(report.synced, false);
  assert.equal(report.readBackVerified, false);
  assert.equal(request.args[request.args.indexOf("--as") + 1], "bot");
  assert.ok(request.args.includes("--dry-run"));
  assert.ok(request.args.includes("--overwrite"));
  assert.match(request.content, /subgraph/);
  const key = request.args[request.args.indexOf("--idempotent-token") + 1];
  assert.equal(h.run(args).status, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(h.log)).args[
      request.args.indexOf("--idempotent-token") + 1
    ],
    key,
  );
  h.clean();
});

test("document creation needs --create; the dry-run uses document append and leaves no temp files", (t) => {
  const h = harness(t);
  assert.notEqual(h.run(["--doc", "test"]).status, 0);
  assert.equal(fs.existsSync(h.log), false);
  const result = h.run(["--doc", "test", "--create", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const request = JSON.parse(fs.readFileSync(h.log));
  assert.equal(request.args[request.args.indexOf("--command") + 1], "append");
  assert.equal(request.args[request.args.indexOf("--as") + 1], "user");
  assert.match(request.content, /<whiteboard type="mermaid" path="@\.\//);
  h.clean();
});

test("failed check or remote error never reports success; ambiguous questions require selection", (t) => {
  const h = harness(t);
  const args = ["--whiteboard-token", "wbcn-test", "--overwrite", "--dry-run"];
  assert.notEqual(h.run(args, { CHECK_ERRORS: "1" }).status, 0);
  assert.equal(fs.existsSync(h.log), false);
  h.clean();
  assert.notEqual(h.run(args, { LARK_FAIL: "1" }).status, 0);
  h.clean();
  const data = structuredClone(spec);
  data.pages[0].questions.push({ ...question, id: "q2" });
  fs.writeFileSync(h.source, JSON.stringify(data));
  assert.match(h.run(args).stderr, /add --question/);
  assert.equal(h.run([...args, "--question", "q2"]).status, 0);
});
