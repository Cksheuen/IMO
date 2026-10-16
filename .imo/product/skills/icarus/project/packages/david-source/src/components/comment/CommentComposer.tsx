/**
 * Reply composer (textarea + submit) shown at the bottom of an expanded
 * comment thread. Controlled by the parent rail so a single draft survives
 * expand/collapse switches.
 */
export function CommentComposer({
  draft,
  onChange,
  onSubmit,
}: {
  draft: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <textarea
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        placeholder="回复这条反馈…"
        rows={2}
        aria-label="回复反馈"
      />
      <button
        type="button"
        className="comment-rail-reply"
        onClick={onSubmit}
        disabled={!draft.trim()}
      >
        回复
      </button>
    </>
  );
}
