import type { SelectionContext } from "../../lib/globalSelection";

export type SelectionChip = {
  key: string;
  value: string;
  title?: string;
  tone?: "accent" | "muted";
};

const formatNumber = (value: number): string =>
  Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(1);

const COLUMN_LABELS: Record<string, string> = {
  requirement: "需求列",
  change: "改动列",
  api: "API 列",
  trd: "整行",
};

const PHASE_LABELS: Record<string, string> = {
  page: "页面",
  entering: "进入中",
  docked: "停靠栏",
  leaving: "离开中",
};

/**
 * Build a bounded, human/agent-readable chip list from a selection's deep
 * context. Pure function over the stored data (no DOM access).
 */
export function buildSelectionContextChips(
  context: SelectionContext | undefined,
): SelectionChip[] {
  if (!context) return [];
  const chips: SelectionChip[] = [];

  const chain = context.anchorChain;
  if (chain) {
    if (chain.componentId) {
      chips.push({ key: "组件", value: chain.componentId, tone: "accent" });
    }
    if (chain.nodeId) {
      chips.push({ key: "节点", value: chain.nodeId, tone: "accent" });
    }
    if (chain.target) chips.push({ key: "锚点", value: chain.target });
    if (chain.apiFields && chain.apiFields.length > 0) {
      chips.push({ key: "字段", value: chain.apiFields.join(" ") });
    }
  }

  const mapping = context.mapping;
  if (mapping) {
    if (mapping.rowId) {
      chips.push({
        key: "行",
        value: mapping.rowId,
        title: mapping.rowLabel || undefined,
      });
    }
    if (mapping.column) {
      chips.push({
        key: "列",
        value: COLUMN_LABELS[mapping.column] ?? mapping.column,
      });
    }
  }

  const scene = context.scene;
  if (scene) {
    if (scene.phase) {
      chips.push({
        key: "阶段",
        value: PHASE_LABELS[scene.phase] ?? scene.phase,
        tone: "muted",
      });
    }
    if (scene.pageId)
      chips.push({ key: "页", value: scene.pageId, tone: "muted" });
    if (scene.componentId) {
      chips.push({ key: "场景组件", value: scene.componentId, tone: "muted" });
    }
    if (scene.nodeId)
      chips.push({ key: "场景节点", value: scene.nodeId, tone: "muted" });
    if (scene.detailOpen) {
      chips.push({ key: "富详情", value: "打开", tone: "muted" });
    }
  }

  if (context.canvasPoint) {
    chips.push({
      key: "画板坐标",
      value: `(${formatNumber(context.canvasPoint.x)}, ${formatNumber(
        context.canvasPoint.y,
      )})`,
      tone: "muted",
    });
  }

  if (context.heading) chips.push({ key: "标题", value: context.heading });

  return chips;
}
