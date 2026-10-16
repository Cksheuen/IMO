/**
 * david-plugin/v1 草稿严格解析（白名单字段，禁止脚本/HTML/任意 CSS）。
 */

import {
  DAVID_PLUGIN_SCHEMA,
  PLUGIN_ID_MAX_LENGTH,
  PLUGIN_MAX_RADIUS,
  PLUGIN_MAX_SLUGS,
  PLUGIN_MAX_FONT_SCALE,
  PLUGIN_MIN_FONT_SCALE,
  PLUGIN_SLUG_MAX_LENGTH,
} from "./constants.ts";

import { isNonEmptyString, isRecord, rejectUnknownKeys } from "./guards.ts";
import type { DavidPluginDraft } from "./types.ts";

const PLUGIN_THEME_TOKENS = [
  "paper",
  "ink",
  "accent",
  "gold",
  "muted",
  "radius",
  "fontScale",
] as const;

const PLUGIN_DEFAULT_INTERACTIONS = ["highlight", "drilldown", "auto"] as const;

const PLUGIN_HEX_COLOR_PATTERN =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PLUGIN_RADIUS_PATTERN = /^(\d+(?:\.\d+)?)px$/;
const PLUGIN_FONT_SCALE_PATTERN = /^\d+(?:\.\d+)?$/;

/** 严格解析 david-plugin/v1 草稿；未知/危险字段（script/html/css 等）一律拒绝。 */
export function parsePluginDraft(
  value: unknown,
  path = "pluginDraft",
): DavidPluginDraft {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  rejectUnknownKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "id",
      "name",
      "version",
      "match",
      "theme",
      "behavior",
    ],
    path,
  );
  if (value.schema !== DAVID_PLUGIN_SCHEMA)
    throw new Error(`${path}.schema 必须为 ${DAVID_PLUGIN_SCHEMA}`);
  if (value.schemaVersion !== 1)
    throw new Error(`${path}.schemaVersion 必须为 1`);
  if (!isNonEmptyString(value.id))
    throw new Error(`${path}.id 必须为非空字符串`);
  if (value.id.length > PLUGIN_ID_MAX_LENGTH) {
    throw new Error(`${path}.id 长度不能超过 ${PLUGIN_ID_MAX_LENGTH}`);
  }
  if (!isNonEmptyString(value.name))
    throw new Error(`${path}.name 必须为非空字符串`);
  if (value.name.length > PLUGIN_ID_MAX_LENGTH) {
    throw new Error(`${path}.name 长度不能超过 ${PLUGIN_ID_MAX_LENGTH}`);
  }
  if (!isNonEmptyString(value.version))
    throw new Error(`${path}.version 必须为非空字符串`);
  if (value.version.length > PLUGIN_ID_MAX_LENGTH) {
    throw new Error(`${path}.version 长度不能超过 ${PLUGIN_ID_MAX_LENGTH}`);
  }

  if (value.match !== undefined) {
    if (!isRecord(value.match)) throw new Error(`${path}.match 必须是对象`);
    rejectUnknownKeys(value.match, ["slugs"], `${path}.match`);
    const slugs = value.match.slugs;
    if (slugs !== undefined) {
      if (
        !Array.isArray(slugs) ||
        slugs.some((slug) => !isNonEmptyString(slug))
      ) {
        throw new Error(`${path}.match.slugs 必须为非空字符串数组`);
      }
      if (slugs.length > PLUGIN_MAX_SLUGS) {
        throw new Error(`${path}.match.slugs 数量不能超过 ${PLUGIN_MAX_SLUGS}`);
      }
      if (
        slugs.some(
          (slug) =>
            typeof slug === "string" && slug.length > PLUGIN_SLUG_MAX_LENGTH,
        )
      ) {
        throw new Error(
          `${path}.match.slugs 每项长度不能超过 ${PLUGIN_SLUG_MAX_LENGTH}`,
        );
      }
    }
  }

  if (value.theme !== undefined) {
    if (!isRecord(value.theme)) throw new Error(`${path}.theme 必须是对象`);
    rejectUnknownKeys(value.theme, PLUGIN_THEME_TOKENS, `${path}.theme`);
    for (const token of PLUGIN_THEME_TOKENS) {
      const tokenValue = value.theme[token];
      if (tokenValue === undefined) continue;
      if (typeof tokenValue !== "string") {
        throw new Error(`${path}.theme.${token} 必须为字符串`);
      }
      if (token === "radius") {
        const radiusMatch = PLUGIN_RADIUS_PATTERN.exec(tokenValue);
        const radius = radiusMatch
          ? Number.parseFloat(radiusMatch[1])
          : Number.NaN;
        if (
          !Number.isFinite(radius) ||
          radius < 0 ||
          radius > PLUGIN_MAX_RADIUS
        ) {
          throw new Error(
            `${path}.theme.radius 必须为 0..${PLUGIN_MAX_RADIUS}px 格式`,
          );
        }
      } else if (token === "fontScale") {
        const scale = PLUGIN_FONT_SCALE_PATTERN.test(tokenValue)
          ? Number.parseFloat(tokenValue)
          : Number.NaN;
        if (
          !Number.isFinite(scale) ||
          scale < PLUGIN_MIN_FONT_SCALE ||
          scale > PLUGIN_MAX_FONT_SCALE
        ) {
          throw new Error(
            `${path}.theme.fontScale 必须为 ${PLUGIN_MIN_FONT_SCALE}..${PLUGIN_MAX_FONT_SCALE} 的数字字符串`,
          );
        }
      } else if (!PLUGIN_HEX_COLOR_PATTERN.test(tokenValue)) {
        throw new Error(
          `${path}.theme.${token} 必须为 #RGB/#RRGGBB/#RRGGBBAA 十六进制颜色`,
        );
      }
    }
  }

  if (value.behavior !== undefined) {
    if (!isRecord(value.behavior))
      throw new Error(`${path}.behavior 必须是对象`);
    rejectUnknownKeys(
      value.behavior,
      ["motionScale", "defaultInteraction"],
      `${path}.behavior`,
    );
    if (value.behavior.motionScale !== undefined) {
      const motionScale = value.behavior.motionScale;
      if (
        typeof motionScale !== "number" ||
        !Number.isFinite(motionScale) ||
        motionScale < 0 ||
        motionScale > 2
      ) {
        throw new Error(`${path}.behavior.motionScale 必须为 0..2 的数字`);
      }
    }
    if (
      value.behavior.defaultInteraction !== undefined &&
      !PLUGIN_DEFAULT_INTERACTIONS.includes(
        value.behavior
          .defaultInteraction as (typeof PLUGIN_DEFAULT_INTERACTIONS)[number],
      )
    ) {
      throw new Error(`${path}.behavior.defaultInteraction 非法`);
    }
  }

  return value as unknown as DavidPluginDraft;
}
