import type { FeedbackTask } from "../../lib/feedbackTransport";
import "./feedback-task.css";

/** Per-item status follows Agent claims; the page does not initiate processing. */
export function FeedbackTaskControl({ task }: { task?: FeedbackTask }) {
  if (!task || task.state === "done" || task.state === "cancelled") return null;
  const running = task.state === "running",
    queued = task.state === "queued";
  return (
    <div
      key={`${task.id}:${task.state}`}
      className="comment-rail-processing"
      data-processing-state={task.state}
    >
      {(running || queued) && (
        <span
          role="status"
          aria-label={running ? "正在处理" : "排队中"}
          className={
            running ? "comment-task-icon is-running" : "comment-task-icon"
          }
        >
          <svg
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle
              cx="10"
              cy="10"
              r="7"
              strokeDasharray={running ? "30 14" : undefined}
            />
            {!running && <path d="M10 5v5l3 2" />}
          </svg>
          <span>{running ? "正在处理" : "排队中"}</span>
        </span>
      )}
      {task.hasNewInput && <small>有新意见待下一轮处理</small>}
      {task.state === "failed" && (
        <small>{task.message || "处理失败，可重新处理"}</small>
      )}
    </div>
  );
}
