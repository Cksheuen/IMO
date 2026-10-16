import {
  createFeedbackDocument,
  parseFeedback,
  type DavidFeedbackEntry,
} from "../../lib/davidFeedback";

// One unsubmitted composer draft per review. This is never a submitted feedback source.
const key = (slug: string) => `david:${slug}:composer-draft:v1`;
export function readFeedbackDraft(
  slug: string,
): DavidFeedbackEntry | undefined {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw || raw.length > 500_000) return;
    const doc = parseFeedback(JSON.parse(raw));
    if (doc.slug === slug && doc.entries.length === 1) return doc.entries[0];
  } catch {
    /* Unavailable storage or an invalid draft must not block commenting. */
  }
}
export function saveFeedbackDraft(slug: string, entry?: DavidFeedbackEntry) {
  try {
    if (!entry?.suggestion.trim()) localStorage.removeItem(key(slug));
    else
      localStorage.setItem(
        key(slug),
        JSON.stringify(createFeedbackDocument(slug, [entry])),
      );
    return true;
  } catch {
    return false;
  }
}
