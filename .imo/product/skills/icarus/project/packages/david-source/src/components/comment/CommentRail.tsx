import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type DavidFeedbackDecision,
  type DavidFeedbackEntry,
  type DavidFeedbackEntryStatus,
} from "../../lib/davidFeedback";
import "../CommentRail.css";
import { CommentItem } from "./CommentItem";
import { entryStatus, commentReviewState } from "./commentHelpers";
import type { CommentRailProps, ExitingEntry, StatusTab } from "./types";

/**
 * Comment rail orchestrator: owns filter/expand/draft/exit-animation state
 * and renders the header tabs plus the filtered entry list. Row rendering is
 * delegated to CommentItem; pure scope/origin helpers live in
 * commentHelpers. User and Agent entries share one list; badges identify origin.
 */
export function CommentRail({
  processingTasks,
  processingBatch,
  supportsProcessingStatus,
  onDelete,
  onRemoveSelection,
  entries,
  loading = false,
  onLocate,
  onAddSelection,
  onLocateSelection,
  onReply,
  onStatusChange,
  onEdit,
  onDecision,
  locateMissedEntryId,
}: CommentRailProps) {
  const [workView, setWorkView] = useState<"pending" | "processing">();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  const [replyDraft, setReplyDraft] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [exiting, setExiting] = useState<
    Readonly<Record<string, ExitingEntry>>
  >({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const readingAnchor = useRef<
    | {
        id: string;
        element: HTMLElement;
        top: number;
        tab: string;
        entries: typeof entries;
        tasks: typeof processingTasks;
      }
    | undefined
  >(undefined);
  const exitTimers = useRef<Record<string, number>>({});
  const draftRef = useRef({ reply: replyDraft, edit: editDraft });
  useLayoutEffect(() => {
    draftRef.current = { reply: replyDraft, edit: editDraft };
  }, [replyDraft, editDraft]);

  const clearExiting = useCallback((entryId: string) => {
    const timer = exitTimers.current[entryId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete exitTimers.current[entryId];
    }
    setExiting((current) => {
      if (!current[entryId]) return current;
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    setExpandedId((current) => (current === entryId ? undefined : current));
  }, []);

  useEffect(
    () => () => {
      Object.values(exitTimers.current).forEach((timer) =>
        window.clearTimeout(timer),
      );
      exitTimers.current = {};
    },
    [],
  );

  // First paint reserves the pending rail; a confirmed empty list releases it.
  useLayoutEffect(() => {
    const hasEntries = entries.length > 0 || loading;
    document.body.classList.toggle(
      "comment-rail-open",
      hasEntries && !collapsed,
    );
    document.body.classList.toggle(
      "comment-rail-collapsed",
      hasEntries && collapsed,
    );
    return () => {
      document.body.classList.remove("comment-rail-open");
      document.body.classList.remove("comment-rail-collapsed");
    };
  }, [collapsed, entries.length, loading]);

  const sorted = useMemo(() => {
    const pending = (entry: DavidFeedbackEntry) =>
      commentReviewState(entry, processingTasks?.[entry.id]) === "pending";
    const handledAt = (entry: DavidFeedbackEntry) =>
      processingTasks?.[entry.id]?.finishedAt ??
      entry.replies?.filter((reply) => reply.author === "agent").at(-1)
        ?.createdAt ??
      entry.createdAt;
    return [...entries].sort(
      (a, b) =>
        Number(pending(b)) - Number(pending(a)) ||
        (pending(a) ? handledAt(b).localeCompare(handledAt(a)) : 0) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }, [entries, processingTasks]);
  const isProcessing = (entryId: string) =>
    ["queued", "running"].includes(processingTasks?.[entryId]?.state ?? "");
  const processingCount = entries.filter(
    (entry) => entryStatus(entry) === "open" && isProcessing(entry.id),
  ).length;
  const workTab = workView ?? (processingCount ? "processing" : "pending");
  const displayedItems = sorted.filter((entry) => {
    if (exiting[entry.id]?.from === statusTab) return true;
    if (entryStatus(entry) !== statusTab) return false;
    // A background task update must not remove the row being read or edited.
    if (entry.id === expandedId) return true;
    return (
      statusTab !== "open" ||
      (workTab === "processing"
        ? isProcessing(entry.id)
        : !isProcessing(entry.id))
    );
  });
  const openCount = entries.filter(
    (entry) => entryStatus(entry) !== "resolved",
  ).length;
  const rememberReadingPosition = () => {
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    const focused =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest("[data-feedback-id]")
        ? document.activeElement
        : undefined;
    const row =
      focused && list.contains(focused)
        ? focused
        : [...list.querySelectorAll<HTMLElement>("[data-feedback-id]")].find(
            (element) => element.getBoundingClientRect().bottom > top,
          );
    readingAnchor.current = row
      ? {
          id: row.closest<HTMLElement>("[data-feedback-id]")!.dataset
            .feedbackId!,
          element: row,
          top: row.getBoundingClientRect().top - top,
          tab: `${statusTab}/${workTab}`,
          entries,
          tasks: processingTasks,
        }
      : undefined;
  };
  useLayoutEffect(() => {
    const previous = readingAnchor.current;
    const list = listRef.current;
    if (
      list &&
      previous &&
      previous.tab === `${statusTab}/${workTab}` &&
      (previous.entries !== entries || previous.tasks !== processingTasks)
    ) {
      const row = list.contains(previous.element)
        ? previous.element
        : rowRefs.current[previous.id];
      if (row && list.contains(row))
        list.scrollTop +=
          row.getBoundingClientRect().top -
          list.getBoundingClientRect().top -
          previous.top;
    }
    rememberReadingPosition();
  });

  if (entries.length === 0 && !loading) return null;

  const leavePendingAfterSave = (entry: DavidFeedbackEntry) => {
    if (
      workTab !== "pending" ||
      !processingBatch ||
      !["queued", "running"].includes(processingBatch.state)
    )
      return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearExiting(entry.id);
      return;
    }
    const height = rowRefs.current[entry.id]?.offsetHeight ?? 0;
    if (exitTimers.current[entry.id] !== undefined)
      window.clearTimeout(exitTimers.current[entry.id]);
    exitTimers.current[entry.id] = window.setTimeout(
      () => clearExiting(entry.id),
      380,
    );
    setExiting((current) => ({
      ...current,
      [entry.id]: { from: statusTab, height },
    }));
  };

  const submitReply = async (entry: DavidFeedbackEntry) => {
    const submitted = replyDraft;
    const body = replyDraft.trim();
    if (!body) return;
    try {
      await onReply(entry.id, body);
      if (draftRef.current.reply === submitted) {
        setReplyDraft("");
        leavePendingAfterSave(entry);
      }
      setActionError(undefined);
    } catch (error) {
      // 存储失败：保留草稿并提示，不制造假成功。
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const submitEdit = async (entry: DavidFeedbackEntry) => {
    const submitted = editDraft;
    const suggestion = editDraft.trim();
    if (!suggestion) return;
    try {
      await onEdit(entry.id, suggestion);
      if (draftRef.current.edit === submitted) {
        setEditingId(undefined);
        setEditDraft("");
        leavePendingAfterSave(entry);
      }
      setActionError(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const startEdit = (entry: DavidFeedbackEntry) => {
    setEditingId(entry.id);
    setEditDraft(entry.suggestion);
    setActionError(undefined);
  };

  /**
   * agent 提议的采纳决议。与 status 正交：采纳/否决只表达用户的 review 结论，
   * 不自动改变 open/resolved——是否解决由后续实际改动决定。
   * 再次点击同一决议视为撤销，回到未 review 状态。
   */
  const submitDecision = async (
    entry: DavidFeedbackEntry,
    decision: DavidFeedbackDecision,
  ) => {
    if (!onDecision) return;
    try {
      await onDecision(entry.id, decision);
      setActionError(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleStatus = async (entry: DavidFeedbackEntry) => {
    if (exiting[entry.id]) return;
    const from = entryStatus(entry);
    const to: DavidFeedbackEntryStatus =
      from === "resolved" ? "open" : "resolved";
    const row = rowRefs.current[entry.id];
    const height = row?.offsetHeight ?? 0;
    try {
      await onStatusChange(entry.id, to);
      setActionError(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearExiting(entry.id);
      return;
    }
    const timer = window.setTimeout(() => clearExiting(entry.id), 380);
    exitTimers.current[entry.id] = timer;
    setExiting((current) => ({
      ...current,
      [entry.id]: { from, height },
    }));
  };

  const toggle = (
    <button
      type="button"
      className={`comment-rail-toggle${collapsed ? " is-collapsed" : ""}`}
      onClick={() => setCollapsed((current) => !current)}
      data-david-shell="comment-rail"
      aria-label={collapsed ? "展开反馈列表" : "折叠反馈列表"}
      aria-expanded={!collapsed}
    >
      {collapsed ? "◀" : "▶"}
      {collapsed && entries.length > 0 && (
        <span className="comment-rail-badge" aria-hidden="true">
          {openCount}
        </span>
      )}
    </button>
  );

  return (
    <aside
      className={"comment-rail " + (collapsed ? "is-collapsed" : "")}
      aria-label="反馈列表"
      aria-busy={loading}
    >
      <div className="comment-rail-header">
        <div
          className="comment-rail-header-content"
          aria-hidden={collapsed}
          inert={collapsed ? true : undefined}
        >
          <span className="comment-rail-count" aria-live="polite">
            {loading ? "正在读取评论…" : `${openCount} 条未解决`}
          </span>
          <div
            className="comment-rail-status-tabs"
            role="group"
            aria-label="反馈状态"
          >
            <button
              type="button"
              className={statusTab === "open" ? "is-active" : ""}
              onClick={() => setStatusTab("open")}
              aria-pressed={statusTab === "open"}
            >
              未解决
            </button>
            <button
              type="button"
              className={statusTab === "resolved" ? "is-active" : ""}
              onClick={() => setStatusTab("resolved")}
              aria-pressed={statusTab === "resolved"}
            >
              已解决
            </button>
          </div>
          <div
            className="comment-rail-mode"
            role="group"
            aria-label="反馈列表模式"
          >
            {statusTab === "open" && supportsProcessingStatus ? (
              <>
                <button
                  type="button"
                  aria-label="待处理"
                  className={workTab === "pending" ? "is-active" : ""}
                  aria-pressed={workTab === "pending"}
                  onClick={() => setWorkView("pending")}
                >
                  待处理
                </button>
                <button
                  type="button"
                  aria-label="处理中"
                  className={workTab === "processing" ? "is-active" : ""}
                  aria-pressed={workTab === "processing"}
                  onClick={() => setWorkView("processing")}
                >
                  处理中 {processingCount}
                </button>
              </>
            ) : (
              <button type="button" className="is-active" aria-pressed="true">
                全部
              </button>
            )}
          </div>
        </div>
        {typeof document === "undefined"
          ? toggle
          : createPortal(toggle, document.body)}
      </div>
      <div
        ref={listRef}
        onScroll={rememberReadingPosition}
        onFocusCapture={rememberReadingPosition}
        className="comment-rail-list is-mode-all"
        role="list"
        aria-label="反馈条目"
        aria-hidden={collapsed}
        inert={collapsed ? true : undefined}
        tabIndex={collapsed ? -1 : 0}
      >
        {displayedItems.length === 0 ? (
          <p className="comment-rail-empty" role="status">
            {loading
              ? "评论加载后会显示在这里"
              : statusTab === "resolved"
                ? "暂无已解决反馈"
                : "暂无反馈"}
          </p>
        ) : (
          displayedItems.map((entry) => {
            const status = entryStatus(entry);
            const exit = exiting[entry.id];
            const isExiting = Boolean(exit && exit.from === statusTab);
            const expanded = expandedId === entry.id;
            return (
              <CommentItem
                key={entry.id}
                entry={entry}
                processingTask={processingTasks?.[entry.id]}
                status={status}
                expanded={expanded}
                isExiting={isExiting}
                exitHeight={exit?.height}
                missed={locateMissedEntryId === entry.id}
                actionError={actionError}
                isEditing={editingId === entry.id}
                editDraft={editDraft}
                replyDraft={replyDraft}
                showDecision={Boolean(onDecision)}
                registerRow={(node) => {
                  rowRefs.current[entry.id] = node;
                }}
                onToggle={() => {
                  setWorkView(workTab);
                  if (!expanded) onLocate(entry);
                  setExpandedId(expanded ? undefined : entry.id);
                  setReplyDraft("");
                  setEditingId(undefined);
                  setActionError(undefined);
                }}
                onLocate={() => onLocate(entry)}
                onAddSelection={
                  onAddSelection ? () => onAddSelection(entry.id) : undefined
                }
                onLocateSelection={(index) => onLocateSelection?.(entry, index)}
                onDelete={
                  onDelete
                    ? async () => {
                        try {
                          await onDelete(entry.id);
                          setActionError(undefined);
                        } catch (error) {
                          setActionError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          );
                        }
                      }
                    : undefined
                }
                onRemoveSelection={
                  onRemoveSelection
                    ? async (index) => {
                        try {
                          await onRemoveSelection(entry, index);
                          setActionError(undefined);
                        } catch (error) {
                          setActionError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          );
                        }
                      }
                    : undefined
                }
                onStartEdit={() => startEdit(entry)}
                onEditDraftChange={setEditDraft}
                onSubmitEdit={() => void submitEdit(entry)}
                onCancelEdit={() => {
                  setEditingId(undefined);
                  setEditDraft("");
                }}
                onDecision={(decision) => void submitDecision(entry, decision)}
                onToggleStatus={() => void toggleStatus(entry)}
                onReplyDraftChange={setReplyDraft}
                onSubmitReply={() => void submitReply(entry)}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}
