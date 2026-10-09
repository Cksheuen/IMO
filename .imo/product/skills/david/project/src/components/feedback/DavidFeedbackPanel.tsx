import { SelectionList } from "./SelectionList";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readFeedbackDraft, saveFeedbackDraft } from "./feedbackDraft";
import { AutoGrowingTextarea } from "../ui/AutoGrowingTextarea";
import type { CSSProperties } from "react";
import {
  DAVID_PLUGIN_SCHEMA,
  DAVID_SUGGESTION_MAX_LENGTH,
  parseFeedback,
  parsePluginDraft,
  pluginFromFeedback,
  serializeFeedback,
  selectionScope,
} from "../../lib/davidFeedback";
import type {
  DavidFeedbackCategory,
  DavidFeedbackDocument,
  DavidFeedbackEntry,
  DavidFeedbackMode,
  DavidFeedbackScope,
} from "../../lib/davidFeedback";
import type { AppearanceSelection } from "../../lib/globalSelection";
import { SelectionContextChips } from "./SelectionContextChips";
import "./feedback.css";

type Props = {
  compact?: boolean;
  doc: DavidFeedbackDocument;
  pageId: string;
  nodePath: string[];
  selection?: AppearanceSelection;
  onAddSelection?: () => void;
  suspended?: boolean;
  onChange: (input: string | DavidFeedbackDocument) => void | Promise<void>;
  onClose: () => void;
};

const CATEGORIES: readonly DavidFeedbackCategory[] = [
  "visual",
  "interaction",
  "content",
  "schema",
  "other",
];

const CATEGORY_LABELS: Record<DavidFeedbackCategory, string> = {
  visual: "视觉",
  interaction: "交互",
  content: "内容",
  schema: "结构",
  other: "其他",
};

const CATEGORY_HELP: Array<{
  category: DavidFeedbackCategory;
  description: string;
  example: string;
}> = [
  {
    category: "visual",
    description: "界面外观：布局、间距、配色、层级、信息密度、溢出。",
    example: "例：卖点卡间距改为 12px，并与下方分割带对齐。",
  },
  {
    category: "interaction",
    description: "操作路径：动效、状态反馈、手势、默认交互形态。",
    example: "例：默认交互改为 highlight，动画减弱。",
  },
  {
    category: "content",
    description: "文案与信息组织：重复冗余、口径一致、详略分层。",
    example: "例：总览只给结论与改动，细节放组件层。",
  },
  {
    category: "schema",
    description: "结构与契约：评审树/模块划分、字段与接口契约。",
    example: "例：无接口变化时不展示空 API 块。",
  },
  {
    category: "other",
    description: "不属于以上类别的其他反馈。",
    example: "例：导出文件名带上日期。",
  },
];

const DEFAULT_INTERACTIONS = ["highlight", "drilldown", "auto"] as const;

const newFeedbackId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 18, 25, 0.45)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 1000,
  },
  panel: {
    width: "min(420px, 100vw)",
    height: "100%",
    background: "#faf7f0",
    color: "#1f2328",
    borderLeft: "1px solid #d8d2c4",
    boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.18)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 14,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    paddingRight: "calc(16px + env(safe-area-inset-right, 0px))",
    borderBottom: "1px solid #e3ddcf",
  },
  body: {
    padding: "12px 16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  label: { fontWeight: 600, fontSize: 12, color: "#5a5347" },
  helpButton: {
    marginRight: 6,
    marginLeft: 0,
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "1px solid #c9c2b2",
    background: "#fffdf7",
    color: "#5a5347",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    padding: 0,
  },
  helpOverlay: {
    border: "1px solid #d8d2c4",
    borderRadius: 6,
    padding: "8px 10px",
    background: "#fffdf7",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  helpRow: { display: "flex", flexDirection: "column", gap: 2 },
  helpTerm: { fontSize: 12, color: "#1f2328" },
  helpText: { fontSize: 12, color: "#5a5347" },
  helpExample: { fontSize: 11, color: "#8a8073" },
  selectionContext: {
    border: "1px solid #d8d2c4",
    borderRadius: 6,
    padding: "8px 10px",
    background: "#fffdf7",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  selectionTitle: { fontWeight: 600, fontSize: 12, color: "#5a5347" },
  selectionGrid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "3px 8px",
    fontSize: 12,
  },
  selectionTerm: { color: "#5a5347" },
  selectionValue: { color: "#1f2328", overflowWrap: "anywhere" },
  selectionNote: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.4,
    color: "#5a5347",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  input: {
    padding: "6px 8px",
    border: "1px solid #c9c2b2",
    borderRadius: 6,
    background: "#fffdf7",
    color: "#1f2328",
    font: "inherit",
  },
  textarea: {
    padding: "6px 8px",
    border: "1px solid #c9c2b2",
    borderRadius: 6,
    background: "#fffdf7",
    color: "#1f2328",
    font: "inherit",
    resize: "vertical",
    minHeight: 72,
  },
  button: {
    padding: "6px 12px",
    border: "1px solid #b89a5e",
    borderRadius: 6,
    background: "#b89a5e",
    color: "#fff",
    cursor: "pointer",
    font: "inherit",
  },
  secondaryButton: {
    padding: "6px 12px",
    border: "1px solid #c9c2b2",
    borderRadius: 6,
    background: "#fffdf7",
    color: "#1f2328",
    cursor: "pointer",
    font: "inherit",
  },
  toggleButton: {
    padding: "6px 12px",
    border: "1px solid #c9c2b2",
    borderRadius: 6,
    background: "#fffdf7",
    color: "#1f2328",
    cursor: "pointer",
    font: "inherit",
  },
  toggleButtonActive: {
    padding: "6px 12px",
    border: "1px solid #b89a5e",
    borderRadius: 6,
    background: "#b89a5e",
    color: "#fff",
    cursor: "pointer",
    font: "inherit",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  cell: {
    borderTop: "1px solid #e3ddcf",
    padding: "6px 4px",
    textAlign: "left",
    verticalAlign: "top",
    maxWidth: 160,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 999,
    background: "#ece4d0",
    fontSize: 11,
  },
  status: {
    padding: "8px 16px",
    borderTop: "1px solid #e3ddcf",
    fontSize: 12,
    color: "#5a5347",
    minHeight: 18,
  },
};

export function DavidFeedbackPanel(props: Props) {
  return <FeedbackComposer key={props.doc.slug} {...props} />;
}

function FeedbackComposer({
  compact = false,
  doc,
  pageId,
  nodePath,
  selection,
  onAddSelection,
  suspended = false,
  onChange,
  onClose,
}: Props) {
  const [mode, setMode] = useState<DavidFeedbackMode>(doc.mode);
  const [restoredDraft] = useState(() => readFeedbackDraft(doc.slug));
  const [category, setCategory] = useState<DavidFeedbackCategory>(
    restoredDraft?.category ?? "visual",
  );
  const [suggestion, setSuggestion] = useState(restoredDraft?.suggestion ?? "");
  const [selections, setSelections] = useState<AppearanceSelection[]>(
    restoredDraft?.scope?.selections ??
      (restoredDraft?.scope?.selection
        ? [restoredDraft.scope.selection]
        : !restoredDraft && selection
          ? [selection]
          : []),
  );
  const [previousSelection, setPreviousSelection] = useState(selection);
  if (selection !== previousSelection) {
    setPreviousSelection(selection);
    if (selection)
      setSelections((current) =>
        onAddSelection
          ? current.some((item) => item.capturedAt === selection.capturedAt)
            ? current
            : [...current, selection]
          : [selection],
      );
  }
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);
  const [paper, setPaper] = useState("");
  const [ink, setInk] = useState("");
  const [accent, setAccent] = useState("");
  const [gold, setGold] = useState("");
  const [muted, setMuted] = useState("");
  const [radius, setRadius] = useState("");
  const [fontScale, setFontScale] = useState("");
  const [motionScale, setMotionScale] = useState("");
  const [defaultInteraction, setDefaultInteraction] = useState("");
  const [status, setStatus] = useState<string | undefined>(
    restoredDraft ? "已恢复未提交草稿，仅保存在本机" : undefined,
  );
  const [categoryHelpOpen, setCategoryHelpOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const statusTimerRef = useRef<number | undefined>(undefined);
  const suggestionRef = useRef(suggestion);
  const submittingRef = useRef(false);
  const currentDraftScope = useMemo((): DavidFeedbackScope => {
    const primary = selections[0];
    const draftPage = restoredDraft?.scope?.pageId ?? pageId;
    const draftPath = restoredDraft?.scope?.nodePath ?? nodePath;
    return primary
      ? {
          selection: primary,
          ...selectionScope(primary),
          ...(selections.length > 1 ? { selections } : {}),
        }
      : {
          ...(draftPage ? { pageId: draftPage } : {}),
          ...(draftPath.length ? { nodePath: [...draftPath] } : {}),
        };
  }, [selections, restoredDraft, pageId, nodePath]);
  useLayoutEffect(() => {
    suggestionRef.current = suggestion;
    saveFeedbackDraft(
      doc.slug,
      suggestion.trim()
        ? {
            id: "unsubmitted-draft",
            category,
            suggestion,
            createdAt: new Date().toISOString(),
            scope: currentDraftScope,
          }
        : undefined,
    );
  }, [doc.slug, category, suggestion, currentDraftScope]);

  const [prevDocMode, setPrevDocMode] = useState(doc.mode);
  if (doc.mode !== prevDocMode) {
    setPrevDocMode(doc.mode);
    setMode(doc.mode);
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!categoryHelpOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setCategoryHelpOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [categoryHelpOpen]);

  useEffect(() => {
    document.body.classList.add("david-feedback-open");
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || suspendedRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.classList.remove("david-feedback-open");
      window.removeEventListener("keydown", onKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(
    () => () => {
      if (statusTimerRef.current !== undefined) {
        window.clearTimeout(statusTimerRef.current);
      }
    },
    [],
  );

  const showStatus = (message: string) => {
    setStatus(message);
    if (statusTimerRef.current !== undefined) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(
      () => setStatus(undefined),
      4000,
    );
  };

  const switchMode = async (next: DavidFeedbackMode) => {
    if (next === mode) return;
    const previousMode = mode;
    setMode(next);
    try {
      await onChange({
        ...doc,
        mode: next,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setMode(previousMode);
      showStatus(
        `保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const importFeedback = async (file: File) => {
    try {
      const content = await file.text();
      const parsed = parseFeedback(JSON.parse(content));
      if (parsed.slug !== doc.slug) {
        throw new Error(
          `feedback slug mismatch: expected ${doc.slug}, received ${parsed.slug}`,
        );
      }
      // 传字符串给 hook：损坏/错 slug 的存量文档只能通过显式 JSON 导入恢复。
      await onChange(content);
      showStatus("已导入/恢复 feedback JSON");
    } catch (error) {
      showStatus(
        `导入 feedback 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const buildPluginDraft = (): unknown => {
    const theme: Record<string, string> = {};
    if (paper) theme.paper = paper;
    if (ink) theme.ink = ink;
    if (accent) theme.accent = accent;
    if (gold) theme.gold = gold;
    if (muted) theme.muted = muted;
    if (radius.trim() !== "") theme.radius = `${Number(radius)}px`;
    if (fontScale.trim() !== "") theme.fontScale = String(Number(fontScale));
    const behavior: {
      motionScale?: number;
      defaultInteraction?: (typeof DEFAULT_INTERACTIONS)[number];
    } = {};
    if (motionScale.trim() !== "") behavior.motionScale = Number(motionScale);
    if (defaultInteraction !== "") {
      behavior.defaultInteraction =
        defaultInteraction as (typeof DEFAULT_INTERACTIONS)[number];
    }
    return {
      schema: DAVID_PLUGIN_SCHEMA,
      schemaVersion: 1,
      id: `personal-${doc.slug}`,
      name: `Personal ${doc.slug}`,
      version: "1.0.0",
      match: { slugs: [doc.slug] },
      ...(Object.keys(theme).length > 0 ? { theme } : {}),
      ...(behavior.motionScale !== undefined ||
      behavior.defaultInteraction !== undefined
        ? { behavior }
        : {}),
    };
  };

  const submit = async () => {
    if (submittingRef.current) return;
    const trimmed = suggestion.trim();
    if (!trimmed) {
      showStatus("请填写反馈内容");
      return;
    }
    if (trimmed.length > DAVID_SUGGESTION_MAX_LENGTH) {
      showStatus(`反馈内容不能超过 ${DAVID_SUGGESTION_MAX_LENGTH} 字`);
      return;
    }
    const now = new Date().toISOString();
    const scope = currentDraftScope;
    let pluginDraft: DavidFeedbackEntry["pluginDraft"];
    if (mode === "plugin") {
      try {
        pluginDraft = parsePluginDraft(buildPluginDraft());
      } catch (error) {
        showStatus(
          `插件草稿校验失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }
    const entry: DavidFeedbackEntry = {
      id: newFeedbackId(),
      category,
      suggestion: trimmed,
      createdAt: now,
      ...(Object.keys(scope).length > 0 ? { scope } : {}),
      ...(pluginDraft !== undefined ? { pluginDraft } : {}),
    };
    try {
      submittingRef.current = true;
      await onChange({
        ...doc,
        updatedAt: now,
        entries: [...doc.entries, entry],
      });
      if (suggestionRef.current === suggestion) {
        saveFeedbackDraft(doc.slug);
        setSuggestion("");
      }
      showStatus("反馈已保存");
    } catch (error) {
      showStatus(
        `保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      submittingRef.current = false;
    }
  };

  const download = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportFeedback = () => {
    try {
      const content = serializeFeedback(doc);
      const parsed = parseFeedback(JSON.parse(content));
      if (parsed.slug !== doc.slug) {
        throw new Error(
          `feedback slug mismatch: expected ${doc.slug}, exported ${parsed.slug}`,
        );
      }
      download(`${doc.slug}-feedback.json`, content, "application/json");
      showStatus("已导出 feedback JSON");
    } catch (error) {
      showStatus(
        `导出 feedback 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const exportPlugin = () => {
    const plugin = pluginFromFeedback(doc);
    if (compact)
      return (
        <div
          style={
            suspended
              ? { ...styles.backdrop, display: "none" }
              : styles.backdrop
          }
          onClick={onClose}
          aria-hidden={suspended || undefined}
        >
          <section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="反馈面板"
            style={styles.panel}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.header}>
              <strong>反馈</strong>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={onClose}
                aria-label="关闭反馈面板"
              >
                ×
              </button>
            </div>
            <div style={styles.body}>
              <SelectionList
                selections={selections}
                onAdd={onAddSelection}
                onRemove={(index) =>
                  setSelections((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
              />
              <label style={styles.label} htmlFor="david-feedback-suggestion">
                修改意见
              </label>
              <AutoGrowingTextarea
                id="david-feedback-suggestion"
                data-testid="feedback-suggestion"
                style={styles.textarea}
                value={suggestion}
                maxLength={DAVID_SUGGESTION_MAX_LENGTH}
                onChange={(event) => setSuggestion(event.target.value)}
                placeholder="描述需要修改的内容…"
              />
              <button
                type="button"
                data-testid="feedback-submit"
                style={styles.button}
                onClick={submit}
                disabled={!suggestion.trim()}
              >
                提交反馈
              </button>
              {status && <p role="status">{status}</p>}
            </div>
          </section>
        </div>
      );
    if (!plugin) {
      showStatus("当前没有可导出的 plugin 草稿");
      return;
    }
    try {
      download(
        `${doc.slug}-plugin.json`,
        JSON.stringify(plugin, null, 2),
        "application/json",
      );
      showStatus("已导出 plugin JSON");
    } catch (error) {
      showStatus(
        `导出 plugin 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const copyRequest = async () => {
    const payload = [
      "使用$david读取以下david-feedback/v1，默认integrated修改IMO canonical；不得声称页面已直接改skill",
      "",
      serializeFeedback(doc),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      showStatus("已复制一体化修改请求到剪贴板");
    } catch (error) {
      showStatus(
        `复制失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const plugin = pluginFromFeedback(doc);
  if (compact)
    return (
      <div
        style={
          suspended ? { ...styles.backdrop, display: "none" } : styles.backdrop
        }
        onClick={onClose}
        aria-hidden={suspended || undefined}
      >
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="反馈面板"
          style={styles.panel}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={styles.header}>
            <strong>反馈</strong>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={onClose}
              aria-label="关闭反馈面板"
            >
              ×
            </button>
          </div>
          <div style={styles.body}>
            <SelectionList
              selections={selections}
              onAdd={onAddSelection}
              onRemove={(index) =>
                setSelections((current) =>
                  current.filter((_, i) => i !== index),
                )
              }
            />
            <label style={styles.label} htmlFor="david-feedback-suggestion">
              修改意见
            </label>
            <AutoGrowingTextarea
              id="david-feedback-suggestion"
              data-testid="feedback-suggestion"
              style={styles.textarea}
              value={suggestion}
              maxLength={DAVID_SUGGESTION_MAX_LENGTH}
              onChange={(event) => setSuggestion(event.target.value)}
              placeholder="描述需要修改的内容…"
            />
            <button
              type="button"
              data-testid="feedback-submit"
              style={styles.button}
              onClick={submit}
              disabled={!suggestion.trim()}
            >
              提交反馈
            </button>
            {status && <p role="status">{status}</p>}
          </div>
        </section>
      </div>
    );

  return (
    <div
      style={
        suspended ? { ...styles.backdrop, display: "none" } : styles.backdrop
      }
      onClick={onClose}
      aria-hidden={suspended || undefined}
    >
      <aside
        ref={panelRef}
        data-testid="david-feedback-panel"
        role="dialog"
        aria-modal="true"
        aria-label="David 反馈面板"
        tabIndex={-1}
        style={styles.panel}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <strong>David 反馈</strong>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={onClose}
            aria-label="关闭反馈面板"
          >
            ×
          </button>
        </div>
        <div style={styles.body}>
          <div style={styles.field}>
            <span style={styles.label}>模式</span>
            <div style={styles.row}>
              <button
                type="button"
                data-testid="feedback-mode-integrated"
                style={
                  mode === "integrated"
                    ? styles.toggleButtonActive
                    : styles.toggleButton
                }
                aria-pressed={mode === "integrated"}
                onClick={() => switchMode("integrated")}
              >
                integrated
              </button>
              <button
                type="button"
                data-testid="feedback-mode-plugin"
                style={
                  mode === "plugin"
                    ? styles.toggleButtonActive
                    : styles.toggleButton
                }
                aria-pressed={mode === "plugin"}
                onClick={() => switchMode("plugin")}
              >
                plugin
              </button>
            </div>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>
              <button
                type="button"
                data-testid="feedback-category-help"
                style={styles.helpButton}
                aria-label="类别说明"
                aria-expanded={categoryHelpOpen}
                onClick={() => setCategoryHelpOpen((open) => !open)}
              >
                ?
              </button>
              <label htmlFor="david-feedback-category">类别</label>
            </span>
            <select
              id="david-feedback-category"
              style={styles.input}
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as DavidFeedbackCategory)
              }
            >
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {CATEGORY_LABELS[item]}（{item}）
                </option>
              ))}
            </select>
            {categoryHelpOpen && (
              <div
                style={styles.helpOverlay}
                data-testid="feedback-category-help-overlay"
                role="dialog"
                aria-label="类别说明"
              >
                {CATEGORY_HELP.map((item) => (
                  <div key={item.category} style={styles.helpRow}>
                    <strong style={styles.helpTerm}>
                      {CATEGORY_LABELS[item.category]}（{item.category}）
                    </strong>
                    <span style={styles.helpText}>{item.description}</span>
                    <span style={styles.helpExample}>{item.example}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <SelectionList
            selections={selections}
            onAdd={onAddSelection}
            onRemove={(index) =>
              setSelections((current) => current.filter((_, i) => i !== index))
            }
          />
          <div style={styles.field}>
            <label htmlFor="david-feedback-suggestion" style={styles.label}>
              建议（{suggestion.length}/{DAVID_SUGGESTION_MAX_LENGTH}）
            </label>
            <AutoGrowingTextarea
              id="david-feedback-suggestion"
              data-testid="feedback-suggestion"
              style={styles.textarea}
              value={suggestion}
              maxLength={DAVID_SUGGESTION_MAX_LENGTH}
              onChange={(event) => setSuggestion(event.target.value)}
              placeholder="描述你的反馈…"
            />
          </div>
          {mode === "plugin" && (
            <div style={styles.field}>
              <span style={styles.label}>声明式插件草稿（无 JS/CSS/HTML）</span>
              <div style={styles.row}>
                <label style={styles.label}>
                  paper
                  <input
                    type="color"
                    style={styles.input}
                    value={paper}
                    onChange={(event) => setPaper(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  ink
                  <input
                    type="color"
                    style={styles.input}
                    value={ink}
                    onChange={(event) => setInk(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  accent
                  <input
                    type="color"
                    style={styles.input}
                    value={accent}
                    onChange={(event) => setAccent(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  gold
                  <input
                    type="color"
                    style={styles.input}
                    value={gold}
                    onChange={(event) => setGold(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  muted
                  <input
                    type="color"
                    style={styles.input}
                    value={muted}
                    onChange={(event) => setMuted(event.target.value)}
                  />
                </label>
              </div>
              <div style={styles.row}>
                <label style={styles.label}>
                  radius (0..32)
                  <input
                    type="number"
                    min={0}
                    max={32}
                    step={1}
                    style={styles.input}
                    value={radius}
                    onChange={(event) => setRadius(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  fontScale (0.8..1.4)
                  <input
                    type="number"
                    min={0.8}
                    max={1.4}
                    step={0.05}
                    style={styles.input}
                    value={fontScale}
                    onChange={(event) => setFontScale(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  motionScale (0..2)
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    style={styles.input}
                    value={motionScale}
                    onChange={(event) => setMotionScale(event.target.value)}
                  />
                </label>
                <label style={styles.label}>
                  defaultInteraction
                  <select
                    style={styles.input}
                    value={defaultInteraction}
                    onChange={(event) =>
                      setDefaultInteraction(event.target.value)
                    }
                  >
                    <option value="">（未设置）</option>
                    {DEFAULT_INTERACTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
          <div style={styles.row}>
            <button
              type="button"
              data-testid="feedback-submit"
              style={styles.button}
              onClick={submit}
              disabled={!suggestion.trim()}
            >
              提交反馈
            </button>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={exportFeedback}
            >
              导出 feedback JSON
            </button>
            <label style={styles.secondaryButton}>
              导入/恢复 feedback JSON
              <input
                type="file"
                accept="application/json,.json"
                data-testid="feedback-import"
                style={{ display: "none" }}
                onChange={async (event) => {
                  const input = event.target;
                  const file = input.files?.[0];
                  if (file) await importFeedback(file);
                  input.value = "";
                }}
              />
            </label>
            <button
              type="button"
              data-testid="feedback-copy"
              style={styles.secondaryButton}
              onClick={copyRequest}
            >
              复制一体化修改请求
            </button>
            {plugin && (
              <button
                type="button"
                data-testid="feedback-export-plugin"
                style={styles.secondaryButton}
                onClick={exportPlugin}
              >
                导出 plugin JSON
              </button>
            )}
          </div>
          <div style={styles.field}>
            <span style={styles.label}>已有条目（{doc.entries.length}）</span>
            {doc.entries.length === 0 ? (
              <span>暂无反馈条目</span>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.cell}>时间</th>
                    <th style={styles.cell}>类别</th>
                    <th style={styles.cell}>状态</th>
                    <th style={styles.cell}>模式</th>
                    <th style={styles.cell}>建议</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={styles.cell}>
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td style={styles.cell}>
                        {CATEGORY_LABELS[entry.category]}
                      </td>
                      <td style={styles.cell}>
                        {entry.status === "resolved" ? "已解决" : "未解决"}
                      </td>
                      <td style={styles.cell}>
                        <span style={styles.badge}>
                          {entry.pluginDraft ? "plugin" : "integrated"}
                        </span>
                      </td>
                      <td style={styles.cell} title={entry.suggestion}>
                        <div>{entry.suggestion}</div>
                        {entry.scope?.selection?.context && (
                          <div style={{ whiteSpace: "normal", marginTop: 4 }}>
                            <SelectionContextChips
                              selection={entry.scope.selection}
                              compact
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div style={styles.status} role="status" aria-live="polite">
          {status ?? ""}
        </div>
      </aside>
    </div>
  );
}
