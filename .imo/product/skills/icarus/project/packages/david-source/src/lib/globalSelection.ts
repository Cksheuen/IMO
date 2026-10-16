import type { RefObject } from "react";
import { collectRegionText, type RegionText } from "./regionText";

export type GlobalSurfaces = Record<
  "page" | "overview" | "inspector" | "dock",
  RefObject<HTMLElement | null>
>;

export type GlobalSelectionScene = {
  pageId: string;
  componentId?: string;
  nodeId?: string;
  displayNodeId?: string;
  /** 评审阶段（page/entering/docked/leaving）；缺省时由捕获层按 body class 粗推。 */
  phase?: string;
};

/** 框选位置的锚点链：命中元素向上最近的稳定锚点。 */
export type SelectionAnchorChain = {
  componentId?: string;
  nodeId?: string;
  target?: string;
  /** 命中链路上 data-api-field 的并集（空格拆分、去重、有界）。 */
  apiFields?: string[];
};

/** 框选落在三列 TRD 区域时的行/列定位。 */
export type SelectionMappingContext = {
  rowId?: string;
  column?: "requirement" | "change" | "api" | "trd";
  rowLabel?: string;
};

/** 框选时刻的逻辑场景快照。 */
export type SelectionSceneContext = {
  phase?: string;
  pageId?: string;
  componentId?: string;
  nodeId?: string;
  /** 捕获时富详情 dialog 是否打开。 */
  detailOpen?: boolean;
};

/**
 * 外观框选的深度位置上下文（AppearanceSelection v1 可选扩展）。
 * 全部字段有界：字符串长度上限固定、数组项数固定、坐标必须有限。
 */
export type SelectionContext = {
  anchorChain?: SelectionAnchorChain;
  /** 命中元素文本，压缩空白后截断 ≤120 字符。 */
  textSnippet?: string;
  /** Rectangle-wide visible DOM text; textSnippet remains a legacy preview. */
  regionText?: RegionText;
  /** 最近的标题 / summary / aria-label / data-review-label，≤160 字符。 */
  heading?: string;
  mapping?: SelectionMappingContext;
  scene?: SelectionSceneContext;
  /** 经画板 transform 反算的画板逻辑坐标（无 transform 时省略）。 */
  canvasPoint?: { x: number; y: number };
  /** 简短 dom 路径，≤5 层、≤200 字符。 */
  domPath?: string;
};

export type AppearanceSelection = {
  version: 1;
  kind: "appearance-selection";
  capturedAt: string;
  surface: "page" | "overview" | "inspector" | "dock" | "shell" | "rich-detail";
  scene: GlobalSelectionScene;
  viewport: { width: number; height: number };
  windowScroll: { x: number; y: number };
  rect: { nx: number; ny: number; nw: number; nh: number };
  targets: Array<{
    targetId: string;
    label: string;
    kind: "review" | "shell" | "rich-detail";
  }>;
  detail?: {
    rowId: string;
    column: string;
    componentId?: string;
    nodeId?: string;
  };
  /** 深度位置上下文（v1 可选；旧数据无此字段仍可解析）。 */
  context?: SelectionContext;
};

type SurfaceKey = "page" | "overview" | "inspector" | "dock";
type Surface = SurfaceKey | "shell" | "rich-detail";
type Target = AppearanceSelection["targets"][number];
type RichDetail = NonNullable<AppearanceSelection["detail"]>;
type ShellRegion =
  "header" | "toolbar" | "comment-rail" | "feedback-panel" | "layout" | "shell";

type MappingColumn = NonNullable<SelectionMappingContext["column"]>;

const SURFACE_KEYS: SurfaceKey[] = ["page", "overview", "inspector", "dock"];

const SURFACE_LABELS: Record<SurfaceKey, string> = {
  page: "页面",
  overview: "概览",
  inspector: "检查器",
  dock: "停靠栏",
};

const SHELL_LABELS: Record<ShellRegion, string> = {
  header: "头部",
  toolbar: "工具栏",
  "comment-rail": "评论栏",
  "feedback-panel": "反馈面板",
  layout: "布局",
  shell: "外壳",
};

const ANCHOR_MAX_DEPTH = 8;
const HEADING_MAX_DEPTH = 12;
const DOMPATH_MAX_DEPTH = 5;
const TEXT_SNIPPET_MAX = 120;
const HEADING_MAX = 160;
const ROW_LABEL_MAX = 160;
const DOMPATH_MAX = 200;
const API_FIELDS_MAX = 16;
const API_FIELD_MAX = 128;
const ID_MAX = 512;

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, summary, [summary]";

const TRD_CELL_COLUMNS: ReadonlyArray<readonly [string, MappingColumn]> = [
  ["trd-cell-product", "requirement"],
  ["trd-cell-technical", "change"],
  ["trd-cell-api", "api"],
];

const finiteNumber = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const cleanId = (value: string | null | undefined, fallback: string): string =>
  (value?.trim() || fallback).slice(0, ID_MAX);

const cleanLabel = (
  value: string | null | undefined,
  fallback: string,
): string => (value?.replace(/\s+/g, " ").trim() || fallback).slice(0, 80);

const compressWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const sliceBounded = (value: string, max: number): string =>
  compressWhitespace(value).slice(0, max);

/**
 * 元素自身及祖先是否可用：无 hidden/inert/display:none/visibility 隐藏/opacity:0。
 * 不要求元素在视口内——屏幕外但有布局的目标仍可被 scrollIntoView 命中。
 */
export function hasUsableAncestry(start: Element): boolean {
  for (let node: Element | null = start; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert")) return false;

    const style = window.getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }

    if (parseFloat(style.opacity) === 0) return false;
  }

  return true;
}

function foregroundAt(x: number, y: number): Element | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (element.closest("[data-david-global-capture]")) continue;

    // The first non-captured foreground element is authoritative. Do not
    // inspect lower elements merely because this candidate is unusable.
    if (!hasUsableAncestry(element)) return null;
    return element;
  }

  return null;
}

function registeredSurfaceFor(
  element: Element,
  surfaces: GlobalSurfaces,
): SurfaceKey | null {
  let matchedKey: SurfaceKey | null = null;
  let matchedRoot: HTMLElement | null = null;

  for (const key of SURFACE_KEYS) {
    const root = surfaces[key].current;
    if (!root || !root.contains(element)) continue;

    if (!matchedRoot || matchedRoot.contains(root)) {
      matchedKey = key;
      matchedRoot = root;
    }
  }

  return matchedKey;
}

function shellRegionFor(element: Element): ShellRegion {
  if (
    element.closest(
      '.tools, [role="toolbar"], [data-david-shell="toolbar"], [data-david-surface="shell-toolbar"]',
    )
  ) {
    return "toolbar";
  }

  if (
    element.closest(
      'header, [data-david-shell="header"], [data-david-surface="shell-header"]',
    )
  ) {
    return "header";
  }

  if (
    element.closest(
      '.comment-rail, [data-david-surface="comment-rail"], [data-david-shell="comment-rail"], [data-comment-rail]',
    )
  ) {
    return "comment-rail";
  }

  if (element.closest('[data-testid="david-feedback-panel"]')) {
    return "feedback-panel";
  }

  if (
    element.closest(
      'main, [data-david-shell="layout"], [data-david-surface="layout"]',
    )
  ) {
    return "layout";
  }

  return "shell";
}

function attributeWithin(start: Element, root: Element, name: string): string {
  for (
    let node: Element | null = start;
    node && root.contains(node);
    node = node.parentElement
  ) {
    const value = node.getAttribute(name);
    if (value) return value;
  }

  return "";
}

function sampleFrom(
  element: Element,
  surfaces: GlobalSurfaces,
): { target: Target; surface: Surface; detail?: RichDetail } {
  const richRoot = element.closest('[data-david-surface="rich-detail"]');

  if (richRoot) {
    const rowId = attributeWithin(element, richRoot, "data-david-row-id");
    const column = attributeWithin(element, richRoot, "data-david-column");
    const componentId = attributeWithin(
      element,
      richRoot,
      "data-david-component-id",
    );
    const nodeId = attributeWithin(element, richRoot, "data-david-node-id");
    const review = element.closest("[data-review-target]");

    const syntheticId = `rich-detail:${rowId || "row"}:${column || "column"}${
      componentId ? `:${componentId}` : ""
    }${nodeId ? `:${nodeId}` : ""}`;

    const syntheticLabel = `Rich detail ${rowId || "row"} / ${column || "column"}`;

    return {
      surface: "rich-detail",
      target: {
        targetId: cleanId(
          review?.getAttribute("data-review-target"),
          syntheticId,
        ),
        label: cleanLabel(
          review?.getAttribute("data-review-label"),
          syntheticLabel,
        ),
        kind: "rich-detail",
      },
      detail: {
        rowId,
        column,
        ...(componentId ? { componentId } : {}),
        ...(nodeId ? { nodeId } : {}),
      },
    };
  }

  const registered = registeredSurfaceFor(element, surfaces);
  const review = element.closest("[data-review-target]");

  if (review) {
    return {
      surface: registered ?? "shell",
      target: {
        targetId: cleanId(
          review.getAttribute("data-review-target"),
          `review:${registered ?? "shell"}`,
        ),
        label: cleanLabel(
          review.getAttribute("data-review-label"),
          "Review target",
        ),
        kind: "review",
      },
    };
  }

  if (registered) {
    return {
      surface: registered,
      target: {
        targetId: `surface:${registered}`,
        label: SURFACE_LABELS[registered],
        kind: "shell",
      },
    };
  }

  const region = shellRegionFor(element);
  return {
    surface: "shell",
    target: {
      targetId: `shell:${region}`,
      label: SHELL_LABELS[region],
      kind: "shell",
    },
  };
}

/**
 * 从命中元素向上（含自身，最多 maxDepth 层）收集最近的稳定锚点。
 * componentId / nodeId / target 取最近一个非空值；apiFields 为链路上
 * data-api-field（空格拆分）的有界并集。纯函数，只依赖入参 element。
 */
export function collectAnchorChain(
  start: Element,
  maxDepth = ANCHOR_MAX_DEPTH,
): SelectionAnchorChain | undefined {
  let componentId: string | undefined;
  let nodeId: string | undefined;
  let target: string | undefined;
  const apiFields: string[] = [];

  let depth = 0;
  for (
    let node: Element | null = start;
    node && depth < maxDepth;
    node = node.parentElement, depth += 1
  ) {
    if (componentId === undefined) {
      const value = node.getAttribute("data-component-id")?.trim();
      if (value) componentId = value.slice(0, ID_MAX);
    }
    if (nodeId === undefined) {
      const value = node.getAttribute("data-review-node-id")?.trim();
      if (value) nodeId = value.slice(0, ID_MAX);
    }
    if (target === undefined) {
      const value = node.getAttribute("data-review-target")?.trim();
      if (value) target = value.slice(0, ID_MAX);
    }
    const apiValue = [
      node.getAttribute("data-api-field"),
      node.getAttribute("data-contract-field"),
    ]
      .filter(Boolean)
      .join(" ");
    if (apiValue) {
      for (const token of apiValue.split(/\s+/)) {
        const cleaned = token.trim();
        if (
          cleaned &&
          !apiFields.includes(cleaned) &&
          apiFields.length < API_FIELDS_MAX
        ) {
          apiFields.push(cleaned.slice(0, API_FIELD_MAX));
        }
      }
    }
  }

  if (
    componentId === undefined &&
    nodeId === undefined &&
    target === undefined &&
    apiFields.length === 0
  ) {
    return undefined;
  }

  return {
    ...(componentId ? { componentId } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(target ? { target } : {}),
    ...(apiFields.length > 0 ? { apiFields } : {}),
  };
}

/** 命中元素 textContent 压缩空白后截断 ≤120 字符。 */
export function collectTextSnippet(element: Element): string | undefined {
  const text = compressWhitespace(element.textContent ?? "");
  return text ? text.slice(0, TEXT_SNIPPET_MAX) : undefined;
}

/**
 * 向上查找最近的标题/摘要：每层依次检查 h1-h6 / <summary> / [summary]、
 * data-review-label、aria-label，取第一个非空值。
 */
export function findNearestHeading(
  start: Element,
  maxDepth = HEADING_MAX_DEPTH,
): string | undefined {
  let depth = 0;
  for (
    let node: Element | null = start;
    node && depth < maxDepth;
    node = node.parentElement, depth += 1
  ) {
    if (typeof node.matches === "function" && node.matches(HEADING_SELECTOR)) {
      const text = compressWhitespace(node.textContent ?? "");
      if (text) return text.slice(0, HEADING_MAX);
    }
    const reviewLabel = node.getAttribute("data-review-label")?.trim();
    if (reviewLabel) return sliceBounded(reviewLabel, HEADING_MAX);
    const ariaLabel = node.getAttribute("aria-label")?.trim();
    if (ariaLabel) return sliceBounded(ariaLabel, HEADING_MAX);
  }

  return undefined;
}

const parseColumnToken = (
  value: string | null | undefined,
): MappingColumn | undefined => {
  const token = value?.trim().toLowerCase();
  if (
    token === "requirement" ||
    token === "change" ||
    token === "api" ||
    token === "trd"
  ) {
    return token;
  }
  return undefined;
};

/**
 * 解析框选落点对应的 TRD 行/列。
 * 行标记优先级：rich-detail 的 data-david-row-id → data-trd-row（组件 TRD 表）
 * → data-mapping-id（总览表）；列由单元格类名 / data-review-target 后缀 /
 * data-david-column 推断；落在行内但不属于具体列时归为 "trd"。
 */
export function findMappingContext(
  start: Element,
): SelectionMappingContext | undefined {
  let rowId: string | undefined;
  let column: MappingColumn | undefined;
  let rowLabel: string | undefined;

  const richRoot = start.closest('[data-david-surface="rich-detail"]');
  const richRow = start.closest("[data-david-row-id]");
  if (richRow && (!richRoot || richRoot.contains(richRow))) {
    rowId = richRow.getAttribute("data-david-row-id")?.trim() || undefined;
    column = parseColumnToken(richRow.getAttribute("data-david-column"));
  }

  if (!rowId) {
    const trdRow = start.closest("[data-trd-row]");
    if (trdRow) {
      rowId = trdRow.getAttribute("data-trd-row")?.trim() || undefined;
      const titleEl = trdRow.querySelector(".trd-feature-title");
      const title = compressWhitespace(titleEl?.textContent ?? "");
      if (title) rowLabel = title.slice(0, ROW_LABEL_MAX);
    }
  }

  if (!rowId) {
    const mappingRow = start.closest("[data-mapping-id]");
    if (mappingRow) {
      rowId = mappingRow.getAttribute("data-mapping-id")?.trim() || undefined;
    }
  }

  if (!column) {
    for (const [className, cellColumn] of TRD_CELL_COLUMNS) {
      if (start.closest(`.${className}`)) {
        column = cellColumn;
        break;
      }
    }
  }

  if (!column) {
    const targetEl = start.closest("[data-review-target]");
    const targetToken = targetEl?.getAttribute("data-review-target") ?? "";
    const suffix = /:(requirement|change|api|trd)$/i.exec(targetToken);
    if (suffix) {
      column = parseColumnToken(suffix[1]);
    } else {
      const columnHost = start.closest("[data-david-column]");
      column = parseColumnToken(columnHost?.getAttribute("data-david-column"));
    }
  }

  if (!rowLabel) {
    const labelled = start.closest("[data-review-label]");
    const label = compressWhitespace(
      labelled?.getAttribute("data-review-label") ?? "",
    );
    if (label) rowLabel = label.slice(0, ROW_LABEL_MAX);
  }

  if (!rowId && !column) return undefined;

  return {
    ...(rowId ? { rowId: rowId.slice(0, ID_MAX) } : {}),
    // 落在行内但无法定位具体列时，归为整行（trd）而非编造列名。
    ...(column ? { column } : rowId ? { column: "trd" as const } : {}),
    ...(rowLabel ? { rowLabel } : {}),
  };
}

/** 命中元素 tag + 类名链（≤maxDepth 层、每层最多 2 个类、总长 ≤200 字符）。 */
export function buildDomPath(
  start: Element,
  maxDepth = DOMPATH_MAX_DEPTH,
): string | undefined {
  const parts: string[] = [];
  let depth = 0;
  for (
    let node: Element | null = start;
    node &&
    depth < maxDepth &&
    node !== document.body &&
    node !== document.documentElement;
    node = node.parentElement, depth += 1
  ) {
    const tag = node.tagName.toLowerCase();
    const classNames = typeof node.className === "string" ? node.className : "";
    const classSuffix = classNames
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    parts.push(`${tag}${classSuffix}`);
  }

  if (parts.length === 0) return undefined;
  const path = parts.join(" > ");
  return path ? path.slice(0, DOMPATH_MAX) : undefined;
}

/**
 * 汇总命中元素的深度位置上下文（纯 DOM 读取 + 入参 scene/canvasPoint）。
 * scene.phase 缺省时按 body class 粗推（is-inspector-open → docked，否则 page）；
 * canvasPoint 由调用方经画板 transform 反算后传入，未传则省略。
 */
export function deriveSelectionContext(
  element: Element,
  scene: GlobalSelectionScene,
  canvasPoint?: { x: number; y: number },
): SelectionContext {
  const anchorChain = collectAnchorChain(element);
  const textSnippet = collectTextSnippet(element);
  const heading = findNearestHeading(element);
  const mapping = findMappingContext(element);
  const domPath = buildDomPath(element);

  const detailOpen = Boolean(
    document.querySelector('[data-david-surface="rich-detail"]'),
  );
  const phase =
    scene.phase ??
    (document.body.classList.contains("is-inspector-open") ? "docked" : "page");

  const contextScene: SelectionSceneContext = {
    phase,
    pageId: scene.pageId,
    ...(scene.componentId ? { componentId: scene.componentId } : {}),
    ...(scene.nodeId ? { nodeId: scene.nodeId } : {}),
    ...(detailOpen ? { detailOpen: true } : {}),
  };

  return {
    ...(anchorChain ? { anchorChain } : {}),
    ...(textSnippet ? { textSnippet } : {}),
    ...(heading ? { heading } : {}),
    ...(mapping ? { mapping } : {}),
    scene: contextScene,
    ...(canvasPoint &&
    Number.isFinite(canvasPoint.x) &&
    Number.isFinite(canvasPoint.y)
      ? { canvasPoint: { x: canvasPoint.x, y: canvasPoint.y } }
      : {}),
    ...(domPath ? { domPath } : {}),
  };
}

export function captureAppearance(
  rect: { x: number; y: number; width: number; height: number },
  surfaces: GlobalSurfaces,
  scene: GlobalSelectionScene,
  capturedAt?: string,
  canvasPoint?: { x: number; y: number },
): AppearanceSelection {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);

  const rawLeft = finiteNumber(Math.min(rect.x, rect.x + rect.width));
  const rawRight = finiteNumber(Math.max(rect.x, rect.x + rect.width));
  const rawTop = finiteNumber(Math.min(rect.y, rect.y + rect.height));
  const rawBottom = finiteNumber(Math.max(rect.y, rect.y + rect.height));

  const left = clamp(rawLeft, 0, viewportWidth);
  const right = clamp(rawRight, 0, viewportWidth);
  const top = clamp(rawTop, 0, viewportHeight);
  const bottom = clamp(rawBottom, 0, viewportHeight);

  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const points: Array<[number, number]> = [
    [left, top],
    [centerX, top],
    [right, top],
    [left, centerY],
    [centerX, centerY],
    [right, centerY],
    [left, bottom],
    [centerX, bottom],
    [right, bottom],
  ];

  const targets: Target[] = [];
  const surfaceVotes = new Map<Surface, number>();
  let detail: RichDetail | undefined;
  let firstHit: Element | null = null;

  for (const [x, y] of points) {
    const element = foregroundAt(x, y);
    if (!element) continue;
    if (!firstHit) firstHit = element;

    const sample = sampleFrom(element, surfaces);
    surfaceVotes.set(
      sample.surface,
      (surfaceVotes.get(sample.surface) ?? 0) + 1,
    );

    if (!detail && sample.detail) detail = sample.detail;

    if (
      targets.length < 12 &&
      !targets.some((target) => target.targetId === sample.target.targetId)
    ) {
      targets.push(sample.target);
    }
  }

  if (targets.length === 0) {
    targets.push({
      targetId: "shell:layout",
      label: SHELL_LABELS.layout,
    } as Target);
  }

  let surface: Surface = "shell";
  let bestVote = 0;
  surfaceVotes.forEach((count, candidate) => {
    if (count > bestVote) {
      bestVote = count;
      surface = candidate;
    }
  });

  // 深度上下文以矩形中心点命中的元素为准（中心点落在捕获层/遮挡元素上时
  // 退化为第一个可用命中点）。
  const contextElement = foregroundAt(centerX, centerY) ?? firstHit;
  const context: SelectionContext = contextElement
    ? deriveSelectionContext(contextElement, scene, canvasPoint)
    : {};
  context.regionText = collectRegionText(
    { x: left, y: top, width: right - left, height: bottom - top },
    document.body,
    (element) => {
      const sample = sampleFrom(element, surfaces);
      if (
        targets.length < 12 &&
        !targets.some((target) => target.targetId === sample.target.targetId)
      ) {
        targets.push(sample.target);
      }
    },
  );
  // Never fall back to the center element's out-of-rectangle text in blank areas.
  delete context.textSnippet;
  if (context.regionText.text) {
    const preview = compressWhitespace(context.regionText.text);
    context.textSnippet =
      preview.length > TEXT_SNIPPET_MAX
        ? `${preview.slice(0, TEXT_SNIPPET_MAX - 1)}…`
        : preview;
  }

  return {
    version: 1,
    kind: "appearance-selection",
    capturedAt: capturedAt ?? new Date().toISOString(),
    surface,
    scene: { ...scene },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    windowScroll: {
      x: window.scrollX,
      y: window.scrollY,
    },
    rect: {
      nx: left / viewportWidth,
      ny: top / viewportHeight,
      nw: (right - left) / viewportWidth,
      nh: (bottom - top) / viewportHeight,
    },
    targets,
    ...(detail ? { detail } : {}),
    ...(context ? { context } : {}),
  };
}
