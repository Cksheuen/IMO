import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJSON, snapshot } from "./store.mjs";
import { inputRevision, enqueueBatchInputs } from "./feedback-queue.mjs";
export { inputRevision } from "./feedback-queue.mjs";
export const TASK_LEASE_MS = 20 * 60 * 1000;
const error = (message, status = 409) => {
  throw Object.assign(Error(message), { status });
};
const publicTask = (task, entry, now) => {
  const changed = entry && task.inputRevision !== inputRevision(entry);
  const expired = task.state === "running" && task.leaseUntil <= now;
  return {
    id: task.id,
    entryId: task.entryId,
    state: expired
      ? "failed"
      : changed && ["queued", "done", "changed"].includes(task.state)
        ? "changed"
        : task.state,
    hasNewInput: Boolean(changed),
    requestedAt: task.requestedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    owner: task.owner,
    leaseUntil: task.leaseUntil,
    message: expired ? "Agent 认领已超时，可重新排队" : task.message,
  };
};
export function taskView(config, root, now = Date.now()) {
  const state = snapshot(config, root),
    entries = state.doc.entries;
  return {
    version: state.version,
    dispatch: { available: false, reason: "自动启动通道未连接" },
    inputs: Object.fromEntries(entries.map((e) => [e.id, inputRevision(e)])),
    tasks: Object.fromEntries(
      entries
        .filter((e) => Object.hasOwn(state.feedbackTasks ?? {}, e.id))
        .map((e) => [e.id, publicTask(state.feedbackTasks[e.id], e, now)]),
    ),
    batch: state.feedbackBatch
      ? {
          ...state.feedbackBatch,
          state:
            state.feedbackBatch.state === "running" &&
            state.feedbackBatch.leaseUntil <= now
              ? "failed"
              : state.feedbackBatch.state,
        }
      : undefined,
  };
}
const persistState = (config, root, state) => {
  state.version++;
  if (Buffer.byteLength(JSON.stringify(state)) > 32 * 1024 * 1024)
    error("Storage size limit reached", 422);
  atomicJSON(path.join(root, "feedback", config.id + ".json"), state);
};
// A batch authorizes draining saved user input, but each claim still owns one immutable revision.
function changeBatch(config, body, root, now) {
  const { action, owner, batchId } = body;
  const allowed =
    action === "queue-all" ? ["action"] : ["action", "owner", "batchId"];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    error("Unknown batch fields", 422);
  const state = snapshot(config, root);
  const previous = state.feedbackBatch;
  const active =
    previous &&
    (previous.state === "queued" ||
      (previous.state === "running" && previous.leaseUntil > now));
  if (action === "queue-all" && active) return taskView(config, root, now);
  if (action === "batch-next") {
    if (typeof owner !== "string" || !owner.trim() || owner.length > 200)
      error("Stable session owner is required", 422);
    if (!active || previous.id !== batchId)
      error("批次已结束或失效，请重新提交处理请求");
    if (previous.owner && previous.owner !== owner)
      error("批次已由其他 Agent 认领");
  }
  const batch =
    action === "queue-all"
      ? {
          id: randomUUID(),
          state: "queued",
          requestedAt: new Date(now).toISOString(),
        }
      : {
          ...previous,
          state: "running",
          owner,
          leaseUntil: now + TASK_LEASE_MS,
        };
  const tasks = (state.feedbackTasks ??= {});
  const running = state.doc.entries.find(
    (entry) =>
      tasks[entry.id]?.state === "running" && tasks[entry.id].leaseUntil > now,
  );
  if (action === "batch-next" && running && tasks[running.id].owner !== owner)
    error("同一文档已有任务处理中，请等待完成");
  enqueueBatchInputs(state, batch, now);
  const next =
    running ??
    [...state.doc.entries]
      .filter(
        (entry) =>
          entry.status !== "resolved" && tasks[entry.id]?.state === "queued",
      )
      .sort((a, b) =>
        tasks[a.id].requestedAt.localeCompare(tasks[b.id].requestedAt),
      )[0];
  if (!next)
    Object.assign(batch, {
      state: "done",
      finishedAt: new Date(now).toISOString(),
    });
  if (next) tasks[next.id].batchId = batch.id;
  state.feedbackBatch = batch;
  persistState(config, root, state);
  if (action === "batch-next" && next) {
    const claim = changeTask(
      config,
      { action: "claim", entryId: next.id, owner },
      root,
      now,
    );
    return { ...claim, batchId: batch.id };
  }
  return taskView(config, root, now);
}
export function changeTask(config, body, root, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    error("Invalid task request", 422);
  if (body.action === "queue-all" || body.action === "batch-next")
    return changeBatch(config, body, root, now);
  const { action, entryId, owner, jobId, claimToken } = body;
  const allowed = {
    queue: ["inputRevision"],
    cancel: ["jobId"],
    claim: ["owner"],
    heartbeat: ["owner", "jobId", "claimToken"],
    finish: ["owner", "jobId", "claimToken", "reply"],
    fail: ["owner", "jobId", "claimToken", "message"],
  };
  if (
    !Object.hasOwn(allowed, action) ||
    Object.keys(body).some(
      (k) => !["action", "entryId", ...allowed[action]].includes(k),
    )
  )
    error("Unknown task fields", 422);
  if (typeof entryId !== "string" || !entryId || entryId.length > 128)
    error("Invalid entry id", 422);
  const state = snapshot(config, root),
    entry = state.doc.entries.find((e) => e.id === entryId);
  if (!entry) error("Comment missing", 404);
  const tasks = (state.feedbackTasks ??= {}),
    previous = Object.hasOwn(tasks, entryId) ? tasks[entryId] : undefined,
    revision = inputRevision(entry);
  const active = (t) => t?.state === "running" && t.leaseUntil > now;
  const save = () => persistState(config, root, state);
  if (action === "queue") {
    if (entry.status === "resolved") error("请先重新打开评论");
    if (body.inputRevision !== revision)
      error("评论有新内容，请刷新后重新排队");
    if (active(previous)) error("这条评论正在处理，新增意见会保留到下一轮");
    if (previous?.state === "queued" && previous.inputRevision === revision)
      return taskView(config, root, now);
    Object.defineProperty(tasks, entryId, {
      value: {
        id: randomUUID(),
        entryId,
        state: "queued",
        inputRevision: revision,
        input: structuredClone(entry),
        requestedAt: new Date(now).toISOString(),
      },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    save();
  } else if (action === "cancel") {
    if (!previous || previous.id !== jobId) error("排队请求已变化");
    if (previous.state === "cancelled") return taskView(config, root, now);
    if (previous.state !== "queued") error("只能取消尚未认领的任务");
    previous.state = "cancelled";
    save();
  } else {
    if (typeof owner !== "string" || !owner.trim() || owner.length > 200)
      error("Agent owner is required", 422);
    if (!previous) error("请先将这条评论加入处理队列");
    if (action === "claim") {
      if (active(previous) && previous.owner !== owner)
        error("评论已由其他 Agent 认领");
      if (!active(previous)) {
        if (previous.state !== "queued") error("任务已结束或超时，请重新排队");
        if (entry.status === "resolved" || previous.inputRevision !== revision)
          error("评论状态或内容已变化，请重新排队");
        if (
          Object.values(tasks).some(
            (t) =>
              t !== previous &&
              active(t) &&
              state.doc.entries.some((e) => e.id === t.entryId),
          )
        )
          error("同一文档已有任务处理中，请等待完成");
        previous.state = "running";
        previous.owner = owner;
        previous.claimToken = randomUUID();
        previous.startedAt = new Date(now).toISOString();
      }
      previous.leaseUntil = now + TASK_LEASE_MS;
      save();
      return {
        ...publicTask(previous, entry, now),
        claimToken: previous.claimToken,
        input: previous.input,
        inputRevision: previous.inputRevision,
        sourcePath: config.source.path,
      };
    }
    if (
      previous.id !== jobId ||
      previous.owner !== owner ||
      previous.claimToken !== claimToken
    )
      error("认领凭据已失效，不能结束其他轮次的任务");
    if (
      action === "finish" &&
      previous.resultReply === body.reply &&
      ["done", "changed"].includes(previous.state)
    )
      return taskView(config, root, now);
    if (!active(previous)) error("认领已结束或超时，请重新排队");
    if (action === "heartbeat") {
      previous.leaseUntil = now + TASK_LEASE_MS;
      if (
        state.feedbackBatch?.state === "running" &&
        state.feedbackBatch.owner === owner
      )
        state.feedbackBatch.leaseUntil = now + TASK_LEASE_MS;
    }
    if (action === "fail") {
      if (
        typeof body.message !== "string" ||
        !body.message.trim() ||
        body.message.length > 1000
      )
        error("Invalid task failure", 422);
      previous.state = "failed";
      previous.message = body.message;
      previous.finishedAt = new Date(now).toISOString();
    }
    if (action === "finish") {
      if (
        typeof body.reply !== "string" ||
        !body.reply.trim() ||
        body.reply.length > 3500
      )
        error("Task result must contain 1–3500 characters", 422);
      if ((entry.replies?.length ?? 0) >= 200)
        error("Reply limit reached", 422);
      const changed = previous.inputRevision !== revision;
      (entry.replies ??= []).push({
        id: "agent-task-" + previous.id,
        author: "agent",
        createdAt: new Date(now).toISOString(),
        body:
          (changed
            ? "本次处理对应排队时的意见；期间新增的意见尚未覆盖。\n\n"
            : "") + body.reply,
      });
      previous.state = changed ? "changed" : "done";
      previous.resultReply = body.reply;
      previous.finishedAt = new Date(now).toISOString();
    }
    save();
  }
  return taskView(config, root, now);
}
