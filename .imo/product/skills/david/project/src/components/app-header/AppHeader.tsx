import { useEffect, useRef, useState } from "react";
import {
  parseFeedback,
  serializeFeedback,
  type DavidFeedbackDocument,
} from "../../lib/davidFeedback";
import { parseReviewSpec } from "../../lib/reviewSpec";
import type { ReviewPayload } from "../../types/review";
import { showToast } from "../../lib/toast";
import {
  buildAgentClipboardPayload,
  parseAgentClipboardPayload,
} from "../../lib/davidBridge";
import styles from "./AppHeader.module.css";
import { ToolsMenu } from "./ToolsMenu";

type Props = {
  title: string;
  subtitle: string;
  slug: string;
  sourcePath?: string;
  feedbackDoc: DavidFeedbackDocument;
  onReset: () => void;
  onImport: (review: ReviewPayload) => void;
  onImportFeedback: (content: string) => void | Promise<void>;
  onOpenDavid?: () => void;
  onImportDavidPlugin?: (value: unknown) => void;
  activePluginName?: string;
  /** 补充板（非主预览的 component）入口：点击直接进入该 component 的详情层级。 */
  supplementaryBoards?: { id: string; label: string }[];
  onOpenBoard?: (componentId: string) => void;
  /** 待澄清问题入口：提供总数时按钮才出现；openQuestionOpenCount 驱动徽标。 */
  openQuestionCount?: number;
  openQuestionOpenCount?: number;
  onOpenQuestions?: () => void;
  onOpenMaterials?: () => void;
};

/** localStorage key for the "auto-copy to agent" clipboard bridge flag. */
const bridgeStorageKey = (slug: string): string => `david:${slug}:bridge`;

const readBridgeEnabled = (slug: string): boolean => {
  try {
    return window.localStorage.getItem(bridgeStorageKey(slug)) === "1";
  } catch {
    // localStorage can throw in private mode; treat as disabled.
    return false;
  }
};

const writeBridgeEnabled = (slug: string, enabled: boolean): boolean => {
  try {
    if (enabled) {
      window.localStorage.setItem(bridgeStorageKey(slug), "1");
    } else {
      window.localStorage.removeItem(bridgeStorageKey(slug));
    }
    return true;
  } catch {
    // localStorage can throw in private mode; report failure to the caller.
    return false;
  }
};

export function AppHeader({
  title,
  slug,
  sourcePath,
  feedbackDoc,
  onReset,
  onImport,
  onImportFeedback,
  onOpenDavid,
  onImportDavidPlugin,
  activePluginName,
  supplementaryBoards,
  onOpenBoard,
  openQuestionCount,
  openQuestionOpenCount,
  onOpenQuestions,
  onOpenMaterials,
}: Props) {
  const [status, setStatus] = useState<string>();
  const statusTimerRef = useRef<number | undefined>(undefined);
  const blobUrlRef = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    },
    [],
  );

  const showStatus = (message: string) => {
    setStatus(message);
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(
      () => setStatus(undefined),
      4000,
    );
  };

  const [bridgeEnabled, setBridgeEnabled] = useState<boolean>(() =>
    readBridgeEnabled(slug),
  );
  const [prevBridgeSlug, setPrevBridgeSlug] = useState(slug);
  if (slug !== prevBridgeSlug) {
    setPrevBridgeSlug(slug);
    setBridgeEnabled(readBridgeEnabled(slug));
  }

  const copyFeedbackToAgent = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(
        buildAgentClipboardPayload(feedbackDoc),
      );
      showStatus("已复制反馈给 agent");
    } catch {
      showStatus(
        "复制失败：此环境不支持写入剪贴板，请改用「导出 feedback JSON」",
      );
    }
  };

  const pasteFromAgent = async () => {
    if (!navigator.clipboard?.readText) {
      showStatus("此环境不支持读取剪贴板，请改用「导入 feedback JSON」");
      return;
    }
    try {
      const { doc, json } = parseAgentClipboardPayload(
        await navigator.clipboard.readText(),
      );
      if (doc.slug !== slug) throw new Error(`slug 不匹配: ${doc.slug}`);
      await onImportFeedback(json);
      showStatus(`已合并 agent 回复（${doc.entries.length} 条条目）`);
    } catch (error) {
      showStatus(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const toggleBridge = (enabled: boolean) => {
    if (!writeBridgeEnabled(slug, enabled)) {
      showStatus(
        "无法保存自动复制设置（localStorage 不可用，可能处于隐私模式）",
      );
      return;
    }
    setBridgeEnabled(enabled);
    if (enabled) showStatus("已开启：提交后自动复制给 agent");
  };

  const exportFeedback = () => {
    try {
      const content = serializeFeedback(feedbackDoc);
      const blob = new Blob([content], { type: "application/json" });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}-feedback.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        if (blobUrlRef.current === url) blobUrlRef.current = undefined;
      }, 1000);
      showStatus("已导出 feedback JSON");
    } catch (error) {
      showStatus(
        `导出 feedback 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const importFeedback = async (file: File) => {
    try {
      const content = await file.text();
      const doc = parseFeedback(JSON.parse(content));
      if (doc.slug !== slug) {
        throw new Error(
          `feedback slug mismatch: expected ${slug}, received ${doc.slug}`,
        );
      }
      // 传原始字符串：损坏/错 slug 的存量只能通过显式 JSON 导入恢复。
      await onImportFeedback(content);
      showStatus(`已合并 feedback JSON（${doc.entries.length} 条反馈）`);
    } catch (error) {
      showStatus(
        `导入 feedback 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const importReview = async (file: File) => {
    try {
      onImport(parseReviewSpec(JSON.parse(await file.text())));
      showStatus("已导入 review JSON");
    } catch (error) {
      console.error("导入 review 失败", error);
      showStatus(
        `导入 review 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const importPlugin = async (file: File) => {
    if (!onImportDavidPlugin) {
      showStatus("导入 David plugin 失败：未提供导入回调");
      return;
    }
    try {
      onImportDavidPlugin(JSON.parse(await file.text()));
      showStatus("已导入 David plugin");
    } catch (error) {
      showStatus(
        `导入 David plugin 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const entryCount = feedbackDoc.entries.length;
  const copyContext = async () => {
    try {
      const lines = [
        `title: ${title}`,
        `url: ${typeof window !== "undefined" ? window.location.href : ""}`,
        `slug: ${slug}`,
        `david:${slug}:feedback`,
        `反馈条数: ${entryCount}`,
      ];
      if (sourcePath) lines.push(`sourcePath: ${sourcePath}`);
      lines.push(
        "指令: 使用全局david/原生浏览器/按id+内容+回复增量/跳过未变更未解决/保留原状态追加结论",
      );
      const output = lines.join("\n");
      await navigator.clipboard.writeText(output);
      showToast("success", "已复制评审上下文");
    } catch {
      showToast("error", "复制失败，请重试");
    }
  };

  return (
    <header className={`${styles.header} app-header`}>
      <h1 className={`${styles.srOnly} ${styles.title} title`}>{title}</h1>
      <div className={styles.controls}>
        {supplementaryBoards &&
          supplementaryBoards.length > 0 &&
          onOpenBoard && (
            <div
              className={`${styles.boardEntries} app-header-boards`}
              role="group"
              aria-label="补充板"
            >
              {supplementaryBoards.map((board) => (
                <button
                  key={board.id}
                  type="button"
                  className={styles.boardButton}
                  data-testid={`david-board-${board.id}`}
                  onClick={() => onOpenBoard(board.id)}
                >
                  {board.label}
                </button>
              ))}
            </div>
          )}
        <button
          type="button"
          className={styles.copyButton}
          data-testid="david-context-copy"
          onClick={copyContext}
        >
          复制评审上下文
        </button>
        {openQuestionCount !== undefined &&
          openQuestionCount > 0 &&
          onOpenQuestions && (
            <button
              type="button"
              className={styles.openQuestionsButton}
              data-testid="david-open-questions"
              onClick={onOpenQuestions}
            >
              待澄清
              {typeof openQuestionOpenCount === "number" &&
                openQuestionOpenCount > 0 && (
                  <span
                    className={styles.openQuestionsBadge}
                    aria-label={`${openQuestionOpenCount} 个待澄清`}
                  >
                    {openQuestionOpenCount}
                  </span>
                )}
            </button>
          )}
        {onOpenMaterials && (
          <button
            type="button"
            className={styles.boardButton}
            onClick={onOpenMaterials}
          >
            设计资料
          </button>
        )}
        <ToolsMenu
          onOpenDavid={onOpenDavid}
          activePluginName={activePluginName}
          onReset={onReset}
          onExportFeedback={exportFeedback}
          onCopyFeedback={copyFeedbackToAgent}
          onPasteFeedback={pasteFromAgent}
          bridgeEnabled={bridgeEnabled}
          onToggleBridge={toggleBridge}
          onImportFeedbackFile={importFeedback}
          onImportReviewFile={importReview}
          onImportPluginFile={importPlugin}
          status={status}
        />
      </div>
    </header>
  );
}
