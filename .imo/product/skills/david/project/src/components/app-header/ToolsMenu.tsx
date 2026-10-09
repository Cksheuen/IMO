import styles from "./AppHeader.module.css";

type ToolsMenuProps = {
  onOpenDavid?: () => void;
  activePluginName?: string;
  onReset: () => void;
  onExportFeedback: () => void;
  onCopyFeedback: () => void;
  onPasteFeedback: () => void;
  bridgeEnabled: boolean;
  onToggleBridge: (enabled: boolean) => void;
  onImportFeedbackFile: (file: File) => void;
  onImportReviewFile: (file: File) => void;
  onImportPluginFile: (file: File) => void;
  status?: string;
};

/**
 * Header "工具" disclosure menu. Extracted verbatim from AppHeader; every
 * handler is supplied by the parent so the menu owns no business logic.
 */
export function ToolsMenu({
  onOpenDavid,
  activePluginName,
  onReset,
  onExportFeedback,
  onCopyFeedback,
  onPasteFeedback,
  bridgeEnabled,
  onToggleBridge,
  onImportFeedbackFile,
  onImportReviewFile,
  onImportPluginFile,
  status,
}: ToolsMenuProps) {
  return (
    <details
      className={`${styles.reviewTools} review-tools`}
      onClick={(event) => {
        const target = event.target as Element;
        if (target && target.closest && target.closest("button")) {
          event.currentTarget.open = false;
        }
      }}
    >
      <summary>工具</summary>
      <div className={`${styles.toolsPanel} app-header-actions`}>
        <button
          type="button"
          className={styles.tool}
          data-testid="david-feedback-open"
          onClick={() => onOpenDavid?.()}
          disabled={!onOpenDavid}
        >
          评审反馈
        </button>
        {activePluginName && (
          <span className={styles.tool} role="status" aria-live="polite">
            个性化: {activePluginName}
          </span>
        )}
        <button type="button" className={styles.tool} onClick={onReset}>
          重置阅读
        </button>
        <button
          type="button"
          className={styles.tool}
          onClick={onExportFeedback}
        >
          导出 feedback JSON
        </button>
        <button
          type="button"
          className={styles.tool}
          data-testid="david-feedback-copy-doc"
          onClick={onCopyFeedback}
        >
          复制反馈给 agent
        </button>
        <button
          type="button"
          className={styles.tool}
          data-testid="david-feedback-paste"
          onClick={onPasteFeedback}
        >
          从剪贴板导入 agent 回复
        </button>
        <label className={`${styles.importControl} import-control`}>
          <input
            type="checkbox"
            data-testid="david-bridge-auto-copy"
            checked={bridgeEnabled}
            onChange={(event) => onToggleBridge(event.target.checked)}
          />
          提交后自动复制给 agent
        </label>
        <label className={`${styles.importControl} import-control`}>
          导入 feedback JSON
          <input
            type="file"
            accept="application/json,.json"
            data-testid="david-feedback-import"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) await onImportFeedbackFile(file);
            }}
          />
        </label>
        <label className={`${styles.importControl} import-control`}>
          导入 review
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImportReviewFile(file);
            }}
          />
        </label>
        <label className={`${styles.importControl} import-control`}>
          导入David plugin
          <input
            type="file"
            accept="application/json,.json"
            data-testid="david-plugin-import"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImportPluginFile(file);
            }}
          />
        </label>
        {status && (
          <span className={styles.tool} role="status" aria-live="polite">
            {status}
          </span>
        )}
      </div>
    </details>
  );
}
