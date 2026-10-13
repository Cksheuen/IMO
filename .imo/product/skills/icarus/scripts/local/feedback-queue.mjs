import { createHash, randomUUID } from "node:crypto";
import {
  selectionRecords,
  reviewState,
} from "../../assets/runtime/comment-model.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
// Only user input advances this revision. Agent replies and edits to the source HTML do not.
export const inputRevision = (entry) =>
  hash(
    JSON.stringify(
      canonical({
        comment: entry.comment,
        selections: selectionRecords(entry),
        replies: (entry.replies ?? []).filter((r) => r.author !== "agent"),
      }),
    ),
  );

/** Enqueue saved input inside the same atomic write; never start an Agent or replace an active claim. */
export function enqueueBatchInputs(
  state,
  batch = state.feedbackBatch,
  now = Date.now(),
) {
  if (
    !batch ||
    !(
      batch.state === "queued" ||
      (batch.state === "running" && batch.leaseUntil > now)
    )
  )
    return;
  const tasks = (state.feedbackTasks ??= {});
  for (const entry of state.doc.entries) {
    const task = tasks[entry.id];
    const revision = inputRevision(entry);
    if (
      entry.status === "resolved" ||
      (entry.origin ?? entry.david?.origin) === "agent"
    )
      continue;
    if (task?.state === "running" && task.leaseUntil > now) continue;
    if (task?.state === "queued" && task.inputRevision === revision) continue;
    if (task?.state === "done" && task.inputRevision === revision) continue;
    if (!task && reviewState(entry) === "pending") continue;
    // An unsuccessful attempt is reported once per batch. Explicitly clicking again permits retry.
    if (
      task?.batchId === batch.id &&
      task.inputRevision === revision &&
      ["failed", "cancelled", "running"].includes(task.state)
    )
      continue;
    Object.defineProperty(tasks, entry.id, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        id: randomUUID(),
        entryId: entry.id,
        state: "queued",
        inputRevision: revision,
        input: structuredClone(entry),
        batchId: batch.id,
        requestedAt: new Date(now).toISOString(),
      },
    });
  }
}
