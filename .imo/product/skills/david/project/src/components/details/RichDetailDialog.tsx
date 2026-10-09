import { focusWithinSelection } from "../../lib/feedbackFocus";
import { scrollAndPulse } from "../../lib/pulseHighlight";
import type { AppearanceSelection } from "../../lib/globalSelection";
import { startDetailPreview } from "../../lib/detailPreview";
import {
  subscribeFieldSelection,
  getSelectedFieldName,
  toggleContractField,
} from "../api-contracts/fieldHighlightChannel";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  ApiField,
  MappingRow,
  TrdColumnContent,
} from "../../types/review";
import {
  collectApiFields,
  omitPresentedApiFields,
  renderApiFieldButton,
  renderOverviewCell,
  renderRichText,
  renderRowExtras,
  rowApiChanged,
} from "../../lib/richContent";
import type { DisclosureColumn, DisclosureLevel } from "./DisclosureCell";
import { RICH_DETAIL_CLOSE_EVENT } from "../../lib/richDetailEvents";
import { RowContractPanel } from "../api-contracts";
import { useResolvedContracts } from "../api-contracts/useApiContracts";
import { PreparationPanel } from "../preparation/PreparationPanel";
import { GraphPresentationContext } from "./graphPresentationContext";

export type RichDetailDialogProps = {
  focusSelection?: AppearanceSelection;
  row: MappingRow;
  column: DisclosureColumn;
  /** 入口层级：overview 时补渲染行级 extras（该 surface 行 header/行尾不可达） */
  level?: DisclosureLevel;
  componentId?: string;
  nodeId?: string;
  techPointIndex?: number;
  onClose: () => void;
  onFieldClick?: (field: ApiField) => void;
};

const COLUMN_HEADING: Record<DisclosureColumn, string> = {
  requirement: "需求说明",
  change: "实现方案",
  api: "接口变更",
};

function columnContent(
  row: MappingRow,
  column: DisclosureColumn,
): TrdColumnContent | undefined {
  if (column === "requirement") return row.trd?.productDesign;
  if (column === "change") return row.trd?.technical;
  return row.trd?.apiChange;
}

export function RichDetailDialog({
  row,
  column,
  level,
  componentId,
  nodeId,
  techPointIndex,
  focusSelection,
  onClose,
  onFieldClick,
}: RichDetailDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [graphHost, setGraphHost] = useState<HTMLElement | null>(null);
  const [detailRight, setDetailRight] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const activeField = useSyncExternalStore(
    subscribeFieldSelection,
    getSelectedFieldName,
    () => undefined,
  );
  const [previewRight, setPreviewRight] = useState(0);
  const [previewBottom, setPreviewBottom] = useState(0);

  useEffect(() => {
    if (!focusSelection) return;
    let cleanup: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel)
        cleanup = scrollAndPulse(focusWithinSelection(panel, focusSelection));
    });
    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [focusSelection]);

  useEffect(() => {
    const handleClose = () => onClose();
    window.addEventListener(RICH_DETAIL_CLOSE_EVENT, handleClose);
    return () => {
      window.removeEventListener(RICH_DETAIL_CLOSE_EVENT, handleClose);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>(".component-dock");
    const sync = () => {
      const boundary = Number(dock?.dataset.previewRight);
      const right =
        dock?.classList.contains("is-visible") && boundary > 0
          ? boundary + 20
          : 0;
      const bottom = dock?.classList.contains("is-visible")
        ? Number(dock.dataset.previewContentTop) || 0
        : 0;
      setPreviewBottom((current) =>
        Math.abs(current - bottom) < 1 ? current : bottom,
      );
      setPreviewRight((current) =>
        Math.abs(current - right) < 1 ? current : right,
      );
      const edge = hostRef.current?.getBoundingClientRect().right ?? 0;
      setDetailRight((current) =>
        Math.abs(current - edge) < 1 ? current : edge,
      );
    };
    const observer = new MutationObserver(sync);
    const resize = new ResizeObserver(sync);
    if (dock) {
      observer.observe(dock, { attributes: true });
      resize.observe(dock);
    }
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (hostRef.current) resize.observe(hostRef.current);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  const selectedPoint =
    column === "change" && techPointIndex !== undefined
      ? row.trd?.technical?.techPoints?.[techPointIndex]
      : undefined;
  const displayRow: MappingRow = selectedPoint
    ? {
        ...row,
        trd: {
          ...row.trd,
          technical: {
            heading: undefined,
            // The selected prose/code point is already named in the dialog header.
            // A graph keeps its title because it may live beside the preview.
            techPoints: [
              selectedPoint.graph
                ? selectedPoint
                : { ...selectedPoint, title: undefined },
            ],
            modules: row.trd?.technical?.modules?.filter(
              (module) => module.id === selectedPoint.moduleId,
            ),
          },
        },
      }
    : row;
  const content = columnContent(displayRow, column);
  const showGraphPanel =
    column === "change" &&
    previewBottom >= 222 &&
    previewRight > 0 &&
    detailRight - previewRight >= 340 &&
    Boolean(
      content?.codeFlow || content?.techPoints?.some((point) => point.graph),
    );
  const contracts = useResolvedContracts(row);
  const apiDisplayRow =
    column === "api"
      ? omitPresentedApiFields(
          displayRow,
          contracts.flatMap((contract) => [
            ...(contract.request ?? []),
            ...(contract.response ?? []),
          ]),
        )
      : displayRow;
  const apiDisplayContent = columnContent(apiDisplayRow, column);
  const previewOverlay = selectedPoint?.preview?.overlayId;
  useEffect(
    () => (previewOverlay ? startDetailPreview(previewOverlay) : undefined),
    [previewOverlay],
  );
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const body = panel?.querySelector<HTMLElement>(".rich-detail-body");
    const header = panel?.querySelector<HTMLElement>(".rich-detail-header");
    const host = panel?.parentElement;
    if (!panel || !body || !header || !host) return;
    const codes = body.querySelectorAll<HTMLElement>(".trd-cb-body");
    const single =
      codes.length === 1 && !body.querySelector(".dv-logic-canvas");
    panel.dataset.codeLayout = single ? "single" : "multiple";
    if (!single) return;
    const code = codes[0];
    const update = () => {
      const other = body.scrollHeight - code.offsetHeight;
      panel.style.setProperty(
        "--detail-code-height",
        `${Math.max(320, host.clientHeight - header.offsetHeight - other - 4)}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    observer.observe(header);
    return () => observer.disconnect();
  }, [row, column, techPointIndex, showGraphPanel]);

  const heading =
    selectedPoint?.title ??
    selectedPoint?.moduleName ??
    content?.heading ??
    row.title ??
    COLUMN_HEADING[column];
  const legacySummary =
    column === "requirement"
      ? row.requirement
      : column === "change"
        ? row.change
        : (row.api?.summary ?? "");
  const detailedSummary = content?.summary;
  const showLegacySummary =
    Boolean(detailedSummary) &&
    Boolean(legacySummary) &&
    detailedSummary !== legacySummary;
  const noApiChange = column === "api" && !rowApiChanged(row);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.body.classList.contains("david-gc-mode")) return;
      if (document.querySelector('[data-testid="david-feedback-panel"]'))
        return;
      if (document.querySelector(".trd-code-annotation-popup")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [onClose]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      onClose();
      return;
    }
  };

  const apiFieldIndex =
    column === "api" && onFieldClick
      ? (() => {
          const { columnFields, rootFields } = collectApiFields(
            apiDisplayContent,
            apiDisplayRow,
          );
          const itemFields =
            apiDisplayContent?.items?.flatMap((item) => item.fields ?? []) ??
            [];
          const seen = new Set<string>();
          return [...itemFields, ...columnFields, ...rootFields].filter(
            (field) => {
              if (seen.has(field.name)) return false;
              seen.add(field.name);
              return true;
            },
          );
        })()
      : [];

  const metaChips: string[] = [];
  if (row.reviewBrief?.changeType) metaChips.push(row.reviewBrief.changeType);
  if (row.reviewBrief?.status) metaChips.push(row.reviewBrief.status);
  if (content?.beId) metaChips.push(content.beId);
  if (content?.status) metaChips.push(content.status);
  if (content?.endpoint) metaChips.push(content.endpoint);
  const d2c = row.reviewBrief?.d2c ?? row.d2c;
  if (d2c) metaChips.push(`D2C：${d2c}`);

  // 内容密度：决定详情窗宽度档位。内容少时放大，便于逐行检查代码；
  // 内容多时保持标准宽度，避免一行过长影响阅读。
  const density = (() => {
    if (noApiChange) return "sparse";
    const codeBlocks =
      (content?.pseudoCode ? 1 : 0) +
      (content?.techPoints?.filter((tp) => tp.pseudoCode).length ?? 0) +
      (content?.items?.filter((item) => item.code).length ?? 0);
    const longestCode = Math.max(
      0,
      ...[
        content?.pseudoCode,
        ...(content?.techPoints?.map((tp) => tp.pseudoCode) ?? []),
        ...(content?.items?.map((item) => item.code) ?? []),
      ]
        .filter((code): code is string => typeof code === "string")
        .map((code) =>
          Math.max(...code.split("\n").map((line) => line.length)),
        ),
    );
    // 内容块只计真正占纵向篇幅的结构；字段索引是一行紧凑按钮列表，
    // 整体算 1 个块，不按字段个数累加，否则单代码块场景会被误判为密集。
    const blocks =
      (content?.sections?.length ?? 0) +
      (content?.techPoints?.length ?? 0) +
      (content?.items?.length ?? 0) +
      (content?.modules?.length ? 1 : 0) +
      (apiFieldIndex.length > 0 ? 1 : 0);
    // 单个代码块且整体块数很少 → 放大；宽代码行也需要更多横向空间
    if (codeBlocks === 1 && blocks <= 3) return "focus";
    if (codeBlocks === 0 && blocks <= 2) return "sparse";
    if (longestCode > 96) return "wide";
    return "default";
  })();

  return createPortal(
    <div
      ref={hostRef}
      className="rich-detail-host"
      data-preview-layout={previewBottom ? "stacked" : undefined}
      style={
        previewBottom
          ? { left: 22, top: previewBottom }
          : previewRight
            ? { left: previewRight }
            : undefined
      }
    >
      <div
        ref={panelRef}
        className="rich-detail"
        data-graph-placement={showGraphPanel ? "beside-preview" : "inline"}
        data-david-surface="rich-detail"
        data-david-density={density}
        data-david-component-id={componentId ?? ""}
        data-david-node-id={nodeId ?? ""}
        data-david-row-id={row.id}
        data-david-column={column}
        role="dialog"
        aria-modal={false}
        aria-label={heading}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="rich-detail-header">
          <div className="rich-detail-titles">
            <div className="rich-detail-eyebrow">
              {COLUMN_HEADING[column]}详情
            </div>
            <h3 className="rich-detail-title">{heading}</h3>
            {metaChips.length > 0 && (
              <div className="rich-detail-meta">
                {metaChips.map((chip, idx) => (
                  <span key={idx} className="rich-detail-meta-chip">
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rich-detail-close"
            aria-label="关闭详情"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        </div>
        <aside
          ref={setGraphHost}
          className="rich-detail-graphs"
          aria-label="当前功能的逻辑画板"
          hidden={!showGraphPanel}
          style={{
            left: previewRight,
            top: 22,
            width: Math.max(0, detailRight - previewRight),
            height: Math.max(0, previewBottom - 42),
          }}
        />
        <GraphPresentationContext.Provider
          value={showGraphPanel ? graphHost : null}
        >
          <div className="rich-detail-body">
            {noApiChange ? (
              <p className="rich-detail-no-api">
                本功能点未声明接口改动（api.changed = false），原 API
                区域已隐藏。
              </p>
            ) : (
              <>
                {column === "change" &&
                  techPointIndex === undefined &&
                  row.preparation && (
                    <PreparationPanel data={row.preparation} />
                  )}
                {showLegacySummary && (
                  <section className="rich-detail-legacy-summary">
                    <h4>具体改动说明</h4>
                    <p>{renderRichText(legacySummary)}</p>
                  </section>
                )}
                {/* Flat contracts sit directly above the contract code
                  blocks so field hover syncs with both code and page. */}
                {column === "api" && <RowContractPanel row={row} />}
                {renderOverviewCell(
                  column === "api"
                    ? omitPresentedApiFields(apiDisplayRow, apiFieldIndex)
                    : displayRow,
                  column,
                  focusSelection,
                  false,
                )}
                {techPointIndex === undefined &&
                  (level === "overview" || column === "change") &&
                  renderRowExtras(row)}
                {apiFieldIndex.length > 0 && (
                  <div className="rich-detail-fields">
                    <div className="rich-detail-fields-title">
                      字段索引（点击高亮，共 {apiFieldIndex.length} 个）
                    </div>
                    <div className="rich-detail-fields-list">
                      {apiFieldIndex.map((field) =>
                        renderApiFieldButton(field, activeField, (clicked) => {
                          if (onFieldClick) onFieldClick(clicked);
                          else toggleContractField(clicked);
                        }),
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </GraphPresentationContext.Provider>
      </div>
    </div>,
    document.body,
  );
}
