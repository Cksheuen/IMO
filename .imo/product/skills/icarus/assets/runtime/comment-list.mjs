import {
  MAX_SELECTIONS,
  selectionRecords,
  reviewState,
} from "./comment-model.mjs";
/** Port of David CommentRail/CommentItem interactions; no React or optional mod dependency. */
export function createCommentList({
  shadow,
  getProcessing = () => ({ tasks: {} }),
  getDocument,
  update,
  reply,
  append,
  locate,
  storageKey,
}) {
  const $ = (s) => shadow.querySelector(s);
  let expandedId = null,
    status = "open",
    workView = { batchId: undefined, tab: "pending" };
  let drafts = {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (saved) {
      drafts = saved.drafts ?? {};
      expandedId = saved.expandedId ?? null;
    }
  } catch {}
  const draft = (id) => {
    if (!Object.hasOwn(drafts, id))
      Object.defineProperty(drafts, id, {
        value: {},
        writable: true,
        enumerable: true,
        configurable: true,
      });
    return drafts[id];
  };
  const persist = () => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ drafts, expandedId }),
      );
    } catch {}
  };
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const button = (label, fn, options = {}) => {
    const el = node("button", label, options.className);
    el.type = "button";
    el.disabled = Boolean(options.disabled);
    el.addEventListener("click", fn);
    return el;
  };
  const time = (value) =>
    new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const execute = async (entry, key, payload, kind = "update") => {
    const d = draft(entry.id);
    if (d.busy) return;
    const fingerprint = JSON.stringify([key, payload]);
    if (!d.pending || d.pending.fingerprint !== fingerprint)
      d.pending = {
        fingerprint,
        kind,
        payload: { id: crypto.randomUUID(), ...payload },
      };
    d.busy = true;
    d.error = "";
    persist();
    render();
    try {
      if (kind === "reply") await reply(entry.id, d.pending.payload);
      else await update(entry.id, d.pending.payload);
      d.pending = null;
      if (key === "edit") {
        d.editing = false;
        delete d.edit;
        delete d.original;
      }
      if (key === "reply") d.reply = "";
      if (key === "selection") delete d.selection;
      d.notice =
        key === "selection" ? "选区已保存，Agent 可直接读取。" : "已保存";
    } catch (error) {
      d.error = error.message;
      d.notice = "";
    } finally {
      d.busy = false;
      persist();
      render();
    }
  };
  const retry = (entry) => {
    const d = draft(entry.id);
    if (!d.pending) return;
    const p = d.pending;
    const { id, ...payload } = p.payload;
    void id;
    const key = p.kind === "reply" ? "reply" : payload.kind;
    return execute(entry, key, payload, p.kind);
  };
  const render = () => {
    const active = shadow.activeElement;
    const focus = active?.dataset.draftKind
      ? {
          id: active.dataset.entryId,
          kind: active.dataset.draftKind,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : null;
    const scroll = $(".rail-scroll").scrollTop;
    const entries = getDocument().entries;
    $("#comments").textContent = `评论 ${entries.length}`;
    $("#count").textContent = String(entries.length);
    const tabs = $("#filters");
    tabs.replaceChildren();
    const statuses = node("div", undefined, "comment-tabs");
    statuses.setAttribute("role", "group");
    statuses.setAttribute("aria-label", "评论状态");
    for (const [value, label] of [
      ["open", "未解决"],
      ["resolved", "已完成"],
    ]) {
      const count =
        value === "all"
          ? entries.length
          : entries.filter((e) => e.status === value).length;
      const tab = button(`${label} ${count}`, () => {
        status = value;
        render();
      });
      tab.dataset.filter = value;
      tab.setAttribute("aria-pressed", String(status === value));
      statuses.append(tab);
    }
    const scope = node("div", undefined, "comment-tabs comment-batch-row");
    scope.setAttribute("role", "group");
    scope.setAttribute("aria-label", "评论范围");
    const processing = getProcessing();
    const batch = processing.batch;
    const isProcessing = (id) =>
      ["queued", "running"].includes(processing.tasks[id]?.state);
    const processingCount = entries.filter(
      (entry) => entry.status === "open" && isProcessing(entry.id),
    ).length;
    const selectedWorkTab =
      workView.batchId === batch?.id
        ? workView.tab
        : processingCount
          ? "processing"
          : "pending";
    const workTab =
      selectedWorkTab === "processing" && !processingCount
        ? "pending"
        : selectedWorkTab;
    if (status === "open") {
      for (const [value, label] of [
        ["pending", "待处理"],
        ["processing", "处理中"],
      ]) {
        const tab = button(
          label + (value === "processing" ? ` ${processingCount}` : ""),
          () => {
            workView = { batchId: batch?.id, tab: value };
            render();
          },
          { disabled: value === "processing" && !processingCount },
        );
        tab.setAttribute("aria-label", label);
        tab.setAttribute("aria-pressed", String(workTab === value));
        scope.append(tab);
      }
    } else {
      const all = button("全部", () => {});
      all.setAttribute("aria-pressed", "true");
      scope.append(all);
    }
    const pending = (entry) =>
      reviewState(entry, processing.tasks[entry.id]) === "pending";
    tabs.append(statuses, scope);
    const handledAt = (entry) =>
      processing.tasks[entry.id]?.finishedAt ??
      entry.replies?.filter((reply) => reply.author === "agent").at(-1)
        ?.createdAt ??
      entry.createdAt;
    const visible = [...entries]
      .filter(
        (entry) =>
          entry.status === status &&
          (status !== "open" ||
            (workTab === "processing"
              ? isProcessing(entry.id)
              : !isProcessing(entry.id))),
      )
      .sort(
        (a, b) =>
          Number(pending(b)) - Number(pending(a)) ||
          (pending(a) ? handledAt(b).localeCompare(handledAt(a)) : 0) ||
          b.createdAt.localeCompare(a.createdAt),
      );
    $("#empty").hidden = visible.length > 0;
    $("#empty").textContent = entries.length
      ? "当前筛选下没有评论。"
      : "暂无评论。框选页面内容，添加修改意见。";
    $("#history").replaceChildren(
      ...visible.map((entry) => {
        const d = draft(entry.id),
          expanded = expandedId === entry.id;
        const item = node(
          "article",
          undefined,
          `comment-rail-row${expanded ? " is-expanded" : ""}${entry.status === "resolved" ? " is-resolved" : ""}`,
        );
        item.setAttribute("role", "listitem");
        item.dataset.feedbackId = entry.id;
        item.dataset.feedbackStatus = entry.status;
        item.dataset.processingState =
          processing.tasks[entry.id]?.state ?? "idle";
        const head = button(
          "",
          () => {
            expandedId = expanded ? null : entry.id;
            persist();
            render();
          },
          { className: "comment-rail-nav" },
        );
        head.setAttribute("aria-expanded", String(expanded));
        head.setAttribute("aria-label", `评论：${entry.comment.slice(0, 40)}`);
        const meta = node("div", undefined, "comment-meta");
        const stamp = node("time", time(entry.createdAt));
        stamp.dateTime = entry.createdAt;
        meta.append(
          node("span", "用户", "comment-author"),
          stamp,
          node(
            "span",
            entry.status === "resolved" ? "已完成" : "未解决",
            "comment-state",
          ),
        );
        head.append(meta, node("div", entry.comment, "comment-body"));
        const state = reviewState(entry, getProcessing().tasks[entry.id]);
        head.append(
          node(
            "small",
            `${entry.replies?.length ?? 0} 回复 · ${state === "confirmed" ? "已确认" : state === "pending" ? "待审阅" : "待处理"}`,
            "comment-review-state",
          ),
        );
        if (!expanded && entry.replies?.length) {
          const latest = entry.replies.at(-1);
          head.append(
            node(
              "p",
              `${latest.author === "agent" ? "Agent" : "用户"}：${latest.body}`,
              "comment-latest",
            ),
          );
        }
        item.append(head);
        const task = getProcessing().tasks[entry.id];
        if (task && (entry.status !== "resolved" || task.state === "running")) {
          const controls = node(
            "div",
            undefined,
            "comment-actions processing-actions",
          );
          const running = task.state === "running",
            queued = task.state === "queued";
          if (running || queued) {
            const icon = node(
              "span",
              running ? "◌" : "◷",
              running ? "processing-icon is-running" : "processing-icon",
            );
            icon.setAttribute("role", "status");
            icon.setAttribute("aria-label", running ? "正在处理" : "排队中");
            controls.append(
              icon,
              node("span", running ? "正在处理" : "排队中"),
            );
          }
          if (task.hasNewInput)
            controls.append(node("small", "有新意见待下一轮处理"));
          if (task.state === "failed")
            controls.append(
              node("small", task.message || "处理失败，可重新处理"),
            );
          if (controls.childElementCount) item.append(controls);
        }
        if (!expanded) return item;
        const blocked = Boolean(d.busy || (d.pending && d.error));
        const selections = node("section", undefined, "feedback-selections");
        selections.setAttribute("aria-label", "当前选区");
        const records = selectionRecords(entry);
        const heading = node("div", undefined, "selection-heading");
        heading.append(
          node("strong", `当前选区 ${records.length} / ${MAX_SELECTIONS}`),
          button(
            "新增选区",
            () => {
              d.error = "";
              append(entry.id);
            },
            {
              disabled:
                d.busy ||
                records.length >= MAX_SELECTIONS ||
                Boolean(d.selection),
            },
          ),
        );
        selections.append(heading);
        records.forEach((record, index) => {
          const detail = node("details");
          detail.dataset.selectionIndex = String(index);
          detail.open = Boolean(d.disclosures?.includes(record.id));
          detail.addEventListener("toggle", () => {
            d.disclosures ??= [];
            d.disclosures = d.disclosures.filter((id) => id !== record.id);
            if (detail.open) d.disclosures.push(record.id);
            persist();
          });
          const selection = record.selection;
          detail.append(
            node(
              "summary",
              `选区 ${index + 1} · ${selection.text.length} 字符${selection.truncated ? "（已截断）" : ""}`,
            ),
            node("pre", selection.text || "没有可提取的 DOM 文字"),
          );
          if (selection.context)
            detail.append(
              node(
                "small",
                Object.values(selection.context.state)
                  .filter(Boolean)
                  .join(" / "),
              ),
            );
          detail.append(
            button(`定位选区 ${index + 1}`, async () => {
              try {
                d.error = "";
                await locate(selection, record.source);
                d.notice = "已定位到选区所在内容";
              } catch (error) {
                d.error = error.message;
              }
              render();
            }),
          );
          selections.append(detail);
        });
        item.append(selections);
        if (d.selection) {
          const pending = node("div", undefined, "selection-pending");
          pending.append(
            node("strong", "选区尚未保存"),
            node("pre", d.selection.selection.text),
          );
          item.append(pending);
        }
        if (d.error) {
          const error = node(
            "p",
            `操作未确认保存：${d.error}`,
            "comment-error",
          );
          error.setAttribute("role", "alert");
          item.append(error);
        }
        if (d.pending && !d.busy && d.error)
          item.append(
            button(
              d.pending.payload.kind === "selection"
                ? "重试保存选区"
                : "重试保存",
              () => retry(entry),
            ),
            button("取消", () => {
              d.pending = null;
              delete d.selection;
              d.error = "";
              persist();
              render();
            }),
          );
        const textarea = (kind, label, value) => {
          const text = node("textarea");
          text.value = value ?? "";
          text.maxLength = 4000;
          text.setAttribute("aria-label", label);
          text.dataset.entryId = entry.id;
          text.dataset.draftKind = kind;
          text.disabled = blocked;
          text.addEventListener("input", () => {
            d[kind] = text.value;
            persist();
          });
          return text;
        };
        const actions = node("div", undefined, "comment-actions");
        if (d.editing) {
          item.append(textarea("edit", "编辑评论", d.edit));
          actions.append(
            button(
              "保存编辑",
              () => {
                if (d.edit?.trim())
                  execute(entry, "edit", {
                    kind: "edit",
                    comment: d.edit.trim(),
                    previousComment: d.original,
                  });
              },
              { disabled: blocked },
            ),
            button(
              "取消编辑",
              () => {
                d.editing = false;
                delete d.edit;
                delete d.original;
                persist();
                render();
              },
              { disabled: blocked },
            ),
          );
        } else {
          actions.append(
            button(
              "编辑",
              () => {
                d.editing = true;
                d.edit = entry.comment;
                d.original = entry.comment;
                persist();
                render();
              },
              { disabled: blocked },
            ),
            button(
              entry.status === "resolved" ? "重新打开" : "标记完成",
              () =>
                execute(entry, "status", {
                  kind: "status",
                  status: entry.status === "resolved" ? "open" : "resolved",
                  previousStatus: entry.status,
                }),
              { disabled: blocked },
            ),
          );
        }
        item.append(actions);
        const replies = node("ul", undefined, "comment-replies");
        replies.setAttribute("aria-label", "回复历史");
        for (const r of entry.replies ?? []) {
          const row = node("li", undefined, "comment-reply");
          row.dataset.replyAuthor = r.author;
          row.append(
            node("strong", r.author === "agent" ? "Agent" : "用户"),
            node("p", r.body),
            node("time", time(r.createdAt)),
          );
          replies.append(row);
        }
        item.append(replies);
        if (!d.editing) {
          item.append(
            textarea("reply", "回复评论", d.reply),
            button(
              "发送回复",
              () => {
                if (d.reply?.trim())
                  execute(
                    entry,
                    "reply",
                    { body: d.reply.trim(), author: "user" },
                    "reply",
                  );
              },
              { disabled: blocked },
            ),
          );
        }
        const notice = node(
          "small",
          d.busy ? "正在保存到本机…" : (d.notice ?? ""),
          "comment-notice",
        );
        notice.setAttribute("role", "status");
        item.append(notice);
        return item;
      }),
    );
    $(".rail-scroll").scrollTop = scroll;
    if (focus) {
      const target = [
        ...shadow.querySelectorAll("textarea[data-draft-kind]"),
      ].find(
        (el) =>
          el.dataset.entryId === focus.id &&
          el.dataset.draftKind === focus.kind,
      );
      target?.focus({ preventScroll: true });
      target?.setSelectionRange(focus.start, focus.end);
    }
  };
  for (const d of Object.values(drafts)) d.busy = false;
  return {
    render,
    expand(id) {
      expandedId = id;
      const processing = getProcessing();
      workView = {
        batchId: processing.batch?.id,
        tab: ["queued", "running"].includes(processing.tasks[id]?.state)
          ? "processing"
          : "pending",
      };
      status =
        getDocument().entries.find((entry) => entry.id === id)?.status ??
        "open";
      persist();
      render();
    },
    addSelection(id, selection, source) {
      const entry = getDocument().entries.find((e) => e.id === id);
      if (!entry) return;
      expandedId = id;
      const processing = getProcessing();
      workView = {
        batchId: processing.batch?.id,
        tab: ["queued", "running"].includes(processing.tasks[id]?.state)
          ? "processing"
          : "pending",
      };
      status =
        getDocument().entries.find((entry) => entry.id === id)?.status ??
        "open";
      const d = draft(id);
      d.selection = { selection, source };
      persist();
      return execute(entry, "selection", {
        kind: "selection",
        selection,
        source,
      });
    },
  };
}
