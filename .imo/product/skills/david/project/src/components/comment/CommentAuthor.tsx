import type { DavidFeedbackReplyAuthor } from "../../lib/davidFeedback";

/**
 * Structured author marker for comments and replies (HARD-GATE 26):
 * agent replies are visually distinguished from the user's own comments in
 * both collapsed and expanded states; the badge replaces any text prefix.
 * `labeled` adds the accessible "Agent 回复/我的回复" name for reply history
 * rows; the compact row header badge stays decorative.
 */
export function CommentAuthor({
  author,
  className,
  labeled = true,
}: {
  author: DavidFeedbackReplyAuthor;
  className?: string;
  labeled?: boolean;
}) {
  const label = author === "agent" ? "Agent" : "我";
  return (
    <span
      className={className}
      aria-label={
        labeled ? (author === "agent" ? "Agent 回复" : "我的回复") : undefined
      }
    >
      {label}
    </span>
  );
}
