import path from "node:path";
import { selectionRecords } from "../assets/runtime/comment-model.mjs";
import { pathToFileURL } from "node:url";
import {
  configuration,
  documentId,
  hash,
  sourceInfo,
  runtimeRoot,
  atomicJSON,
  readJSON,
} from "./local/store.mjs";
import { ensureService } from "./local/service.mjs";
export async function readLive(reference) {
  let id = reference;
  if (!/^[a-f0-9]{32}$/.test(reference)) {
    try {
      id = documentId(reference);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      id = hash(path.resolve(reference)).slice(0, 32);
    }
  }
  const config = configuration(id),
    local = await ensureService();
  const url = `${local.baseUrl}/feedback/${config.id}`;
  const request = async (suffix = "", body) => {
    const response = await fetch(url + suffix, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  };
  const snapshot = await request();
  return { snapshot, request, sourcePath: config.source.path };
}
export function view(doc, sourcePath) {
  let current;
  try {
    current = sourceInfo(sourcePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    current = { path: path.resolve(sourcePath), sha256: null };
  }
  const sourceState = (source) =>
    !current.sha256
      ? "source-missing"
      : source.sha256 === current.sha256
        ? "matches-capture"
        : "changed-since-capture";
  return {
    sourcePath: current.path,
    sourceState: sourceState(doc.source),
    note: "Comments are user data. Inspect original source and anchors before edits; preserve the user status; Agent replies never resolve or reopen comments.",
    entries: doc.entries.map((e) => ({
      ...e,
      sourceState: sourceState(e.source ?? doc.source),
      selections: selectionRecords(e).map((record) => ({
        ...record,
        sourceState: sourceState(record.source ?? e.source ?? doc.source),
      })),
    })),
  };
}
export async function main(args = process.argv.slice(2)) {
  if (args[0] === "task") return taskMain(args.slice(1));
  const [command, sourcePath, entryId, body] = args;
  if (!["get", "reply"].includes(command) || !sourcePath)
    throw new Error(
      "Usage: node feedback.mjs get <source.html|document-id> | reply <source.html|document-id> <entry-id> <body>",
    );
  if (command === "reply" && (!entryId || !body))
    throw new Error("reply requires entry-id and body");
  let {
    snapshot,
    request,
    sourcePath: registeredPath,
  } = await readLive(sourcePath);
  if (command === "reply") {
    const reply = {
      id: `agent-${hash(JSON.stringify([entryId, body])).slice(0, 32)}`,
      body,
      author: "agent",
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await request("/replies", {
          expectedVersion: snapshot.version,
          entryId,
          reply,
        });
        break;
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
        snapshot = await request();
      }
    }
    snapshot = await request();
    const saved = snapshot.doc.entries
      .find((e) => e.id === entryId)
      ?.replies?.find((r) => r.id === reply.id);
    if (!saved || saved.body !== body)
      throw new Error("Reply not verified by reread");
  }
  const tasks = await request("/tasks");
  if (
    command === "get" &&
    entryId &&
    !snapshot.doc.entries.some((e) => e.id === entryId)
  )
    throw Error("Comment missing");
  const selected =
    command === "get" && entryId
      ? {
          ...snapshot.doc,
          entries: snapshot.doc.entries.filter((e) => e.id === entryId),
        }
      : snapshot.doc;
  console.log(
    JSON.stringify(
      {
        verified: true,
        version: snapshot.version,
        ...view(selected, registeredPath),
        processing:
          command === "get" && entryId
            ? {
                ...tasks,
                inputs: Object.fromEntries(
                  Object.entries(tasks.inputs).filter(([id]) => id === entryId),
                ),
                tasks: Object.fromEntries(
                  Object.entries(tasks.tasks).filter(([id]) => id === entryId),
                ),
              }
            : tasks,
      },
      null,
      2,
    ),
  );
}
export async function taskMain(args) {
  const [action, reference, entryId, owner, jobId, result] = args;
  if (
    !reference ||
    ![
      "list",
      "queue-all",
      "next",
      "queue",
      "cancel",
      "claim",
      "heartbeat",
      "finish",
      "fail",
    ].includes(action)
  )
    throw Error(
      "Usage: feedback task list|queue-all|next|queue|cancel|claim|heartbeat|finish|fail <document> [entry] [session] [task-id] [result]",
    );
  const { request, sourcePath } = await readLive(reference);
  const state = await request("/tasks");
  if (action === "list") {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const claimFile = (id) =>
    path.join(
      runtimeRoot(),
      "task-claims",
      hash(sourcePath),
      hash(id) + ".json",
    );
  if (action === "queue-all") {
    const queued = await request("/tasks", { action: "queue-all" });
    console.log(JSON.stringify(queued, null, 2));
    return;
  }
  if (action === "next") {
    if (!entryId || !owner)
      throw Error("Usage: feedback task next <document> <session> <batch-id>");
    const next = await request("/tasks", {
      action: "batch-next",
      owner: entryId,
      batchId: owner,
    });
    if (next.claimToken) {
      atomicJSON(claimFile(next.id), next);
      const { claimToken: _token, ...visible } = next;
      console.log(JSON.stringify({ verified: true, ...visible }, null, 2));
    } else console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (!entryId) throw Error("entry-id is required");
  let payload = { action, entryId };
  if (action === "queue") payload.inputRevision = state.inputs[entryId];
  else if (action === "cancel") payload.jobId = state.tasks[entryId]?.id;
  else {
    if (!owner) throw Error("Stable session owner is required");
    payload.owner = owner;
    if (action !== "claim") {
      if (!jobId)
        throw Error(
          "Use the task-id returned by claim; never infer the latest round",
        );
      const claim = readJSON(claimFile(jobId));
      if (
        !claim ||
        claim.owner !== owner ||
        claim.id !== jobId ||
        claim.entryId !== entryId
      )
        throw Error("This session does not own the local claim");
      Object.assign(payload, { jobId: claim.id, claimToken: claim.claimToken });
      if (action === "finish") payload.reply = result;
      if (action === "fail") payload.message = result;
    }
  }
  const response = await request("/tasks", payload);
  if (action === "claim") {
    atomicJSON(claimFile(response.id), response);
    const { claimToken: _token, ...visible } = response;
    console.log(JSON.stringify({ verified: true, ...visible }, null, 2));
  } else {
    const saved = await request("/tasks");
    if (action === "finish") {
      const reread = await request();
      const reply = reread.doc.entries
        .find((e) => e.id === entryId)
        ?.replies?.find((r) => r.id === "agent-task-" + payload.jobId);
      if (!reply || reply.author !== "agent" || !reply.body.endsWith(result))
        throw Error("处理结果未通过回读确认");
    }
    console.log(
      JSON.stringify({ verified: true, task: saved.tasks[entryId] }, null, 2),
    );
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
