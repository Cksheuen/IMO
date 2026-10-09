import {
  Fragment,
  useCallback,
  useId,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import "../styles/code-block.css";

import { HoverPopover, type HoverPopoverHandle } from "./HoverPopover";
import type { DiffDisplayLine } from "../lib/lineDiff";
import type { CodeAnnotation } from "../types/review";
import {
  highlightCode,
  isValidCodeHighlights,
  type CodeHighlightRule,
} from "../lib/codeHighlights";
import { supportsReducedMotion } from "../lib/flip";
import { codeHoverIsIdle, useCodeHoverScroll } from "../lib/codeHoverScroll";

type ParsedLine = {
  isHl: boolean;
  isTrack: boolean;
  codePart: string;
  commentPart: string;
};

// eslint-disable-next-line react-refresh/only-export-components -- pure parser shared with tests
export function parseLine(line: string): ParsedLine {
  const isHl = /^\+ /.test(line);
  const isTrack = !isHl && /^~ /.test(line);
  const cleanLine = isHl || isTrack ? line.slice(2) : line;

  let commentIdx = -1;
  let from = 0;
  while (true) {
    const k = cleanLine.indexOf("//", from);
    if (k === -1) break;
    if (k === 0 || cleanLine[k - 1] !== ":") {
      commentIdx = k;
      break;
    }
    from = k + 2;
  }

  let codePart = cleanLine;
  let commentPart = "";
  if (commentIdx >= 0) {
    codePart = cleanLine.slice(0, commentIdx);
    commentPart = cleanLine.slice(commentIdx);
  }

  return { isHl, isTrack, codePart, commentPart };
}

export function CodeBlock({
  code,
  codeLabel,
  annotations = [],
  alignedLines,
  highlights = [],
  lineNumbers,
  definitionLinks = {},
}: {
  code?: string;
  codeLabel?: string;
  annotations?: CodeAnnotation[];
  alignedLines?: DiffDisplayLine[];
  highlights?: CodeHighlightRule[];
  /** Relative 1-based definition lines, resolved by the feature owner. */
  definitionLinks?: Record<string, { line: number; label?: string }>;
  /** Original source lines; null denotes a synthetic or omitted-source line. */
  lineNumbers?: (number | null)[];
}) {
  const blockRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ranges, setRanges] = useState<
    {
      top: number;
      left: number;
      width: number;
      height: number;
    }[]
  >([]);
  const popoverRef = useRef<HoverPopoverHandle>(null);
  const popupId = useId();
  const [definitionTarget, setDefinitionTarget] = useState<{
    line: number;
  } | null>(null);
  const [popup, setPopup] = useState<{
    annotation: CodeAnnotation;
    line: number;
  } | null>(null);
  // Track-line segments are collapsed by default; each consecutive run of
  // "~ "-prefixed lines is an independently toggleable segment.
  const [expandedTracks, setExpandedTracks] = useState<Set<number>>(
    () => new Set(),
  );
  const open = popup !== null;

  const clearCloseTimer = useCallback(() => {
    popoverRef.current?.clearCloseTimer();
  }, []);

  const scheduleClose = useCallback(() => {
    popoverRef.current?.scheduleClose();
  }, []);

  const closeNow = useCallback(() => {
    popoverRef.current?.clearCloseTimer();
    setPopup(null);
  }, []);
  const openPopup = (lineIdx: number, annotation: CodeAnnotation) => {
    if (!codeHoverIsIdle()) return;
    if (popup?.annotation === annotation) {
      clearCloseTimer();
      return;
    }
    const lineEl = blockRef.current?.querySelector<HTMLElement>(
      `[data-line="${lineIdx + 1}"]`,
    );
    if (!lineEl) return;
    popoverRef.current?.clearCloseTimer();
    setPopup({ annotation, line: lineIdx + 1 });
  };
  useCodeHoverScroll(closeNow, () => {
    const line = bodyRef.current?.querySelector<HTMLElement>(".trd-ln:hover");
    if (!line?.classList.contains("is-annotation")) return;
    const number = Number(line.dataset.line);
    const annotation = annotations.find(
      (a) => number >= a.startLine && number <= a.endLine,
    );
    if (annotation) openPopup(number - 1, annotation);
  });

  const toggleTrack = useCallback((segIdx: number) => {
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(segIdx)) next.delete(segIdx);
      else next.add(segIdx);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!popup || !body) {
      setRanges((old) => (old.length ? [] : old));
      return;
    }
    const update = () => {
      const groups: HTMLElement[][] = [];
      let previous: HTMLElement | undefined;
      for (const line of body.querySelectorAll<HTMLElement>(".trd-ln")) {
        if (!line.classList.contains("is-annotation-active")) {
          previous = undefined;
          continue;
        }
        if (previous?.nextElementSibling === line) groups.at(-1)!.push(line);
        else groups.push([line]);
        previous = line;
      }
      const next = groups.map((group) => {
        const first = group[0],
          last = group[group.length - 1];
        return {
          top: first.offsetTop,
          left: body.scrollLeft,
          width: body.clientWidth,
          height: last.offsetTop + last.offsetHeight - first.offsetTop,
        };
      });
      setRanges((old) =>
        old.length === next.length &&
        next.every(
          (rect, i) =>
            rect.top === old[i].top &&
            rect.left === old[i].left &&
            rect.width === old[i].width &&
            rect.height === old[i].height,
        )
          ? old
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [popup, alignedLines, expandedTracks]);

  useLayoutEffect(() => {
    if (!definitionTarget) return;
    const line = bodyRef.current?.querySelector<HTMLElement>(
      `.trd-ln[data-line="${definitionTarget.line}"]`,
    );
    if (!line) return;
    line.focus({ preventScroll: true });
    line.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: supportsReducedMotion() ? "instant" : "smooth",
    });
  }, [definitionTarget, expandedTracks]);

  if (!code && !alignedLines) return null;

  const lines = (code ?? "").split("\n");
  const parsedLines = lines.map((line) =>
    alignedLines
      ? {
          isHl: false,
          isTrack: /^~ /.test(line),
          codePart: line,
          commentPart: "",
        }
      : parseLine(line),
  );
  const hasHighlights = parsedLines.some((p) => p.isHl);
  const hasTracks = parsedLines.some((p) => p.isTrack);

  // Group consecutive track lines into segments and map each line to its segment.
  const trackSegments: { start: number; end: number }[] = [];
  parsedLines.forEach((p, i) => {
    if (!p.isTrack) return;
    const last = trackSegments[trackSegments.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else trackSegments.push({ start: i, end: i });
  });
  const segmentByLine = new Map<number, number>();
  trackSegments.forEach((seg, segIdx) => {
    for (let i = seg.start; i <= seg.end; i++) segmentByLine.set(i, segIdx);
  });

  const annotationForLine = (idx: number) =>
    lines[idx]?.trim()
      ? annotations.find((a) => idx + 1 >= a.startLine && idx + 1 <= a.endLine)
      : undefined;

  if (!isValidCodeHighlights(highlights))
    throw new Error("Invalid code highlight rules");
  if (
    lineNumbers &&
    (lineNumbers.length !== lines.length ||
      lineNumbers.some(
        (n) => n !== null && (!Number.isSafeInteger(n) || n < 1),
      ))
  )
    throw new Error("Invalid source line numbers");
  const colored = (text: string, interactive = true) =>
    highlightCode(text, highlights).map((part, i) => {
      if (!part.rule) return part.text;
      const target = Object.hasOwn(definitionLinks, part.text)
        ? definitionLinks[part.text]
        : undefined;
      const valid =
        interactive &&
        !alignedLines &&
        target &&
        Number.isSafeInteger(target.line) &&
        target.line > 0 &&
        target.line <= lines.length;
      const attrs = {
        "data-code-kind": part.rule.kind,
        "data-code-tone": part.rule.tone,
      };
      return valid ? (
        <button
          key={i}
          type="button"
          className="trd-code-symbol-link"
          {...attrs}
          aria-label={`跳转到 ${target.label ?? part.text} 的定义`}
          title={`跳转到 ${target.label ?? part.text} 的定义`}
          onFocus={(event) => {
            event.stopPropagation();
            closeNow();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (
              document.body.classList.contains("david-gc-mode") ||
              window.getSelection()?.isCollapsed === false
            )
              return;
            closeNow();
            const segment = trackSegments.findIndex(
              (s) => target.line - 1 >= s.start && target.line - 1 <= s.end,
            );
            if (segment >= 0)
              setExpandedTracks((previous) => new Set([...previous, segment]));
            setDefinitionTarget({ line: target.line });
          }}
        >
          {part.text}
        </button>
      ) : (
        <span key={i} {...attrs}>
          {part.text}
        </span>
      );
    });
  const renderLine = (
    idx: number,
    diffLine?: DiffDisplayLine,
    rowIndex?: number,
  ) => {
    const { isHl, isTrack, codePart, commentPart } = parsedLines[idx];
    const annotation = annotationForLine(idx);
    const isActive =
      !!annotation &&
      !!popup &&
      popup.annotation.startLine === annotation.startLine &&
      popup.annotation.endLine === annotation.endLine;
    const isFirst = annotation && idx + 1 === annotation.startLine;

    return (
      <div
        key={rowIndex ?? idx}
        data-line={idx + 1}
        data-source-line={lineNumbers?.[idx] ?? undefined}
        data-diff-row={rowIndex}
        data-diff-kind={diffLine?.kind}
        className={[
          "trd-ln",
          definitionTarget?.line === idx + 1 ? "is-definition-target" : "",
          diffLine ? `is-diff-${diffLine.kind}` : "",
          isHl ? "is-highlight" : "",
          isTrack ? "is-track" : "",
          annotation ? "is-annotation" : "",
          isActive ? "is-annotation-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseEnter={annotation ? () => openPopup(idx, annotation) : closeNow}
        onMouseMove={annotation ? () => openPopup(idx, annotation) : undefined}
        onFocus={isFirst ? () => openPopup(idx, annotation) : undefined}
        onBlur={scheduleClose}
        tabIndex={
          definitionTarget?.line === idx + 1 ? -1 : isFirst ? 0 : undefined
        }
        aria-describedby={isFirst && isActive ? popupId : undefined}
      >
        {diffLine && (
          <span className="dv-diff-row-marker" aria-hidden="true">
            {diffLine.kind === "removed"
              ? "−"
              : diffLine.kind === "added"
                ? "+"
                : " "}
          </span>
        )}
        <span
          className="trd-ln-no"
          style={
            lineNumbers
              ? {
                  minWidth: `${Math.max(3, ...lineNumbers.map((n) => String(n ?? "").length)) + 1}ch`,
                }
              : undefined
          }
        >
          {lineNumbers ? (lineNumbers[idx] ?? "—") : idx + 1}
        </span>
        <span className="trd-ln-text">
          {colored(codePart)}
          {commentPart && (
            <span className="trd-ln-comment">
              {colored(commentPart, false)}
            </span>
          )}
        </span>
        {isTrack && <span className="trd-ln-track-badge">埋点</span>}
      </div>
    );
  };

  return (
    <div
      className="trd-codeblk"
      ref={blockRef}
      onMouseLeave={scheduleClose}
      onMouseEnter={clearCloseTimer}
    >
      {(codeLabel || hasHighlights || hasTracks || highlights.length > 0) && (
        <div className="trd-cb-bar">
          <span className="trd-cb-lang">{codeLabel || "契约代码"}</span>
          <span className="trd-cb-legends">
            {highlights
              .filter(
                (rule) =>
                  rule.legend !== false &&
                  rule.tokens.some((token) =>
                    lines.some((line) => line.includes(token)),
                  ),
              )
              .map((rule) => (
                <span
                  key={rule.kind}
                  className="trd-cb-legend"
                  data-code-tone={rule.tone}
                >
                  {rule.label}
                </span>
              ))}
            {hasHighlights && (
              <span className="trd-cb-legend">
                <i>+ 行</i> = 本次新增 / 改动
              </span>
            )}
            {hasTracks && (
              <span className="trd-cb-legend">
                <i>~ 行</i> = 埋点{alignedLines ? "" : "（默认折叠）"}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="trd-cb-body" ref={bodyRef}>
        {ranges.map((range) => (
          <div
            key={range.top}
            className="trd-code-selection-range"
            aria-hidden="true"
            style={range}
          />
        ))}
        {alignedLines
          ? alignedLines.map((line, rowIndex) =>
              line.line === null ? (
                <div
                  key={rowIndex}
                  className="trd-ln is-diff-empty"
                  data-diff-row={rowIndex}
                  data-diff-kind="empty"
                  aria-hidden="true"
                >
                  <span className="dv-diff-row-marker"> </span>
                  <span className="trd-ln-no"> </span>
                  <span className="trd-ln-text"> </span>
                </div>
              ) : (
                renderLine(line.line - 1, line, rowIndex)
              ),
            )
          : lines.map((_, idx) => {
              const segIdx = segmentByLine.get(idx);
              if (segIdx === undefined) return renderLine(idx);

              const seg = trackSegments[segIdx];
              const isOpen = expandedTracks.has(segIdx);
              const toggle =
                idx === seg.start ? (
                  <button
                    key={`track-toggle-${idx}`}
                    type="button"
                    className="trd-track-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggleTrack(segIdx)}
                  >
                    ⌁ 埋点代码 {seg.end - seg.start + 1} 行 ·{" "}
                    {isOpen ? "收起" : "展开"}
                  </button>
                ) : null;

              if (!isOpen) return toggle;
              return (
                <Fragment key={idx}>
                  {toggle}
                  {renderLine(idx)}
                </Fragment>
              );
            })}
      </div>
      <HoverPopover
        ref={popoverRef}
        open={open}
        onClose={closeNow}
        anchor={() =>
          popup
            ? (blockRef.current?.querySelector<HTMLElement>(
                `[data-line="${popup.line}"]`,
              ) ?? null)
            : null
        }
        reference={() => blockRef.current}
        className="trd-code-annotation-popup"
        id={popupId}
      >
        {popup && (
          <>
            <strong>{popup.annotation.title}</strong>
            <ul>
              {popup.annotation.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          </>
        )}
      </HoverPopover>
    </div>
  );
}
