/**
 * AppearanceSelection 严格校验（含 v1 可选 selection.context 深度上下文）。
 * 规则：未知字段拒绝、字符串长度上限、坐标有限数、枚举值合法。
 * 旧 v1 数据（无 context）行为不变。
 */

import type { AppearanceSelection, SelectionContext } from "../globalSelection";
import { REGION_TEXT_MAX } from "../regionText.ts";

import { isRecord, rejectUnknownKeys } from "./guards.ts";

const ID_MAX = 512;
const TEXT_SNIPPET_MAX = 120;
const HEADING_MAX = 160;
const ROW_LABEL_MAX = 160;
const DOMPATH_MAX = 200;
const API_FIELDS_MAX = 16;
const API_FIELD_MAX = 128;
const COORDINATE_ABS_MAX = 1e9;

const requireString = (
  item: unknown,
  itemPath: string,
  maxLength = ID_MAX,
): string => {
  if (
    typeof item !== "string" ||
    item.trim().length === 0 ||
    item.length > maxLength
  ) {
    throw new Error(`${itemPath} 必须为不超过 ${maxLength} 字符的非空字符串`);
  }
  return item;
};

const requireFiniteNumber = (item: unknown, itemPath: string): number => {
  if (typeof item !== "number" || !Number.isFinite(item)) {
    throw new Error(`${itemPath} 必须为有限数字`);
  }
  return item;
};

const SELECTION_PHASES = ["page", "entering", "docked", "leaving"] as const;

/** 严格校验 selection.context；返回规范化后的有界对象。 */
export const validateSelectionContext = (
  value: unknown,
  path: string,
): SelectionContext => {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  rejectUnknownKeys(
    value,
    [
      "anchorChain",
      "textSnippet",
      "regionText",
      "heading",
      "mapping",
      "scene",
      "canvasPoint",
      "domPath",
    ],
    path,
  );

  const out: SelectionContext = {};

  if (value.regionText !== undefined) {
    const region = value.regionText;
    if (!isRecord(region)) throw new Error(`${path}.regionText 必须是对象`);
    rejectUnknownKeys(region, ["text", "truncated"], `${path}.regionText`);
    if (
      typeof region.text !== "string" ||
      region.text.length > REGION_TEXT_MAX ||
      typeof region.truncated !== "boolean"
    ) {
      throw new Error(
        `${path}.regionText 必须包含不超过 ${REGION_TEXT_MAX} 字符的 text 和 boolean truncated`,
      );
    }
    out.regionText = { text: region.text, truncated: region.truncated };
  }

  if (value.anchorChain !== undefined) {
    const anchor = value.anchorChain;
    if (!isRecord(anchor)) throw new Error(`${path}.anchorChain 必须是对象`);
    rejectUnknownKeys(
      anchor,
      ["componentId", "nodeId", "target", "apiFields"],
      `${path}.anchorChain`,
    );
    const chain: NonNullable<SelectionContext["anchorChain"]> = {};
    (["componentId", "nodeId", "target"] as const).forEach((key) => {
      if (anchor[key] !== undefined) {
        chain[key] = requireString(anchor[key], `${path}.anchorChain.${key}`);
      }
    });
    if (anchor.apiFields !== undefined) {
      if (
        !Array.isArray(anchor.apiFields) ||
        anchor.apiFields.some((field) => typeof field !== "string")
      ) {
        throw new Error(`${path}.anchorChain.apiFields 必须为字符串数组`);
      }
      if (
        anchor.apiFields.length < 1 ||
        anchor.apiFields.length > API_FIELDS_MAX
      ) {
        throw new Error(
          `${path}.anchorChain.apiFields 长度必须为 1 到 ${API_FIELDS_MAX}`,
        );
      }
      chain.apiFields = anchor.apiFields.map((field, index) =>
        requireString(
          field,
          `${path}.anchorChain.apiFields[${index}]`,
          API_FIELD_MAX,
        ),
      );
    }
    if (Object.keys(chain).length === 0) {
      throw new Error(`${path}.anchorChain 不能为空对象`);
    }
    out.anchorChain = chain;
  }

  if (value.textSnippet !== undefined) {
    out.textSnippet = requireString(
      value.textSnippet,
      `${path}.textSnippet`,
      TEXT_SNIPPET_MAX,
    );
  }

  if (value.heading !== undefined) {
    out.heading = requireString(value.heading, `${path}.heading`, HEADING_MAX);
  }

  if (value.mapping !== undefined) {
    const mapping = value.mapping;
    if (!isRecord(mapping)) throw new Error(`${path}.mapping 必须是对象`);
    rejectUnknownKeys(
      mapping,
      ["rowId", "column", "rowLabel"],
      `${path}.mapping`,
    );
    const normalized: NonNullable<SelectionContext["mapping"]> = {};
    if (mapping.rowId !== undefined) {
      normalized.rowId = requireString(mapping.rowId, `${path}.mapping.rowId`);
    }
    if (mapping.column !== undefined) {
      if (
        mapping.column !== "requirement" &&
        mapping.column !== "change" &&
        mapping.column !== "api" &&
        mapping.column !== "trd"
      ) {
        throw new Error(`${path}.mapping.column 取值无效`);
      }
      normalized.column = mapping.column;
    }
    if (mapping.rowLabel !== undefined) {
      normalized.rowLabel = requireString(
        mapping.rowLabel,
        `${path}.mapping.rowLabel`,
        ROW_LABEL_MAX,
      );
    }
    if (Object.keys(normalized).length === 0) {
      throw new Error(`${path}.mapping 不能为空对象`);
    }
    out.mapping = normalized;
  }

  if (value.scene !== undefined) {
    const scene = value.scene;
    if (!isRecord(scene)) throw new Error(`${path}.scene 必须是对象`);
    rejectUnknownKeys(
      scene,
      ["phase", "pageId", "componentId", "nodeId", "detailOpen"],
      `${path}.scene`,
    );
    const normalized: NonNullable<SelectionContext["scene"]> = {};
    if (scene.phase !== undefined) {
      if (
        typeof scene.phase !== "string" ||
        !SELECTION_PHASES.includes(
          scene.phase as (typeof SELECTION_PHASES)[number],
        )
      ) {
        throw new Error(`${path}.scene.phase 取值无效`);
      }
      normalized.phase = scene.phase;
    }
    if (scene.pageId !== undefined) {
      normalized.pageId = requireString(scene.pageId, `${path}.scene.pageId`);
    }
    if (scene.componentId !== undefined) {
      normalized.componentId = requireString(
        scene.componentId,
        `${path}.scene.componentId`,
      );
    }
    if (scene.nodeId !== undefined) {
      normalized.nodeId = requireString(scene.nodeId, `${path}.scene.nodeId`);
    }
    if (scene.detailOpen !== undefined) {
      if (typeof scene.detailOpen !== "boolean") {
        throw new Error(`${path}.scene.detailOpen 必须为布尔值`);
      }
      normalized.detailOpen = scene.detailOpen;
    }
    if (Object.keys(normalized).length === 0) {
      throw new Error(`${path}.scene 不能为空对象`);
    }
    out.scene = normalized;
  }

  if (value.canvasPoint !== undefined) {
    const point = value.canvasPoint;
    if (!isRecord(point)) throw new Error(`${path}.canvasPoint 必须是对象`);
    rejectUnknownKeys(point, ["x", "y"], `${path}.canvasPoint`);
    const x = requireFiniteNumber(point.x, `${path}.canvasPoint.x`);
    const y = requireFiniteNumber(point.y, `${path}.canvasPoint.y`);
    if (Math.abs(x) > COORDINATE_ABS_MAX || Math.abs(y) > COORDINATE_ABS_MAX) {
      throw new Error(
        `${path}.canvasPoint 坐标绝对值必须不超过 ${COORDINATE_ABS_MAX}`,
      );
    }
    out.canvasPoint = { x, y };
  }

  if (value.domPath !== undefined) {
    out.domPath = requireString(value.domPath, `${path}.domPath`, DOMPATH_MAX);
  }

  return out;
};

/** 严格校验 AppearanceSelection（v1，context 可选）。 */
export const validateAppearanceSelection = (
  value: unknown,
  path: string,
): AppearanceSelection => {
  const requireRecord = (
    item: unknown,
    itemPath: string,
  ): Record<string, unknown> => {
    if (!isRecord(item)) throw new Error(`${itemPath} 必须是对象`);
    return item;
  };

  const root = requireRecord(value, path);
  rejectUnknownKeys(
    root,
    [
      "version",
      "kind",
      "capturedAt",
      "surface",
      "scene",
      "viewport",
      "windowScroll",
      "rect",
      "targets",
      "detail",
      "context",
    ],
    path,
  );
  if (root.version !== 1) throw new Error(`${path}.version 必须为 1`);
  if (root.kind !== "appearance-selection")
    throw new Error(`${path}.kind 必须为 appearance-selection`);
  requireString(root.capturedAt, `${path}.capturedAt`, 64);
  if (
    root.surface !== "page" &&
    root.surface !== "overview" &&
    root.surface !== "inspector" &&
    root.surface !== "dock" &&
    root.surface !== "shell" &&
    root.surface !== "rich-detail"
  ) {
    throw new Error(`${path}.surface 取值无效`);
  }

  const scene = requireRecord(root.scene, `${path}.scene`);
  rejectUnknownKeys(
    scene,
    ["pageId", "componentId", "nodeId", "displayNodeId", "phase"],
    `${path}.scene`,
  );
  requireString(scene.pageId, `${path}.scene.pageId`);
  if (scene.componentId !== undefined)
    requireString(scene.componentId, `${path}.scene.componentId`);
  if (scene.nodeId !== undefined)
    requireString(scene.nodeId, `${path}.scene.nodeId`);
  if (scene.displayNodeId !== undefined)
    requireString(scene.displayNodeId, `${path}.scene.displayNodeId`);
  if (scene.phase !== undefined) {
    if (
      typeof scene.phase !== "string" ||
      !SELECTION_PHASES.includes(
        scene.phase as (typeof SELECTION_PHASES)[number],
      )
    ) {
      throw new Error(`${path}.scene.phase 取值无效`);
    }
  }

  const viewport = requireRecord(root.viewport, `${path}.viewport`);
  rejectUnknownKeys(viewport, ["width", "height"], `${path}.viewport`);
  const width = requireFiniteNumber(viewport.width, `${path}.viewport.width`);
  const height = requireFiniteNumber(
    viewport.height,
    `${path}.viewport.height`,
  );
  if (width <= 0 || width > 1e6)
    throw new Error(`${path}.viewport.width 必须为正数且不超过 1e6`);
  if (height <= 0 || height > 1e6)
    throw new Error(`${path}.viewport.height 必须为正数且不超过 1e6`);

  const windowScroll = requireRecord(root.windowScroll, `${path}.windowScroll`);
  rejectUnknownKeys(windowScroll, ["x", "y"], `${path}.windowScroll`);
  const scrollX = requireFiniteNumber(windowScroll.x, `${path}.windowScroll.x`);
  const scrollY = requireFiniteNumber(windowScroll.y, `${path}.windowScroll.y`);
  if (Math.abs(scrollX) > 1e9)
    throw new Error(`${path}.windowScroll.x 绝对值必须不超过 1e9`);
  if (Math.abs(scrollY) > 1e9)
    throw new Error(`${path}.windowScroll.y 绝对值必须不超过 1e9`);

  const rect = requireRecord(root.rect, `${path}.rect`);
  rejectUnknownKeys(rect, ["nx", "ny", "nw", "nh"], `${path}.rect`);
  const nx = requireFiniteNumber(rect.nx, `${path}.rect.nx`);
  const ny = requireFiniteNumber(rect.ny, `${path}.rect.ny`);
  const nw = requireFiniteNumber(rect.nw, `${path}.rect.nw`);
  const nh = requireFiniteNumber(rect.nh, `${path}.rect.nh`);
  if (
    nx < 0 ||
    nx > 1 ||
    ny < 0 ||
    ny > 1 ||
    nw < 0 ||
    nw > 1 ||
    nh < 0 ||
    nh > 1
  ) {
    throw new Error(`${path}.rect 数值必须在 0 到 1 之间`);
  }
  if (nx + nw > 1 + 1e-6 || ny + nh > 1 + 1e-6) {
    throw new Error(`${path}.rect 右边界和下边界不能超过 1`);
  }

  if (!Array.isArray(root.targets))
    throw new Error(`${path}.targets 必须为数组`);
  const targets: unknown[] = root.targets;
  if (targets.length < 1 || targets.length > 12)
    throw new Error(`${path}.targets 长度必须为 1 到 12`);
  for (let index = 0; index < targets.length; index += 1) {
    const targetPath = `${path}.targets[${index}]`;
    const target = requireRecord(targets[index], targetPath);
    rejectUnknownKeys(target, ["targetId", "label", "kind"], targetPath);
    requireString(target.targetId, `${targetPath}.targetId`);
    requireString(target.label, `${targetPath}.label`, 160);
    if (
      target.kind !== "review" &&
      target.kind !== "shell" &&
      target.kind !== "rich-detail"
    ) {
      throw new Error(`${targetPath}.kind 取值无效`);
    }
  }

  if (root.detail !== undefined) {
    const detail = requireRecord(root.detail, `${path}.detail`);
    rejectUnknownKeys(
      detail,
      ["rowId", "column", "componentId", "nodeId"],
      `${path}.detail`,
    );
    requireString(detail.rowId, `${path}.detail.rowId`);
    if (
      detail.column !== "requirement" &&
      detail.column !== "change" &&
      detail.column !== "api"
    ) {
      throw new Error(`${path}.detail.column 取值无效`);
    }
    if (detail.componentId !== undefined)
      requireString(detail.componentId, `${path}.detail.componentId`);
    if (detail.nodeId !== undefined)
      requireString(detail.nodeId, `${path}.detail.nodeId`);
  }

  if (root.context !== undefined) {
    validateSelectionContext(root.context, `${path}.context`);
  }

  return value as AppearanceSelection;
};
