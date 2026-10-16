import { useCallback, useState } from "react";
import { readResolvedIds, writeResolvedIds } from "./resolvedStorage";

/**
 * Viewer-local resolved state for a review's open questions. State is keyed
 * by slug and re-read when the imported review changes (same pattern as the
 * bridge flag in AppHeader). A failed write keeps the previous state so the
 * toggle cannot drift away from what was actually persisted.
 */
export function useResolvedQuestions(slug: string): {
  resolvedIds: string[];
  setQuestionResolved: (id: string, resolved: boolean) => void;
} {
  const [resolvedIds, setResolvedIds] = useState<string[]>(() =>
    readResolvedIds(slug),
  );
  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setResolvedIds(readResolvedIds(slug));
  }

  const setQuestionResolved = useCallback(
    (id: string, resolved: boolean) => {
      setResolvedIds((current) => {
        const next = resolved
          ? current.includes(id)
            ? current
            : [...current, id]
          : current.filter((item) => item !== id);
        // Storage failure: stay on the persisted state instead of showing a
        // resolution that a reload would lose.
        return writeResolvedIds(slug, next) ? next : current;
      });
    },
    [slug],
  );

  return { resolvedIds, setQuestionResolved };
}
