import { useState } from "react";
import type { OpenQuestion } from "../../types/review";
import { Chip } from "../ui/Chip";

export type QuestionCardProps = {
  question: OpenQuestion;
  /** Effective resolved state: spec status or the viewer's local override. */
  resolved: boolean;
  /**
   * false for questions already marked resolved in the data source — their
   * state cannot be toggled by the per-viewer localStorage override.
   */
  viewerControllable: boolean;
  onToggleResolved: (resolved: boolean) => void;
};

/**
 * One open-question card: PRD vs design comparison, the conflict statement,
 * locally-selectable candidate options, and a recommendation block styled
 * to read as a suggestion rather than a fact. Option selection is purely
 * local visual state; it is never persisted.
 */
export function QuestionCard({
  question,
  resolved,
  viewerControllable,
  onToggleResolved,
}: QuestionCardProps): React.JSX.Element {
  const [selectedOption, setSelectedOption] = useState<number | undefined>(
    undefined,
  );

  const hasComparison = Boolean(question.prd || question.design);

  return (
    <article
      className={`dv-oq-card${resolved ? " dv-oq-card--resolved" : ""}`}
      data-testid={`dv-oq-card-${question.id}`}
    >
      <header className="dv-oq-card-head">
        <h3 className="dv-oq-topic">{question.topic}</h3>
        {resolved ? (
          <Chip tone="success">已澄清</Chip>
        ) : (
          <Chip tone="gold">待澄清</Chip>
        )}
      </header>

      {hasComparison && (
        <div className="dv-oq-compare">
          <section className="dv-oq-source" data-testid="dv-oq-prd">
            <div className="dv-oq-source-label">PRD</div>
            {question.prdRef && (
              <div className="dv-oq-source-ref">{question.prdRef}</div>
            )}
            {question.prd && (
              <p className="dv-oq-source-text">{question.prd}</p>
            )}
          </section>
          <section className="dv-oq-source" data-testid="dv-oq-design">
            <div className="dv-oq-source-label">设计稿</div>
            {question.designRef && (
              <div className="dv-oq-source-ref">{question.designRef}</div>
            )}
            {question.design && (
              <p className="dv-oq-source-text">{question.design}</p>
            )}
          </section>
        </div>
      )}

      {question.conflict && (
        <section className="dv-oq-conflict" data-testid="dv-oq-conflict">
          <div className="dv-oq-conflict-label">冲突 / 不确定点</div>
          <p className="dv-oq-conflict-text">{question.conflict}</p>
        </section>
      )}

      {question.options && question.options.length > 0 && (
        <section className="dv-oq-options-block">
          <div className="dv-oq-options-label">候选方案（点选仅本地标记）</div>
          <ul className="dv-oq-options">
            {question.options.map((option, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="dv-oq-option"
                  aria-pressed={selectedOption === index}
                  onClick={() =>
                    setSelectedOption((current) =>
                      current === index ? undefined : index,
                    )
                  }
                >
                  <span className="dv-oq-option-marker" aria-hidden="true">
                    {selectedOption === index ? "●" : "○"}
                  </span>
                  <span className="dv-oq-option-text">{option}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {question.recommendation && (
        <aside className="dv-oq-recommend" data-testid="dv-oq-recommend">
          <div className="dv-oq-recommend-label">建议</div>
          <p className="dv-oq-recommend-text">{question.recommendation}</p>
        </aside>
      )}

      {viewerControllable && (
        <footer className="dv-oq-card-footer">
          <button
            type="button"
            className="dv-oq-toggle"
            data-testid={`dv-oq-toggle-${question.id}`}
            onClick={() => onToggleResolved(!resolved)}
          >
            {resolved ? "重新打开" : "标记为已澄清"}
          </button>
        </footer>
      )}
    </article>
  );
}
