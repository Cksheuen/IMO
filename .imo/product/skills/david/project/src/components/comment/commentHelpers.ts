import type { FeedbackTask } from "../../lib/feedbackTransport";
import {
  resolveFeedbackTarget,
  replyAuthor,
  type DavidFeedbackCategory,
  type DavidFeedbackEntry,
  type DavidFeedbackEntryStatus,
  type DavidFeedbackOrigin,
} from "../../lib/davidFeedback";

export const FEEDBACK_CATEGORY_LABELS: Record<DavidFeedbackCategory, string> = {
  visual: "视觉",
  interaction: "交互",
  content: "内容",
  schema: "结构",
  other: "其他",
};

export const SURFACE_LABELS: Record<string, string> = {
  page: "页面",
  overview: "概览",
  inspector: "检查器",
  dock: "停靠栏",
  shell: "外壳",
  "rich-detail": "详情",
};

export const scopeDescription = (entry: DavidFeedbackEntry): string => {
  const scope = entry.scope;
  if (!scope) return "未定位反馈（无 scope）";
  const parts: string[] = [];
  if (scope.selection) {
    parts.push(
      SURFACE_LABELS[scope.selection.surface] ?? scope.selection.surface,
    );
  }
  if (scope.pageId) parts.push(`页面 ${scope.pageId}`);
  if (scope.nodePath && scope.nodePath.length > 0) {
    parts.push(scope.nodePath.join(" / "));
  }
  if (scope.targetId) parts.push(scope.targetId);
  return parts.length > 0 ? parts.join(" · ") : "未定位反馈（无 scope）";
};

export const entryStatus = (
  entry: DavidFeedbackEntry,
): DavidFeedbackEntryStatus =>
  entry.status === "resolved" ? "resolved" : "open";

/** 条目来源；缺省视为人写的评论，保证旧数据行为不变。 */
export const entryOrigin = (entry: DavidFeedbackEntry): DavidFeedbackOrigin =>
  entry.origin === "agent" ? "agent" : "user";

/**
 * “当前场景”模式：按 scope 与当前 page/component/node 一致解析。
 * - 无 scope 的反馈只在“全部”可见。
 * - pageId / componentId 不一致则不属于当前场景。
 * - 条目带节点级定位（nodePath 末项或 selection.scene.nodeId/displayNodeId）时，
 *   仅当当前查看的 active/display 节点命中其一才可见，避免节点 A 的反馈误显示在节点 B。
 */
export const entryMatchesScene = (
  entry: DavidFeedbackEntry,
  currentPageId?: string,
  activeComponentId?: string,
  activeNodeId?: string,
  displayNodeId?: string,
): boolean => {
  const target = resolveFeedbackTarget(entry.scope);
  if (!target) return false;
  const scene = entry.scope?.selection?.scene;
  const entryPageId = target.pageId;
  if (entryPageId && entryPageId !== currentPageId) return false;
  const entryComponentId = target.componentId;
  if (entryComponentId) {
    if (!activeComponentId || entryComponentId !== activeComponentId) {
      return false;
    }
  } else if (activeComponentId) {
    return false;
  }
  const entryNodeIds = [target.nodeId, scene?.displayNodeId].filter(
    (id): id is string => Boolean(id),
  );
  if (entryNodeIds.length > 0) {
    const currentNodeIds = [activeNodeId, displayNodeId].filter(
      (id): id is string => Boolean(id),
    );
    if (!entryNodeIds.some((id) => currentNodeIds.includes(id))) {
      return false;
    }
  }
  return true;
};

/** Latest handling round follows append order; client timestamps may be skewed. */
export function commentReviewState(
  entry: DavidFeedbackEntry,
  task?: FeedbackTask,
) {
  if (entryStatus(entry) === "resolved") return "confirmed" as const;
  if (
    task?.hasNewInput ||
    task?.state === "queued" ||
    task?.state === "running" ||
    task?.state === "failed" ||
    task?.state === "changed"
  )
    return "commented" as const;
  if (task?.state === "done") return "pending" as const;
  const replies = entry.replies ?? [];
  let lastAgent = -1;
  let lastUser = -1;
  replies.forEach((reply, index) => {
    if (replyAuthor(reply) === "agent") lastAgent = index;
    else lastUser = index;
  });
  if (lastUser > lastAgent || (lastAgent < 0 && entryOrigin(entry) === "user"))
    return "commented" as const;
  return "pending" as const;
}
