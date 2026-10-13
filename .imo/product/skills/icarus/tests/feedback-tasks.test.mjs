import { reviewState } from "../assets/runtime/comment-model.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerDocument,
  snapshot,
  mutate,
} from "../scripts/local/store.mjs";
import {
  taskView,
  changeTask,
  TASK_LEASE_MS,
} from "../scripts/local/feedback-tasks.mjs";
import { handleDavid } from "../scripts/compat/david-channel.mjs";
import { enqueueBatchInputs } from "../scripts/local/feedback-queue.mjs";
import { startService } from "../scripts/local/server.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "icarus-tasks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.html");
  fs.writeFileSync(source, "<p>test</p>");
  const config = registerDocument(source, source, root);
  const state = () => snapshot(config, root);
  const selection = {
    kind: "region",
    text: "内容",
    truncated: false,
    anchors: ["p"],
    rect: { x: 0, y: 0, width: 10, height: 10 },
    viewport: { width: 100, height: 100 },
    scroll: { x: 0, y: 0 },
    capturedAt: new Date().toISOString(),
  };
  const add = (id) =>
    mutate(
      config,
      "entries",
      {
        expectedVersion: state().version,
        entry: {
          id,
          comment: "意见 " + id,
          status: "open",
          createdAt: new Date().toISOString(),
          source: config.source,
          selection,
        },
      },
      root,
    );
  const reply = (id, body, author = "user") =>
    mutate(
      config,
      "replies",
      {
        expectedVersion: state().version,
        entryId: id,
        reply: { id: "reply-" + state().version, body, author },
      },
      root,
    );
  const call = (action, entryId, fields = {}, now = 1000) =>
    changeTask(config, { action, entryId, ...fields }, root, now);
  const view = (now = 1000) => taskView(config, root, now);
  const queue = (id) => call("queue", id, { inputRevision: view().inputs[id] });
  const finish = (claim, reply = "已验证") =>
    call("finish", claim.entryId, {
      owner: claim.owner,
      jobId: claim.id,
      claimToken: claim.claimToken,
      reply,
    });
  add("A");
  return { root, config, state, add, reply, call, view, queue, finish };
}
test("saving during a live batch immediately queues additions and updated input without replacing the active claim", (t) => {
  const f = fixture(t);
  const call = (body) => changeTask(f.config, body, f.root);
  const batch = call({ action: "queue-all" }).batch;
  const next = () =>
    call({ action: "batch-next", owner: "session", batchId: batch.id });
  const a = next();
  const active = structuredClone(f.state().feedbackTasks.A);
  const before = f.state().version;
  f.add("C");
  assert.equal(
    f.state().version,
    before + 1,
    "comment and queued task share one write",
  );
  assert.equal(taskView(f.config, f.root).tasks.C.state, "queued");
  assert.equal(f.state().feedbackTasks.C.batchId, batch.id);
  f.reply("C", "排队时新增要求");
  assert.equal(
    f.state().feedbackTasks.C.input.replies.at(-1).body,
    "排队时新增要求",
  );
  f.reply("A", "处理中新增要求");
  assert.deepEqual(
    f.state().feedbackTasks.A,
    active,
    "running claim and input remain immutable",
  );
  assert.equal(taskView(f.config, f.root).tasks.A.hasNewInput, true);
  call({
    action: "finish",
    entryId: a.entryId,
    owner: a.owner,
    jobId: a.id,
    claimToken: a.claimToken,
    reply: "旧版本已处理",
  });
  assert.equal(taskView(f.config, f.root).tasks.A.state, "changed");
  const c = next();
  assert.equal(c.entryId, "C", "earlier queued input keeps its place");
  call({
    action: "finish",
    entryId: c.entryId,
    owner: c.owner,
    jobId: c.id,
    claimToken: c.claimToken,
    reply: "C 已处理",
  });
  const revised = next();
  assert.equal(revised.entryId, "A");
  assert.equal(
    revised.input.replies.some((r) => r.body === "处理中新增要求"),
    true,
  );
  call({
    action: "finish",
    entryId: revised.entryId,
    owner: revised.owner,
    jobId: revised.id,
    claimToken: revised.claimToken,
    reply: "新版本已处理",
  });
  f.add("D");
  next(); // D is active; A is awaiting human review.
  f.reply("D", "补充说明", "agent");
  assert.equal(taskView(f.config, f.root).tasks.A.state, "done");
  f.reply("A", "复评新增意见");
  assert.equal(taskView(f.config, f.root).tasks.A.state, "queued");
  assert.equal(
    f.state().feedbackTasks.A.input.replies.at(-1).body,
    "复评新增意见",
  );
  assert.ok(f.state().doc.entries.every((entry) => entry.status === "open"));
});

test("native React saves immediately queue additions and edits in the same active batch", (t) => {
  const f = fixture(t);
  const batch = changeTask(f.config, { action: "queue-all" }, f.root).batch;
  changeTask(
    f.config,
    { action: "batch-next", owner: "session", batchId: batch.id },
    f.root,
  );
  const active = structuredClone(f.state().feedbackTasks.A);
  const request = (suffix, method, body) =>
    handleDavid(
      f.config,
      "/feedback/test" + suffix,
      method,
      { ...body, expectedVersion: f.state().version },
      f.root,
    );
  const before = f.state().version;
  request("/entries", "POST", {
    entry: {
      id: "native",
      category: "visual",
      suggestion: "新增意见",
      createdAt: new Date().toISOString(),
      scope: { pageId: "p1" },
    },
  });
  assert.equal(f.state().version, before + 1);
  assert.equal(taskView(f.config, f.root).tasks.native.state, "queued");
  assert.equal(f.state().feedbackTasks.native.batchId, batch.id);
  request("/entries/native", "PATCH", { suggestion: "更新意见" });
  assert.equal(f.state().feedbackTasks.native.input.comment, "更新意见");
  assert.equal(taskView(f.config, f.root).tasks.native.state, "queued");
  assert.deepEqual(f.state().feedbackTasks.A, active);
  request("/entries", "POST", {
    entry: {
      id: "agent-proposal",
      origin: "agent",
      category: "visual",
      suggestion: "Agent 建议",
      createdAt: new Date().toISOString(),
    },
  });
  assert.equal(f.state().feedbackTasks["agent-proposal"], undefined);
});

test("save-time reconciliation never starts an inactive batch or retries unchanged failed work", (t) => {
  const f = fixture(t);
  f.add("B");
  assert.deepEqual(taskView(f.config, f.root).tasks, {});
  const state = f.state();
  for (const batch of [
    undefined,
    { id: "done", state: "done" },
    { id: "expired", state: "running", leaseUntil: 999 },
  ]) {
    const copy = structuredClone(state);
    enqueueBatchInputs(copy, batch, 1000);
    assert.deepEqual(copy.feedbackTasks ?? {}, {});
  }
  const batch = changeTask(f.config, { action: "queue-all" }, f.root).batch;
  const a = changeTask(
    f.config,
    { action: "batch-next", owner: "session", batchId: batch.id },
    f.root,
  );
  changeTask(
    f.config,
    {
      action: "fail",
      entryId: a.entryId,
      owner: a.owner,
      jobId: a.id,
      claimToken: a.claimToken,
      message: "需要补充",
    },
    f.root,
  );
  f.add("C");
  assert.equal(taskView(f.config, f.root).tasks.C.state, "queued");
  assert.equal(taskView(f.config, f.root).tasks.A.state, "failed");
});

test("one global batch drains saved additions and changed revisions without reprocessing reviewed work", (t) => {
  const f = fixture(t);
  f.add("B");
  f.reply("B", "此前已处理，等待人审", "agent");
  const batchCall = (body, now = 1000) =>
    changeTask(f.config, body, f.root, now);
  const started = batchCall({ action: "queue-all" });
  assert.deepEqual(Object.keys(started.tasks), ["A"]);
  assert.deepEqual(batchCall({ action: "queue-all" }), started);
  const next = () =>
    batchCall({
      action: "batch-next",
      owner: "session",
      batchId: started.batch.id,
    });
  const a = next();
  assert.equal(a.entryId, "A");
  assert.equal(next().id, a.id);
  assert.throws(
    () =>
      batchCall({
        action: "batch-next",
        owner: "other",
        batchId: started.batch.id,
      }),
    /其他 Agent/,
  );
  f.add("C");
  f.reply("A", "处理期间的新要求");
  f.finish(a);
  assert.equal(f.view().tasks.A.state, "changed");
  const handled = [];
  for (let i = 0; i < 3; i++) {
    const claim = next();
    if (!claim.claimToken) {
      assert.equal(claim.batch.state, "done");
      break;
    }
    handled.push(claim.entryId);
    f.finish(claim);
  }
  assert.deepEqual(handled.sort(), ["A", "C"]);
  assert.equal(f.view().batch.state, "done");
  assert.ok(f.state().doc.entries.every((e) => e.status === "open"));
  assert.equal(batchCall({ action: "queue-all" }).batch.state, "done");
  assert.throws(() => next(), /失效/);
});

test("failed batch attempts require an explicit retry, and heartbeats extend the owning batch", (t) => {
  const f = fixture(t);
  const call = (body, now = 1000) => changeTask(f.config, body, f.root, now);
  const batch = call({ action: "queue-all" }).batch;
  const a = call({ action: "batch-next", owner: "session", batchId: batch.id });
  f.call(
    "heartbeat",
    "A",
    { owner: a.owner, jobId: a.id, claimToken: a.claimToken },
    2000,
  );
  assert.equal(f.view(2000).batch.leaseUntil, 2000 + TASK_LEASE_MS);
  f.call("fail", "A", {
    owner: a.owner,
    jobId: a.id,
    claimToken: a.claimToken,
    message: "待补充",
  });
  const end = call({
    action: "batch-next",
    owner: "session",
    batchId: batch.id,
  });
  assert.equal(end.batch.state, "done");
  assert.equal(end.tasks.A.state, "failed");
  const retry = call({ action: "queue-all" });
  assert.notEqual(retry.batch.id, batch.id);
  assert.equal(retry.tasks.A.state, "queued");
});

test("batch skips human-resolved or deleted queued entries and refreshes edits before claiming", (t) => {
  const f = fixture(t);
  f.add("B");
  const batch = changeTask(
    f.config,
    { action: "queue-all" },
    f.root,
    1000,
  ).batch;
  mutate(
    f.config,
    "updates",
    {
      expectedVersion: f.state().version,
      entryId: "A",
      update: {
        id: "resolved",
        kind: "status",
        status: "resolved",
        previousStatus: "open",
      },
    },
    f.root,
  );
  f.reply("B", "认领前修改");
  const b = changeTask(
    f.config,
    { action: "batch-next", owner: "session", batchId: batch.id },
    f.root,
    1000,
  );
  assert.equal(b.entryId, "B");
  assert.equal(b.input.replies.at(-1).body, "认领前修改");
  assert.equal(
    f.state().doc.entries.find((e) => e.id === "A").status,
    "resolved",
  );
});
test("one-entry claim is idempotent, serial, and independent of newly added comments", (t) => {
  const f = fixture(t);
  f.queue("A");
  const queued = f.view();
  f.queue("A");
  assert.equal(f.view().version, queued.version);
  const a = f.call("claim", "A", { owner: "session-1" });
  assert.equal(a.input.comment, "意见 A");
  assert.equal(f.call("claim", "A", { owner: "session-1" }).id, a.id);
  f.add("B");
  f.queue("B");
  f.reply("B", "B 的新意见");
  assert.equal(f.view().tasks.A.hasNewInput, false);
  assert.throws(
    () => f.call("claim", "B", { owner: "session-2" }),
    /变化|已有任务/,
  );
  f.finish(a);
  assert.equal(f.view().tasks.A.state, "done");
  assert.equal(
    f.state().doc.entries.find((e) => e.id === "B").replies.length,
    1,
  );
  assert.equal(f.state().doc.entries[0].status, "open");
  const version = f.view().version;
  f.finish(a);
  assert.equal(f.view().version, version);
});
test("same-entry follow-up or selection edit cannot be silently counted as covered", (t) => {
  const f = fixture(t);
  f.queue("A");
  const a = f.call("claim", "A", { owner: "session" });
  f.reply("A", "Agent 进度说明", "agent");
  assert.equal(f.view().tasks.A.hasNewInput, false);
  f.reply("A", "新增要求");
  assert.equal(f.view().tasks.A.state, "running");
  assert.equal(f.view().tasks.A.hasNewInput, true);
  f.finish(a);
  assert.equal(f.view().tasks.A.state, "changed");
  assert.equal(
    reviewState(f.state().doc.entries[0], f.view().tasks.A),
    "commented",
  );
  assert.match(
    f.state().doc.entries[0].replies.at(-1).body,
    /新增的意见尚未覆盖/,
  );
  f.queue("A");
  const b = f.call("claim", "A", { owner: "session" });
  assert.notEqual(a.id, b.id);
  assert.throws(() => f.finish(a), /凭据/);
  mutate(
    f.config,
    "updates",
    {
      expectedVersion: f.state().version,
      entryId: "A",
      update: {
        id: "select-2",
        kind: "selection",
        source: f.config.source,
        selection: { ...f.state().doc.entries[0].selection, text: "另一选区" },
      },
    },
    f.root,
  );
  assert.equal(f.view().tasks.A.hasNewInput, true);
  f.finish(b);
  assert.equal(f.view().tasks.A.state, "changed");
});
test("expired/deleted claims cannot finish a later run or restore a deleted entry", (t) => {
  const f = fixture(t);
  f.queue("A");
  const a = f.call("claim", "A", { owner: "owner" });
  assert.throws(() => f.call("claim", "A", { owner: "other" }), /其他 Agent/);
  assert.throws(
    () =>
      f.call("finish", "A", {
        owner: a.owner,
        jobId: a.id,
        claimToken: "wrong",
        reply: "x",
      }),
    /凭据/,
  );
  assert.equal(f.view(1000 + TASK_LEASE_MS + 1).tasks.A.state, "failed");
  assert.throws(
    () =>
      f.call(
        "heartbeat",
        "A",
        { owner: a.owner, jobId: a.id, claimToken: a.claimToken },
        1000 + TASK_LEASE_MS + 1,
      ),
    /超时/,
  );
  handleDavid(
    f.config,
    "/feedback/test/entries/A",
    "DELETE",
    { expectedVersion: f.state().version },
    f.root,
  );
  assert.throws(() => f.finish(a), /missing/);
  assert.equal(f.view().tasks.A, undefined);
});
test("queued changed inputs require requeue; completion never overrides human resolution", (t) => {
  const f = fixture(t);
  f.queue("A");
  f.reply("A", "修改意见");
  assert.throws(() => f.call("claim", "A", { owner: "s" }), /变化/);
  f.queue("A");
  const a = f.call("claim", "A", { owner: "s" });
  mutate(
    f.config,
    "updates",
    {
      expectedVersion: f.state().version,
      entryId: "A",
      update: {
        id: "resolve",
        kind: "status",
        previousStatus: "open",
        status: "resolved",
      },
    },
    f.root,
  );
  f.finish(a);
  assert.equal(f.state().doc.entries[0].status, "resolved");
  assert.throws(() => f.queue("A"), /重新打开/);
});
test("CLI claim/finish and browser task API share persisted state without exposing claim tokens", async (t) => {
  const f = fixture(t),
    service = await startService(f.root);
  t.after(() => service.close());
  const cli = path.resolve("scripts/cli.mjs");
  const run = async (...args) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, "feedback", ...args], {
          env: { ...process.env, ICARUS_RUNTIME_DIR: f.root },
        })
      ).stdout,
    );
  await run("task", "queue", f.config.id, "A");
  const a = await run("task", "claim", f.config.id, "A", "cli-session");
  assert.equal(a.state, "running");
  assert.equal(a.claimToken, undefined);
  const response = await fetch(service.baseUrl + "/feedback/" + f.config.id, {
    headers: { Authorization: "Bearer " + f.config.token },
  });
  assert.equal((await response.json()).feedbackTasks, undefined);
  assert.equal(
    (await fetch(service.baseUrl + "/feedback/" + f.config.id + "/tasks"))
      .status,
    403,
  );
  await run("task", "heartbeat", f.config.id, "A", "cli-session", a.id);
  await run(
    "task",
    "finish",
    f.config.id,
    "A",
    "cli-session",
    a.id,
    "完成并验证",
  );
  const one = await run("get", f.config.id, "A");
  assert.equal(one.entries.length, 1);
  assert.equal(one.processing.tasks.A.state, "done");
  assert.equal(one.entries[0].status, "open");
  await run("task", "queue", f.config.id, "A");
  const next = await run("task", "claim", f.config.id, "A", "cli-session");
  await assert.rejects(
    run("task", "finish", f.config.id, "A", "cli-session", a.id, "过期结果"),
    /凭据/,
  );
  assert.equal(
    (await run("task", "list", f.config.id)).tasks.A.state,
    "running",
  );
  await run(
    "task",
    "finish",
    f.config.id,
    "A",
    "cli-session",
    next.id,
    "新轮次结果",
  );
  await service.close();
});

test("failure, cancellation and heartbeat end or extend only the owned round", (t) => {
  const f = fixture(t);
  f.queue("A");
  const queued = f.view().tasks.A;
  f.call("cancel", "A", { jobId: queued.id });
  assert.equal(f.view().tasks.A.state, "cancelled");
  f.queue("A");
  const a = f.call("claim", "A", { owner: "session" });
  f.call(
    "heartbeat",
    "A",
    { owner: a.owner, jobId: a.id, claimToken: a.claimToken },
    5000,
  );
  assert.equal(f.view(5000).tasks.A.leaseUntil, 5000 + TASK_LEASE_MS);
  f.call(
    "fail",
    "A",
    {
      owner: a.owner,
      jobId: a.id,
      claimToken: a.claimToken,
      message: "验证未通过",
    },
    6000,
  );
  assert.equal(f.view(6000).tasks.A.state, "failed");
  assert.equal(f.state().doc.entries[0].replies, undefined);
  f.queue("A");
  assert.notEqual(f.view().tasks.A.id, a.id);
  assert.throws(() => f.finish(a), /凭据/);
});
