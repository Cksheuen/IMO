/**
 * Per-viewer resolved-state storage for open questions (HARD-GATE 12/25).
 * Local only: the resolved set never enters the feedback service, disk
 * artifacts, or any remote transport. Every localStorage access is wrapped
 * in try/catch — unavailable storage (private mode, sandboxed iframe, SSR)
 * degrades silently to "nothing resolved".
 */

const storageKey = (slug: string): string => `david:${slug}:resolved-questions`;

/** Read the stored resolved id array; garbage / unavailable storage yields []. */
export function readResolvedIds(slug: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/**
 * Persist the resolved id array. Returns false when storage is unavailable
 * or the write throws; callers keep the previous state in that case.
 */
export function writeResolvedIds(slug: string, ids: string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}
