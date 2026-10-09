import type { FeedbackTask, FeedbackBatch } from "../../lib/feedbackTransport";
import type {
  DavidFeedbackDecision,
  DavidFeedbackEntry,
  DavidFeedbackEntryStatus,
} from "../../lib/davidFeedback";

export type RailMode = "viewport" | "all";
export type StatusTab = DavidFeedbackEntryStatus;

export type ExitingEntry = {
  from: StatusTab;
  height: number;
};

export type CommentRailProps = {
  entries: DavidFeedbackEntry[];
  processingTasks?: Record<string, FeedbackTask>;
  processingBatch?: FeedbackBatch;
  supportsProcessingStatus?: boolean;
  /** Reserve the default rail while the first service snapshot is pending. */
  loading?: boolean;
  currentPageId?: string;
  activeComponentId?: string;
  activeNodeId?: string;
  displayNodeId?: string;
  onDelete?: (entryId: string) => void | Promise<void>;
  onRemoveSelection?: (
    entry: DavidFeedbackEntry,
    index: number,
  ) => void | Promise<void>;
  onLocate: (entry: DavidFeedbackEntry) => void;
  onAddSelection?: (entryId: string) => void;
  onLocateSelection?: (entry: DavidFeedbackEntry, index: number) => void;
  onReply: (entryId: string, body: string) => void | Promise<void>;
  onStatusChange: (
    entryId: string,
    status: DavidFeedbackEntryStatus,
  ) => void | Promise<void>;
  onEdit: (entryId: string, suggestion: string) => void | Promise<void>;
  /** agent 提议的采纳决议；未提供时不渲染采纳/不采纳操作。 */
  onDecision?: (
    entryId: string,
    decision: DavidFeedbackDecision,
  ) => void | Promise<void>;
  /** 定位后确认目标已失效的条目 id（由 App 定位流程回填） */
  locateMissedEntryId?: string;
};
