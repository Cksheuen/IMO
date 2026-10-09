import type { OpenQuestion } from "../../types/review";
import { Modal } from "../ui/Modal";
import { IconButton } from "../ui/IconButton";
import { QuestionCard } from "./QuestionCard";
import "./open-questions.css";

export type OpenQuestionsPanelContentProps = {
  questions: OpenQuestion[];
  /** Viewer-local resolved id set (localStorage, see useResolvedQuestions). */
  resolvedIds: readonly string[];
  onToggleResolved: (id: string, resolved: boolean) => void;
  onClose: () => void;
};

/**
 * Panel body without the Modal shell. Extracted so the markup is renderable
 * on the server (createPortal is client-only); OpenQuestionsPanel wraps it
 * in the shared ui/Modal.
 */
export function OpenQuestionsPanelContent({
  questions,
  resolvedIds,
  onToggleResolved,
  onClose,
}: OpenQuestionsPanelContentProps): React.JSX.Element {
  const resolvedSet = new Set(resolvedIds);
  let resolvedCount = 0;
  for (const question of questions) {
    if (question.status === "resolved" || resolvedSet.has(question.id)) {
      resolvedCount += 1;
    }
  }
  const openCount = questions.length - resolvedCount;

  return (
    <section className="dv-oq-panel" aria-label="待澄清问题">
      <header className="dv-oq-header">
        <h2 id="dv-oq-title" className="dv-oq-title">
          {`待澄清问题（${openCount} open / ${resolvedCount} 已澄清）`}
        </h2>
        <IconButton label="关闭待澄清面板" onClick={onClose}>
          ✕
        </IconButton>
      </header>
      <div className="dv-oq-list">
        {questions.map((question) => {
          const specResolved = question.status === "resolved";
          const resolved = specResolved || resolvedSet.has(question.id);
          return (
            <QuestionCard
              key={question.id}
              question={question}
              resolved={resolved}
              viewerControllable={!specResolved}
              onToggleResolved={(value) => onToggleResolved(question.id, value)}
            />
          );
        })}
      </div>
    </section>
  );
}

export type OpenQuestionsPanelProps = {
  open: boolean;
  onClose: () => void;
  questions?: OpenQuestion[];
  /** Viewer-local resolved id set (localStorage, see useResolvedQuestions). */
  resolvedIds: readonly string[];
  onToggleResolved: (id: string, resolved: boolean) => void;
};

/**
 * Near-fullscreen panel for the top-level data.openQuestions list. Rendered
 * through the shared ui/Modal (body portal, Esc/backdrop close, focus trap);
 * the overview stays mounted and inert while the panel is open.
 *
 * Returns null entirely when there are no questions, so callers can mount
 * the panel unconditionally.
 */
export function OpenQuestionsPanel({
  open,
  onClose,
  questions,
  resolvedIds,
  onToggleResolved,
}: OpenQuestionsPanelProps): React.JSX.Element | null {
  if (!questions || questions.length === 0) return null;

  return (
    <Modal open={open} onClose={onClose} labelledBy="dv-oq-title" wide>
      <OpenQuestionsPanelContent
        questions={questions}
        resolvedIds={resolvedIds}
        onToggleResolved={onToggleResolved}
        onClose={onClose}
      />
    </Modal>
  );
}
