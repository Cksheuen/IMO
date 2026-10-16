import { FeedbackTaskControl } from "./FeedbackTaskControl";
import type { FeedbackTask } from "../../lib/feedbackTransport";
import { useState, type CSSProperties } from "react";
import type {
  DavidFeedbackDecision,
  DavidFeedbackEntry,
} from "../../lib/davidFeedback";
import { replyAuthor } from "../../lib/davidFeedback";
import {
  FEEDBACK_CATEGORY_LABELS,
  commentReviewState,
  entryOrigin,
  scopeDescription,
} from "./commentHelpers";
import type { StatusTab } from "./types";
import { CommentAuthor } from "./CommentAuthor";
import { CommentComposer } from "./CommentComposer";
import { SelectionList } from "../feedback/SelectionList";
import { feedbackSelections } from "../../lib/davidFeedback";

export type CommentItemProps = {
  entry: DavidFeedbackEntry;
  processingTask?: FeedbackTask;
  status: StatusTab;
  expanded: boolean;
  isExiting: boolean;
  exitHeight?: number;
  missed: boolean;
  actionError: string | undefined;
  isEditing: boolean;
  editDraft: string;
  replyDraft: string;
  showDecision: boolean;
  registerRow: (node: HTMLDivElement | null) => void;
  onDelete?: () => void | Promise<void>;
  onRemoveSelection?: (index: number) => void | Promise<void>;
  onToggle: () => void;
  onLocate: () => void;
  onAddSelection?: () => void;
  onLocateSelection?: (index: number) => void;
  onStartEdit: () => void;
  onEditDraftChange: (value: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
  onDecision: (decision: DavidFeedbackDecision) => void;
  onToggleStatus: () => void;
  onReplyDraftChange: (value: string) => void;
  onSubmitReply: () => void;
};

/**
 * Single feedback row: collapsed preview (nav button with latest reply) and
 * expanded thread (scope, actions, reply history, composer). DOM structure,
 * class names and data attributes are preserved from the original rail.
 */
export function CommentItem({
  processingTask,
  onDelete,
  onRemoveSelection,
  entry,
  status,
  expanded,
  isExiting,
  exitHeight,
  missed,
  actionError,
  isEditing,
  editDraft,
  replyDraft,
  showDecision,
  registerRow,
  onToggle,
  onLocate,
  onAddSelection,
  onLocateSelection,
  onStartEdit,
  onEditDraftChange,
  onSubmitEdit,
  onCancelEdit,
  onDecision,
  onToggleStatus,
  onReplyDraftChange,
  onSubmitReply,
}: CommentItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reviewState = commentReviewState(entry, processingTask);
  const replies = entry.replies ?? [];
  const agentReplyCount = replies.filter(
    (reply) => replyAuthor(reply) === "agent",
  ).length;
  const latestReply =
    replies.length > 0 ? replies[replies.length - 1] : undefined;
  const latestReplyAuthor = latestReply ? replyAuthor(latestReply) : undefined;

  return (
    <div
      className={
        "comment-rail-row " +
        (expanded ? "is-expanded " : "") +
        (status === "resolved" ? "is-resolved " : "") +
        (isExiting ? "is-exiting" : "")
      }
      role="listitem"
      inert={isExiting ? true : undefined}
      aria-hidden={isExiting || undefined}
      data-feedback-id={entry.id}
      data-feedback-status={status}
      data-processing-state={processingTask?.state ?? "idle"}
      ref={registerRow}
      style={
        isExiting
          ? ({
              "--exit-height": `${exitHeight ?? 0}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="comment-rail-item">
        <button
          type="button"
          className="comment-rail-nav"
          onClick={(event) => {
            const selection = window.getSelection();
            // Finishing a text selection is not a navigation/expand action.
            if (
              event.detail > 0 &&
              selection &&
              !selection.isCollapsed &&
              selection.anchorNode &&
              event.currentTarget.contains(selection.anchorNode)
            )
              return;
            onToggle();
          }}
          aria-label={`反馈：${entry.suggestion.slice(0, 40)}`}
          aria-expanded={expanded}
        >
          <span className="comment-rail-indicator" />
          <CommentAuthor
            author={entryOrigin(entry)}
            className="comment-rail-author-badge"
            labeled={false}
          />
          <span className="comment-rail-kind">
            {FEEDBACK_CATEGORY_LABELS[entry.category]} · {replies.length} 回复
            {agentReplyCount > 0 ? ` · ${agentReplyCount} 来自 Agent` : ""}
          </span>
          <span className={"comment-rail-status is-" + status}>
            {status === "resolved" ? "已解决" : "未解决"}
          </span>
          <span
            className={`comment-rail-review-state is-${reviewState}`}
            data-review-status={reviewState}
            title="Agent 完成当前版本后待审阅；新增意见会进入下一轮。"
          >
            {processingTask?.hasNewInput
              ? "有新意见待处理"
              : reviewState === "pending"
                ? "待审阅"
                : reviewState === "commented"
                  ? "待处理"
                  : "已确认"}
          </span>
          <span className="comment-rail-label">{entry.suggestion}</span>
          <time className="comment-rail-time">
            {new Date(entry.createdAt).toLocaleString("zh-CN")}
          </time>
          {!expanded && latestReply && (
            <span className="comment-rail-latest-reply">
              <span className="comment-rail-latest-reply-label">最新回复</span>
              <span>
                {latestReplyAuthor && (
                  <CommentAuthor
                    author={latestReplyAuthor}
                    className="comment-rail-reply-author"
                  />
                )}
                {latestReply.body}
              </span>
            </span>
          )}
        </button>
        {(status === "open" || processingTask?.state === "running") && (
          <FeedbackTaskControl task={processingTask} />
        )}
        {expanded && (
          <div className="comment-rail-thread">
            <p className="comment-rail-scope">{scopeDescription(entry)}</p>
            <SelectionList
              selections={feedbackSelections(entry.scope)}
              onAdd={onAddSelection}
              onRemove={onRemoveSelection}
              onLocate={(selection) =>
                onLocateSelection?.(
                  feedbackSelections(entry.scope).indexOf(selection),
                )
              }
            />
            {missed && (
              <p className="comment-rail-missed" role="status">
                原框选区域缺少稳定锚点或已变更
              </p>
            )}
            {actionError && (
              <p className="comment-rail-error" role="alert">
                操作未保存：{actionError}
              </p>
            )}
            {isEditing ? (
              <div className="comment-rail-edit">
                <textarea
                  value={editDraft}
                  onChange={(event) => onEditDraftChange(event.target.value)}
                  rows={4}
                  aria-label="编辑反馈建议"
                />
                <div className="comment-rail-actions">
                  <button
                    type="button"
                    className="comment-rail-action is-status"
                    onClick={onSubmitEdit}
                    disabled={!editDraft.trim()}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="comment-rail-action"
                    onClick={onCancelEdit}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : confirmDelete && onDelete ? (
              <div
                className="comment-rail-delete-confirm"
                role="group"
                aria-label="删除评论确认"
              >
                <p>删除这条评论？</p>
                <div className="comment-rail-actions">
                  <button
                    type="button"
                    className="comment-rail-action"
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消删除
                  </button>
                  <button
                    type="button"
                    className="comment-rail-action is-status"
                    onClick={async () => {
                      await onDelete();
                      setConfirmDelete(false);
                    }}
                  >
                    确认删除评论
                  </button>
                </div>
              </div>
            ) : (
              <div className="comment-rail-actions">
                {onDelete && (
                  <button
                    type="button"
                    className="comment-rail-action"
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除评论
                  </button>
                )}
                {entry.scope && (
                  <button
                    type="button"
                    className="comment-rail-action"
                    onClick={onLocate}
                  >
                    定位
                  </button>
                )}
                <button
                  type="button"
                  className="comment-rail-action"
                  onClick={onStartEdit}
                >
                  编辑
                </button>
                {entryOrigin(entry) === "agent" && showDecision && (
                  <>
                    <button
                      type="button"
                      className="comment-rail-action is-accept"
                      onClick={() => onDecision("accepted")}
                      aria-pressed={entry.decision === "accepted"}
                      data-testid="comment-rail-accept"
                    >
                      {entry.decision === "accepted" ? "已采纳" : "采纳"}
                    </button>
                    <button
                      type="button"
                      className="comment-rail-action is-reject"
                      onClick={() => onDecision("rejected")}
                      aria-pressed={entry.decision === "rejected"}
                    >
                      {entry.decision === "rejected" ? "已否决" : "不采纳"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="comment-rail-action is-status"
                  onClick={onToggleStatus}
                >
                  {status === "resolved" ? "重新打开" : "标记解决"}
                </button>
              </div>
            )}
            {replies.length > 0 && (
              <ul className="comment-rail-history" aria-label="回复历史">
                {replies.map((reply) => {
                  const author = replyAuthor(reply);
                  return (
                    <li
                      key={reply.id}
                      className={"comment-rail-reply-item is-" + author}
                      data-reply-author={author}
                    >
                      <CommentAuthor
                        author={author}
                        className="comment-rail-reply-author"
                      />
                      <button
                        type="button"
                        className="comment-rail-reply-locate"
                        onClick={onLocate}
                      >
                        {reply.body}
                      </button>
                      <time>
                        {new Date(reply.createdAt).toLocaleString("zh-CN")}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
            {!isEditing && (
              <CommentComposer
                draft={replyDraft}
                onChange={onReplyDraftChange}
                onSubmit={onSubmitReply}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
