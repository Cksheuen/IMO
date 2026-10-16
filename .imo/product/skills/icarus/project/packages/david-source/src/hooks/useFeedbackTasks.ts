import { useCallback, useEffect, useRef, useState } from "react";
import {
  FeedbackTransport,
  type FeedbackTaskSnapshot,
} from "../lib/feedbackTransport";
export function useFeedbackTasks(
  transport: FeedbackTransport,
  slug: string,
  documentVersion = -1,
  onDocumentChange?: (background: boolean) => Promise<void>,
) {
  const [state, setState] = useState<{
    transport: FeedbackTransport;
    slug: string;
    snapshot: FeedbackTaskSnapshot;
  }>({ transport, slug, snapshot: { version: -1, inputs: {}, tasks: {} } });
  const scope = useRef({ transport, slug });
  const documentRef = useRef({
    version: documentVersion,
    onChange: onDocumentChange,
  });
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    documentRef.current = {
      version: documentVersion,
      onChange: onDocumentChange,
    };
    refreshRef.current();
  }, [documentVersion, onDocumentChange]);
  useEffect(() => {
    const key = { transport, slug };
    scope.current = key;
    let stopped = false;
    let busy = false;
    let requested = false;
    const refresh = async () => {
      if (
        stopped ||
        !transport.supportsFeedbackTasks ||
        document.visibilityState === "hidden"
      )
        return;
      if (busy) {
        requested = true;
        return;
      }
      busy = true;
      try {
        const next = await transport.loadFeedbackTasks(slug);
        if (!stopped)
          setState((previous) =>
            previous.transport === transport &&
            previous.slug === slug &&
            (next.version < previous.snapshot.version ||
              JSON.stringify(next) === JSON.stringify(previous.snapshot))
              ? previous
              : { transport, slug, snapshot: next },
          );
        if (!stopped && next.version > documentRef.current.version)
          await documentRef.current.onChange?.(true);
      } catch {
        const now = Date.now();
        if (!stopped)
          setState((previous) => {
            if (previous.transport !== transport || previous.slug !== slug)
              return previous;
            let changed = false;
            const tasks = Object.fromEntries(
              Object.entries(previous.snapshot.tasks).map(([id, task]) => {
                if (
                  task.state === "running" &&
                  task.leaseUntil !== undefined &&
                  task.leaseUntil <= now
                ) {
                  changed = true;
                  return [
                    id,
                    {
                      ...task,
                      state: "failed" as const,
                      message: "Agent 认领已超时，可重新排队",
                    },
                  ];
                }
                return [id, task];
              }),
            );
            const batch = previous.snapshot.batch;
            const expiredBatch =
              batch?.state === "running" &&
              batch.leaseUntil !== undefined &&
              batch.leaseUntil <= now;
            return changed || expiredBatch
              ? {
                  ...previous,
                  snapshot: {
                    ...previous.snapshot,
                    tasks,
                    batch: expiredBatch
                      ? { ...batch, state: "failed" as const }
                      : batch,
                  },
                }
              : previous;
          });
      } finally {
        busy = false;
        if (requested && !stopped) {
          requested = false;
          void refresh();
        }
      }
    };
    const requestRefresh = () => {
      void refresh();
    };
    refreshRef.current = requestRefresh;
    void refresh();
    const timer = setInterval(requestRefresh, 500);
    document.addEventListener("visibilitychange", requestRefresh);
    window.addEventListener("focus", requestRefresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", requestRefresh);
      window.removeEventListener("focus", requestRefresh);
      if (refreshRef.current === requestRefresh) refreshRef.current = () => {};
    };
  }, [transport, slug]);
  const request = useCallback(async () => {
    const currentScope = scope.current;
    const result = await transport.requestFeedbackBatch(slug);
    const verified = await transport.loadFeedbackTasks(slug);
    if (verified.batch?.id !== result.batch?.id)
      throw Error("处理队列已变化，请刷新后核对");
    if (currentScope === scope.current)
      setState((previous) =>
        previous.transport === transport &&
        previous.slug === slug &&
        verified.version < previous.snapshot.version
          ? previous
          : { transport, slug, snapshot: verified },
      );
  }, [transport, slug]);
  return {
    feedbackTasks:
      state.transport === transport && state.slug === slug
        ? state.snapshot.tasks
        : {},
    feedbackBatch:
      state.transport === transport && state.slug === slug
        ? state.snapshot.batch
        : undefined,
    feedbackDispatch:
      state.transport === transport && state.slug === slug
        ? state.snapshot.dispatch
        : undefined,
    requestFeedbackProcessing: request,
    supportsFeedbackTasks:
      transport.supportsFeedbackBatch &&
      state.transport === transport &&
      state.slug === slug &&
      state.snapshot.version >= 0,
  };
}
