/** David CommentRail semantics, shared by the framework-independent core and Agent view. */
export const MAX_SELECTIONS = 8;
export function selectionRecords(entry) {
  return (
    entry.selections ?? [
      { id: "primary", selection: entry.selection, source: entry.source },
    ]
  );
}
export function reviewState(entry, task) {
  if (entry.status === "resolved") return "confirmed";
  if (
    task?.hasNewInput ||
    task?.state === "queued" ||
    task?.state === "running" ||
    task?.state === "failed" ||
    task?.state === "changed"
  )
    return "commented";
  if (task?.state === "done") return "pending";
  let agent = -1,
    user = -1;
  (entry.replies ?? []).forEach((reply, i) => {
    if (reply.author === "agent") agent = i;
    else user = i;
  });
  return agent > user ? "pending" : "commented";
}
