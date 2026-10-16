import { useFeedbackTasks } from "./useFeedbackTasks";
import type { AppearanceSelection } from "../lib/globalSelection";
import {
  appendFeedbackSelection,
  removeFeedbackSelection,
} from "../lib/davidFeedback";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  appendFeedbackReply,
  createFeedbackDocument,
  DAVID_REPLY_MAX_LENGTH,
  feedbackStorageKey,
  mergeFeedbackDocuments,
  parseFeedback,
  parsePluginDraft,
  pluginCssVariables,
  pluginMatchesSlug,
  pluginStorageKey,
  setFeedbackEntryDecision,
  setFeedbackEntryStatus,
  setFeedbackEntrySuggestion,
  type DavidFeedbackDecision,
  type DavidFeedbackEntryStatus,
  type DavidFeedbackReply,
  type DavidPluginDraft,
} from "../lib/davidFeedback";
import {
  FeedbackConflictError,
  FeedbackOfflineError,
  FeedbackTransport,
} from "../lib/feedbackTransport";

type Feedback = ReturnType<typeof parseFeedback>;

/**
 * 评论同步态。
 * - "checking"：正在探活，UI 不该据此下结论
 * - "online"：服务可达，评论以服务为唯一数据源
 * - "offline"：服务不可达 —— 评论**不可写**，引导用户让 agent 拉起服务。
 *   刻意不降级写 localStorage：那会产生两处数据源，agent 读到的永远可能不全。
 */
export type FeedbackSyncState = "checking" | "online" | "offline";

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const newFeedbackReplyId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 读取遗留 localStorage 存量，仅用于一次性迁移到服务。
 * 不作为活动数据源——服务在线后所有读写都走服务。
 */
function loadLegacyFeedback(slug: string): Feedback | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(feedbackStorageKey(slug));
    if (raw == null) return undefined;
    const parsed = parseFeedback(JSON.parse(raw) as unknown);
    return parsed.slug === slug ? parsed : undefined;
  } catch {
    // 损坏的存量保持原样、不声称读取成功（与既有「损坏存储不自动重建」一致）。
    return undefined;
  }
}

/** 迁移完成标记，避免每次挂载都重复上推同一份存量。 */
const legacyMigratedKey = (slug: string): string =>
  `david:${slug}:migrated-to-service`;

function isLegacyMigrated(slug: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(legacyMigratedKey(slug)) === "1";
  } catch {
    return false;
  }
}

function markLegacyMigrated(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(legacyMigratedKey(slug), "1");
  } catch {
    // 标记失败只会导致下次重试迁移；merge 是幂等的，无副作用。
  }
}

function loadPlugins(): { plugins: DavidPluginDraft[]; error: Error | null } {
  if (typeof window === "undefined") {
    return { plugins: [], error: null };
  }
  try {
    const raw = window.localStorage.getItem(pluginStorageKey);
    if (raw == null) {
      return { plugins: [], error: null };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { plugins: [], error: new Error("david plugins 存储必须是数组") };
    }
    const plugins: DavidPluginDraft[] = [];
    let firstError: Error | null = null;
    parsed.forEach((item, index) => {
      try {
        const value = typeof item === "string" ? JSON.parse(item) : item;
        plugins.push(parsePluginDraft(value, `plugins[${index}]`));
      } catch (err) {
        if (firstError === null) {
          firstError = toError(err);
        }
      }
    });
    return { plugins, error: firstError };
  } catch (err) {
    return { plugins: [], error: toError(err) };
  }
}

function persistPlugins(plugins: DavidPluginDraft[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(pluginStorageKey, JSON.stringify(plugins));
}

type DavidFeedbackState = {
  feedback: Feedback | undefined;
  plugins: DavidPluginDraft[];
  error: Error | null;
  feedbackBlocked: boolean;
  sync: FeedbackSyncState;
  /** 服务端单调版本号，用于乐观并发（expectedVersion）。 */
  version: number;
};

/** 初始态：文档一律从服务加载，本地只先备好插件（插件是 origin-local 的）。 */
function initialState(): DavidFeedbackState {
  const pluginsState = loadPlugins();
  return {
    feedback: undefined,
    plugins: pluginsState.plugins,
    error: pluginsState.error,
    feedbackBlocked: false,
    // Checking remains unwritable, without flashing a false offline banner.
    sync: "checking",
    version: 0,
  };
}

export function useDavidFeedback(slug: string, serviceBaseUrl?: string) {
  const [state, setState] = useState<DavidFeedbackState>(() => initialState());

  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const { feedback, plugins, error } = state;

  const transport = useMemo(
    () => new FeedbackTransport(serviceBaseUrl),
    [serviceBaseUrl],
  );

  const requestScope = useMemo(() => ({ slug, transport }), [slug, transport]);
  const activeScopeRef = useRef(requestScope);
  const refreshGeneration = useRef(0);
  const writeGeneration = useRef(0);
  const pendingWrites = useRef(0);
  useLayoutEffect(() => {
    activeScopeRef.current = requestScope;
  }, [requestScope]);

  const [trackedScope, setTrackedScope] = useState(requestScope);
  if (trackedScope !== requestScope) {
    setTrackedScope(requestScope);
    setState(initialState());
  }

  const commitState = useCallback((next: DavidFeedbackState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /**
   * 从服务加载，并在首次可达时把遗留 localStorage 存量一次性合并上推。
   * 服务不可达 → 进入 offline（评论不可写），不回落 localStorage。
   */
  const refresh = useCallback(
    async (background = false) => {
      if (pendingWrites.current > 0) return;
      const generation = ++refreshGeneration.current;
      const writesAtStart = writeGeneration.current;
      const current = () =>
        activeScopeRef.current === requestScope &&
        generation === refreshGeneration.current &&
        writesAtStart === writeGeneration.current;
      if (!(await transport.health())) {
        if (current())
          commitState({ ...stateRef.current, sync: "offline", error: null });
        return;
      }
      try {
        let snapshot = await transport.load(slug);
        if (!current()) return;
        if (!isLegacyMigrated(slug)) {
          const legacy = loadLegacyFeedback(slug);
          if (legacy && legacy.entries.length > 0) {
            const merged = snapshot
              ? mergeFeedbackDocuments(snapshot.doc, legacy)
              : legacy;
            snapshot = await transport.put(slug, merged);
          }
          markLegacyMigrated(slug);
        }
        if (!current() || (snapshot?.version ?? 0) < stateRef.current.version)
          return;
        const before = stateRef.current;
        if (
          before.sync === "online" &&
          (background || !before.error) &&
          before.feedback &&
          before.version === (snapshot?.version ?? 0)
        )
          return;
        commitState({
          ...before,
          feedback: snapshot?.doc ?? createFeedbackDocument(slug),
          version: snapshot?.version ?? 0,
          sync: "online",
          error: background && before.sync === "online" ? before.error : null,
          feedbackBlocked: false,
        });
      } catch (err) {
        if (current())
          commitState({
            ...stateRef.current,
            sync: err instanceof FeedbackOfflineError ? "offline" : "online",
            error: toError(err),
          });
      }
    },
    [commitState, slug, transport, requestScope],
  );

  // Visible reviews stay current without a reply gesture. Pause while hidden and refresh on return.
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      if (disposed || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        await refresh(true);
      } finally {
        busy = false;
      }
    };
    const tick = async () => {
      await sync();
      if (!disposed)
        timer = setTimeout(
          tick,
          stateRef.current.sync === "online" ? 2000 : 8000,
        );
    };
    const onReturn = () => {
      void sync();
    };
    void tick();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      disposed = true;
      refreshGeneration.current += 1;
      clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);

  /**
   * 统一写入通道：乐观提交内存态 → 调服务 → 用服务返回的权威文档回填。
   * 保持同步签名（调用方不必 await），失败时把错误挂到 state.error 并回滚为服务态。
   * 冲突（409）自动重读，让页面显示最新数据而不是静默丢弃用户输入。
   */
  const runWrite = useCallback(
    (
      _optimistic: Feedback,
      send: (expectedVersion: number) => Promise<{
        doc: Feedback;
        version: number;
      }>,
    ) => {
      const before = stateRef.current;
      if (before.sync !== "online") {
        const offlineError = new Error(
          before.sync === "checking"
            ? "正在连接评论服务，请稍后重试。"
            : "评论服务未启动，当前为离线模式，评论不可写。请让 agent 拉起服务后重试。",
        );
        commitState({ ...before, error: offlineError });
        throw offlineError;
      }
      const writingScope = activeScopeRef.current;
      pendingWrites.current += 1;
      writeGeneration.current += 1;
      commitState({ ...before, error: null });
      return (async () => {
        try {
          const saved = await send(before.version);
          if (
            activeScopeRef.current !== writingScope ||
            saved.version < stateRef.current.version
          )
            return;
          commitState({
            ...stateRef.current,
            feedback: saved.doc,
            version: saved.version,
            error: null,
          });
        } catch (err) {
          if (activeScopeRef.current !== writingScope) throw err;
          if (err instanceof FeedbackConflictError) {
            commitState({
              ...stateRef.current,
              feedback: err.currentDoc ?? before.feedback,
              version: err.currentVersion,
              error: toError(err),
            });
            throw err;
          }
          commitState({
            ...stateRef.current,
            feedback: before.feedback,
            version: before.version,
            sync: err instanceof FeedbackOfflineError ? "offline" : before.sync,
            error: toError(err),
          });
          throw err;
        } finally {
          pendingWrites.current -= 1;
          writeGeneration.current += 1;
        }
      })();
    },
    [commitState],
  );

  const commitFeedback = useCallback(
    (next: Feedback) => {
      return runWrite(next, (expectedVersion) =>
        transport
          .put(slug, next, expectedVersion)
          .then((s) => ({ doc: s.doc, version: s.version })),
      );
    },
    [runWrite, slug, transport],
  );

  const updateFeedback = useCallback(
    async (input: string | Feedback) => {
      try {
        const parsed: unknown =
          typeof input === "string" ? JSON.parse(input) : input;
        const next = parseFeedback(parsed);
        if (next.slug !== slug) {
          throw new Error(
            `david feedback slug mismatch: expected ${slug}, received ${next.slug}`,
          );
        }
        const current = stateRef.current.feedback;

        // 面板提交新条目是最常见路径：只多出末尾若干条、其余 base 未变。
        // 这种情况逐条走 entries 接口，避免整稿 PUT 把未变条目也送去 merge
        // （服务端 merge 对 base 字段极严，任何顺序/字段差异都会判 409）。
        if (typeof input !== "string" && current) {
          const knownIds = new Set(current.entries.map((entry) => entry.id));
          const added = next.entries.filter((entry) => !knownIds.has(entry.id));
          const unchanged =
            next.entries.length === current.entries.length + added.length;
          if (added.length > 0 && unchanged) {
            let optimistic = current;
            for (const entry of added) {
              optimistic = {
                ...optimistic,
                entries: [...optimistic.entries, entry],
              };
            }
            await runWrite(parseFeedback(optimistic), async (expected) => {
              let latest = { doc: next, version: expected };
              // 逐条提交；每条都用上一次返回的 version，保持乐观并发链。
              for (const entry of added) {
                const saved = await transport.addEntry(
                  slug,
                  entry,
                  latest.version,
                );
                latest = { doc: saved.doc, version: saved.version };
              }
              return latest;
            });
            return;
          }
        }

        // 显式 JSON 导入（或结构性变更）：按 id 安全合并后整稿提交。
        const resolved =
          typeof input === "string" && current
            ? mergeFeedbackDocuments(current, next)
            : next;
        await commitFeedback(resolved);
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitFeedback, commitState, runWrite, slug, transport],
  );

  const replyToFeedback = useCallback(
    async (entryId: string, body: string): Promise<DavidFeedbackReply> => {
      try {
        const trimmed = body.trim();
        if (!trimmed) {
          throw new Error("回复内容不能为空");
        }
        if (trimmed.length > DAVID_REPLY_MAX_LENGTH) {
          throw new Error(`回复内容不能超过 ${DAVID_REPLY_MAX_LENGTH} 字`);
        }
        const current = stateRef.current.feedback;
        if (!current) {
          throw new Error("David 反馈尚未加载，无法追加回复");
        }
        const reply: DavidFeedbackReply = {
          id: newFeedbackReplyId(),
          body: trimmed,
          createdAt: new Date().toISOString(),
        };
        // 走 replies 专用接口而非整稿 PUT：后者会把这次改动当成 base 变更，
        // 被服务端的 merge 判为冲突。
        await runWrite(
          appendFeedbackReply(current, entryId, reply),
          (expected) =>
            transport
              .addReply(slug, entryId, reply, expected)
              .then((s) => ({ doc: s.doc, version: s.version })),
        );
        return reply;
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitState, runWrite, slug, transport],
  );

  const editFeedbackSuggestion = useCallback(
    async (entryId: string, suggestion: string) => {
      try {
        const current = stateRef.current.feedback;
        if (!current) {
          throw new Error("David 反馈尚未加载，无法编辑条目");
        }
        await runWrite(
          setFeedbackEntrySuggestion(current, entryId, suggestion),
          (expected) =>
            transport
              .patchEntry(slug, entryId, { suggestion }, expected)
              .then((s) => ({ doc: s.doc, version: s.version })),
        );
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitState, runWrite, slug, transport],
  );

  const addFeedbackSelection = useCallback(
    async (entryId: string, selection: AppearanceSelection) => {
      if (!transport.supportsMultiSelection)
        throw new Error("评论服务需更新后才能保存多个选区");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = stateRef.current.feedback;
        if (!current) throw new Error("David 反馈尚未加载");
        try {
          await runWrite(
            appendFeedbackSelection(current, entryId, selection),
            (expected) =>
              transport.patchEntry(
                slug,
                entryId,
                { addSelection: selection },
                expected,
              ),
          );
          return;
        } catch (error) {
          if (error instanceof FeedbackConflictError && attempt === 0) continue;
          throw error;
        }
      }
    },
    [runWrite, slug, transport],
  );

  const deleteFeedbackEntry = useCallback(
    async (entryId: string) => {
      if (!transport.supportsFeedbackDeletion)
        throw new Error("评论服务需更新后才能删除评论");
      const current = stateRef.current.feedback;
      if (!current) throw new Error("评论尚未加载");
      await runWrite(
        {
          ...current,
          entries: current.entries.filter((entry) => entry.id !== entryId),
        },
        (expected) => transport.deleteEntry(slug, entryId, expected),
      );
    },
    [runWrite, slug, transport],
  );
  const removeSelection = useCallback(
    async (entryId: string, selection: AppearanceSelection) => {
      if (!transport.supportsFeedbackDeletion)
        throw new Error("评论服务需更新后才能删除选区");
      const current = stateRef.current.feedback;
      if (!current) throw new Error("评论尚未加载");
      await runWrite(
        removeFeedbackSelection(current, entryId, selection),
        (expected) =>
          transport.patchEntry(
            slug,
            entryId,
            { removeSelection: selection },
            expected,
          ),
      );
    },
    [runWrite, slug, transport],
  );
  const setFeedbackStatus = useCallback(
    async (entryId: string, status: DavidFeedbackEntryStatus) => {
      try {
        const current = stateRef.current.feedback;
        if (!current) {
          throw new Error("David 反馈尚未加载，无法更新状态");
        }
        await runWrite(
          setFeedbackEntryStatus(current, entryId, status),
          (expected) =>
            transport
              .patchEntry(slug, entryId, { status }, expected)
              .then((s) => ({ doc: s.doc, version: s.version })),
        );
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitState, runWrite, slug, transport],
  );

  /** agent 提议的采纳决议；与 status 正交，不改变 open/resolved。 */
  const setFeedbackDecision = useCallback(
    async (entryId: string, decision: DavidFeedbackDecision) => {
      try {
        const current = stateRef.current.feedback;
        if (!current) {
          throw new Error("David 反馈尚未加载，无法更新采纳决议");
        }
        await runWrite(
          setFeedbackEntryDecision(current, entryId, decision),
          (expected) =>
            transport
              .patchEntry(slug, entryId, { decision }, expected)
              .then((s) => ({ doc: s.doc, version: s.version })),
        );
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitState, runWrite, slug, transport],
  );

  const importPlugin = useCallback(
    (input: unknown) => {
      try {
        const value = typeof input === "string" ? JSON.parse(input) : input;
        const plugin = parsePluginDraft(value, "importPlugin");
        const next = [
          ...stateRef.current.plugins.filter((item) => item.id !== plugin.id),
          plugin,
        ];
        // 先持久化，再提交 state/ref；失败时记录错误并抛出。
        persistPlugins(next);
        commitState({ ...stateRef.current, plugins: next });
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitState],
  );

  const removePlugin = useCallback(
    (id: string) => {
      try {
        const next = stateRef.current.plugins.filter((item) => item.id !== id);
        persistPlugins(next);
        commitState({ ...stateRef.current, plugins: next });
      } catch (err) {
        const error = toError(err);
        commitState({ ...stateRef.current, error });
        throw error;
      }
    },
    [commitState],
  );

  const activePlugin = useMemo(() => {
    const matches = plugins.filter((plugin) => pluginMatchesSlug(plugin, slug));
    return matches.length > 0 ? matches[matches.length - 1] : undefined;
  }, [plugins, slug]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    const variables = activePlugin ? pluginCssVariables(activePlugin) : {};
    const entries = Object.entries(variables);
    const previous: Array<[string, string, string]> = [];
    for (const [name, value] of entries) {
      previous.push([
        name,
        root.style.getPropertyValue(name),
        root.style.getPropertyPriority(name),
      ]);
      root.style.setProperty(name, value);
    }
    const motionScale = String(activePlugin?.behavior?.motionScale ?? 1);
    const previousMotionScale = root.style.getPropertyValue(
      "--david-motion-scale",
    );
    const previousMotionPriority = root.style.getPropertyPriority(
      "--david-motion-scale",
    );
    root.style.setProperty("--david-motion-scale", motionScale);
    return () => {
      for (const [name, value, priority] of previous) {
        if (value) {
          root.style.setProperty(name, value, priority);
        } else {
          root.style.removeProperty(name);
        }
      }
      if (previousMotionScale) {
        root.style.setProperty(
          "--david-motion-scale",
          previousMotionScale,
          previousMotionPriority,
        );
      } else {
        root.style.removeProperty("--david-motion-scale");
      }
    };
  }, [activePlugin]);

  // 重新从服务拉取（离线态下会重新探活，服务起来后即可恢复在线）。
  const reload = useCallback(() => {
    void refresh();
  }, [refresh]);

  const processing = useFeedbackTasks(transport, slug, state.version, refresh);
  return {
    ...processing,
    feedback,
    updateFeedback,
    replyToFeedback,
    setFeedbackStatus,
    setFeedbackDecision,
    editFeedbackSuggestion,
    addFeedbackSelection,
    deleteFeedbackEntry,
    removeFeedbackSelection: removeSelection,
    supportsFeedbackDeletion: transport.supportsFeedbackDeletion,
    supportsMultiSelection: transport.supportsMultiSelection,
    plugins,
    activePlugin,
    importPlugin,
    removePlugin,
    error,
    reload,
    /** "checking" | "online" | "offline"；offline 时评论不可写。 */
    sync: state.sync,
    /** 服务端单调版本号，仅用于调试与显示。 */
    version: state.version,
    /** 评论服务地址，供离线提示展示。 */
    serviceBaseUrl: transport.baseUrl,
  };
}
