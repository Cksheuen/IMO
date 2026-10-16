import { isValidLogicGraph, isValidCodeFlow } from "./logicGraph.ts";
import { assertPreparation } from "./preparationModel.ts";
import { isValidCodeAnnotations } from "./codeAnnotations.ts";
import { isValidDetailPreview } from "./detailPreview.ts";
import { isAllowedFeedbackHost } from "./feedbackTransport.ts";
import { injectMappingIds } from "./mappingTargets.ts";
import type {
  ApiContract,
  CollaborationManifest,
  OpenQuestion,
  PageKind,
  PageSpec,
  ReviewPageInteraction,
  ReviewScene,
  RenderFidelity,
  RenderSourceKind,
  ReviewComponent,
  ReviewInteraction,
  ReviewNode,
  ReviewOverview,
  ReviewPayload,
  ReviewSpec,
} from "../types/review";

import { assertChangeBlock, isValidChangeBlock } from "./changeModel.ts";

import { assertOpenQuestions } from "./openQuestionModel.ts";

import { assertApiContracts, assertContractIds } from "./contractModel.ts";

/** 递归节点最大嵌套深度（与 reviewTree / render-review 保持一致） */
export const MAX_REVIEW_TREE_DEPTH = 8;

const REVIEW_INTERACTIONS: readonly ReviewInteraction[] = [
  "highlight",
  "drilldown",
  "auto",
];

const RENDER_SOURCE_KINDS: readonly RenderSourceKind[] = [
  "component",
  "css-art",
  "mockup",
];

const RENDER_FIDELITIES: readonly RenderFidelity[] = [
  "pixel-vs-real",
  "structure",
  "approx",
];

const PAGE_KINDS: readonly PageKind[] = ["screen", "canvas"];
const PAGE_INTERACTION_TRIGGERS = ["click", "hover", "keyboard"] as const;
const PAGE_INTERACTION_ACTIONS = [
  "navigate",
  "detail",
  "highlight",
  "show",
  "hide",
  "toggle",
  "close",
] as const;

const DEEP_DIVE_KEYS = [
  "summary",
  "codePaths",
  "logic",
  "state",
  "edgeCases",
  "tests",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sceneFallbackHtml = (
  scene: import("../types/review").ReviewScene,
): string => {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char] ?? char,
    );
  return `<div class="david-scene-renderer" data-review-target="scene" data-review-label="结构化画板">${scene.components
    .map(
      (component) =>
        `<section class="david-scene-component${component.role === "modal" ? " david-scene-modal" : ""}" data-scene-id="${escape(component.id)}" data-review-element-id="${escape(component.id)}" data-review-target="${escape(component.id)}" data-review-label="${escape(component.id)}"${component.role === "modal" ? ` role="dialog" aria-modal="true" aria-hidden="true"` : ""}${component.componentId ? ` data-component-id="${escape(component.componentId)}"` : ""}${component.nodeId ? ` data-review-node-id="${escape(component.nodeId)}"` : ""}><strong>${escape(component.id)}</strong><small>${escape(component.role)}${component.source?.file ? ` · ${escape(component.source.file)}` : ""}</small>${component.role === "modal" ? `<button type="button" data-review-overlay-close aria-label="关闭弹窗">关闭</button>` : ""}</section>`,
    )
    .join("")}</div>`;
};

/**
 * 校验代码块的语义行范围注释：1-based、含两端、有序不重叠、不越界，
 * title 与 bullets 非空。techPoints.pseudoCode 与 apiChange.items[].code 共用。
 */

const isTrdColumnContent = (value: unknown) => {
  if (!isRecord(value)) return false;
  if (value.heading !== undefined && typeof value.heading !== "string")
    return false;
  if (value.positioning !== undefined && typeof value.positioning !== "string")
    return false;
  if (value.summary !== undefined && typeof value.summary !== "string")
    return false;
  if (value.pseudoCode !== undefined && typeof value.pseudoCode !== "string")
    return false;
  if (value.codeLabel !== undefined && typeof value.codeLabel !== "string")
    return false;
  if (value.head !== undefined && typeof value.head !== "string") return false;
  if (value.endpoint !== undefined && typeof value.endpoint !== "string")
    return false;
  if (value.beId !== undefined && typeof value.beId !== "string") return false;
  if (value.status !== undefined && typeof value.status !== "string")
    return false;

  if (value.bullets !== undefined) {
    if (!Array.isArray(value.bullets)) return false;
    for (const b of value.bullets) {
      if (typeof b === "string") continue;
      if (
        isRecord(b) &&
        typeof b.text === "string" &&
        (b.sub === undefined ||
          (Array.isArray(b.sub) && b.sub.every((s) => typeof s === "string")))
      ) {
        continue;
      }
      return false;
    }
  }

  if (value.points !== undefined) {
    if (!Array.isArray(value.points)) return false;
    for (const point of value.points) {
      if (
        !isRecord(point) ||
        typeof point.text !== "string" ||
        (point.label !== undefined && typeof point.label !== "string")
      ) {
        return false;
      }
    }
  }

  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections)) return false;
    for (const s of value.sections) {
      if (!isRecord(s)) return false;
      if (s.title !== undefined && typeof s.title !== "string") return false;
      if (s.moduleId !== undefined && typeof s.moduleId !== "string")
        return false;
      if (s.items !== undefined) {
        if (!Array.isArray(s.items)) return false;
        for (const it of s.items) {
          if (
            !isRecord(it) ||
            typeof it.text !== "string" ||
            (it.label !== undefined && typeof it.label !== "string")
          ) {
            return false;
          }
        }
      }
    }
  }

  if (value.modules !== undefined) {
    if (!Array.isArray(value.modules)) return false;
    for (const m of value.modules) {
      if (
        !isRecord(m) ||
        typeof m.id !== "string" ||
        typeof m.name !== "string"
      )
        return false;
      if (m.change !== undefined && typeof m.change !== "string") return false;
      if (m.color !== undefined && typeof m.color !== "string") return false;
      if (m.desc !== undefined && typeof m.desc !== "string") return false;
    }
  }

  if (
    value.codeFlow !== undefined &&
    !isValidCodeFlow(value.codeFlow, value.techPoints)
  )
    return false;
  if (value.techPoints !== undefined) {
    if (!Array.isArray(value.techPoints)) return false;
    for (const tp of value.techPoints) {
      if (!isRecord(tp)) return false;
      if (tp.id !== undefined && (typeof tp.id !== "string" || !tp.id.trim()))
        return false;
      if (tp.graph !== undefined && !isValidLogicGraph(tp.graph)) return false;
      if (tp.preview !== undefined && !isValidDetailPreview(tp.preview))
        return false;
      if (tp.title !== undefined && typeof tp.title !== "string") return false;
      if (tp.moduleId !== undefined && typeof tp.moduleId !== "string")
        return false;
      if (tp.moduleName !== undefined && typeof tp.moduleName !== "string")
        return false;
      if (tp.moduleChange !== undefined && typeof tp.moduleChange !== "string")
        return false;
      if (tp.pseudoCode !== undefined && typeof tp.pseudoCode !== "string")
        return false;
      if (tp.codeLabel !== undefined && typeof tp.codeLabel !== "string")
        return false;
      if (tp.codeAnnotations !== undefined) {
        if (!isValidCodeAnnotations(tp.codeAnnotations, tp.pseudoCode))
          return false;
      }
      if (tp.changeBlock !== undefined && !isValidChangeBlock(tp.changeBlock)) {
        return false;
      }
      if (tp.bullets !== undefined) {
        if (!Array.isArray(tp.bullets)) return false;
        for (const b of tp.bullets) {
          if (typeof b === "string") continue;
          if (
            isRecord(b) &&
            typeof b.text === "string" &&
            (b.sub === undefined ||
              (Array.isArray(b.sub) &&
                b.sub.every((s) => typeof s === "string")))
          ) {
            continue;
          }
          return false;
        }
      }
    }
  }

  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) return false;
    for (const it of value.items) {
      if (!isRecord(it)) return false;
      if (it.title !== undefined && typeof it.title !== "string") return false;
      if (it.beId !== undefined && typeof it.beId !== "string") return false;
      if (it.codeLabel !== undefined && typeof it.codeLabel !== "string")
        return false;
      if (it.code !== undefined && typeof it.code !== "string") return false;
      if (it.codeAnnotations !== undefined) {
        if (!isValidCodeAnnotations(it.codeAnnotations, it.code)) return false;
      }
      if (
        it.bullets !== undefined &&
        (!Array.isArray(it.bullets) ||
          it.bullets.some((b) => typeof b !== "string"))
      ) {
        return false;
      }
      if (
        it.fields !== undefined &&
        (!Array.isArray(it.fields) ||
          it.fields.some(
            (f) =>
              !isRecord(f) ||
              typeof f.name !== "string" ||
              (f.target !== undefined && typeof f.target !== "string"),
          ))
      ) {
        return false;
      }
    }
  }

  if (
    value.fields !== undefined &&
    (!Array.isArray(value.fields) ||
      value.fields.some(
        (f) =>
          !isRecord(f) ||
          typeof f.name !== "string" ||
          (f.target !== undefined && typeof f.target !== "string"),
      ))
  ) {
    return false;
  }

  return true;
};

const isCrossSection = (value: unknown) => {
  if (!isRecord(value)) return false;
  if (value.note !== undefined && typeof value.note !== "string") return false;
  for (const listKey of ["flow", "state", "dataflow", "edge", "files"]) {
    const list = value[listKey];
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some((item) => typeof item !== "string"))
    ) {
      return false;
    }
  }
  if (value.seq !== undefined) {
    if (!isRecord(value.seq)) return false;
    if (!Array.isArray(value.seq.actors) || !Array.isArray(value.seq.messages))
      return false;
  }
  return true;
};

/** 严格校验单条 mapping 行（三联动 + 扩展字段），非法时抛错。 */
const validateMappingRow = (
  row: unknown,
  path: string,
  contractIds: Set<string>,
): void => {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.requirement !== "string" ||
    typeof row.change !== "string" ||
    !isRecord(row.api)
  ) {
    throw new Error(`${path} 缺少 id、requirement、change 或 api`);
  }
  if (row.title !== undefined && typeof row.title !== "string") {
    throw new Error(`${path}.title 必须为字符串`);
  }
  if (
    row.codePaths !== undefined &&
    (!Array.isArray(row.codePaths) ||
      row.codePaths.some((p) => typeof p !== "string"))
  ) {
    throw new Error(`${path}.codePaths 格式错误`);
  }
  if (row.reviewBrief !== undefined && !isRecord(row.reviewBrief)) {
    throw new Error(`${path}.reviewBrief 格式错误`);
  }
  if (row.reviewBrief !== undefined && isRecord(row.reviewBrief)) {
    if (
      row.reviewBrief.changeType !== undefined &&
      typeof row.reviewBrief.changeType !== "string"
    ) {
      throw new Error(`${path}.reviewBrief.changeType 必须为字符串`);
    }
  }
  if (row.d2c !== undefined && typeof row.d2c !== "string") {
    throw new Error(`${path}.d2c 必须为字符串`);
  }
  if (row.api.changed !== undefined && typeof row.api.changed !== "boolean") {
    throw new Error(`${path}.api.changed 必须为布尔值`);
  }
  if (row.overviewSummary !== undefined) {
    if (!isRecord(row.overviewSummary)) {
      throw new Error(`${path}.overviewSummary 格式错误`);
    }
    for (const key of Object.keys(row.overviewSummary)) {
      if (key !== "requirement" && key !== "change" && key !== "api") {
        throw new Error(`${path}.overviewSummary.${key} 非法字段`);
      }
      const value = row.overviewSummary[key];
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 240
      ) {
        throw new Error(
          `${path}.overviewSummary.${key} 必须为非空字符串且长度不超过 240`,
        );
      }
    }
  }
  if (
    row.api.fields !== undefined &&
    (!Array.isArray(row.api.fields) ||
      row.api.fields.some(
        (field) =>
          !isRecord(field) ||
          typeof field.name !== "string" ||
          (field.target !== undefined && typeof field.target !== "string"),
      ))
  ) {
    throw new Error(`${path}.api.fields 格式错误`);
  }
  if (row.api.contractIds !== undefined) {
    assertContractIds(
      row.api.contractIds,
      `${path}.api.contractIds`,
      contractIds,
    );
  }
  if (row.cross !== undefined && !isCrossSection(row.cross)) {
    throw new Error(`${path}.cross 格式错误`);
  }
  if (row.preparation !== undefined)
    assertPreparation(row.preparation, `${path}.preparation`);
  if (row.changeBlock !== undefined) {
    assertChangeBlock(row.changeBlock, `${path}.changeBlock`);
  }
  if (row.trd !== undefined) {
    if (!isRecord(row.trd)) {
      throw new Error(`${path}.trd 格式错误`);
    }
    for (const column of ["productDesign", "technical", "apiChange"]) {
      const content = row.trd[column];
      if (content !== undefined && !isTrdColumnContent(content)) {
        throw new Error(`${path}.trd.${column} 格式错误`);
      }
    }
  }
};

/** 严格校验 deepDive（仅允许字符串数组字段）。 */
const validateDeepDive = (value: unknown, path: string): void => {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  for (const key of DEEP_DIVE_KEYS) {
    const list = value[key];
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some((item) => typeof item !== "string"))
    ) {
      throw new Error(`${path}.${key} 必须是字符串数组`);
    }
  }
};

/**
 * 高保真复刻由来契约校验（HARD-GATE 28 组件复用）：
 * - kind 必须为 component | css-art | mockup
 * - kind=component 必须有至少一条 codePaths（真实组件证据）
 * - fidelity=pixel-vs-real 只允许 kind=component —— CSS art / mockup
 *   不得声称无证据的像素级 1:1
 */
const validateComponentSource = (value: unknown, path: string): void => {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  if (
    typeof value.kind !== "string" ||
    !RENDER_SOURCE_KINDS.includes(value.kind as RenderSourceKind)
  ) {
    throw new Error(`${path}.kind 必须为 component | css-art | mockup`);
  }
  if (value.codePaths !== undefined) {
    if (
      !Array.isArray(value.codePaths) ||
      value.codePaths.some((p) => typeof p !== "string")
    ) {
      throw new Error(`${path}.codePaths 必须是字符串数组`);
    }
  }
  if (value.kind === "component") {
    if (!Array.isArray(value.codePaths) || value.codePaths.length === 0) {
      throw new Error(
        `${path}.codePaths 不能为空（kind=component 必须有真实组件证据）`,
      );
    }
  }
  if (value.probe !== undefined && typeof value.probe !== "string") {
    throw new Error(`${path}.probe 必须为字符串`);
  }
  if (value.fidelity !== undefined) {
    if (
      typeof value.fidelity !== "string" ||
      !RENDER_FIDELITIES.includes(value.fidelity as RenderFidelity)
    ) {
      throw new Error(
        `${path}.fidelity 必须为 pixel-vs-real | structure | approx`,
      );
    }
    if (value.fidelity === "pixel-vs-real" && value.kind !== "component") {
      throw new Error(
        `${path}.fidelity=pixel-vs-real 只允许 kind=component（CSS art / mockup 不得声称无证据的 1:1）`,
      );
    }
  }
  if (value.renderEvidence !== undefined) {
    if (!isRecord(value.renderEvidence)) {
      throw new Error(`${path}.renderEvidence 必须是对象`);
    }
    for (const key of ["recipe", "viewport", "screenshot", "capturedAt"]) {
      if (
        value.renderEvidence[key] !== undefined &&
        typeof value.renderEvidence[key] !== "string"
      ) {
        throw new Error(`${path}.renderEvidence.${key} 必须为字符串`);
      }
    }
    if (
      value.fidelity === "pixel-vs-real" &&
      (!value.renderEvidence.recipe ||
        !value.renderEvidence.viewport ||
        !value.renderEvidence.screenshot)
    ) {
      throw new Error(
        `${path}.fidelity=pixel-vs-real 必须提供 renderEvidence.recipe/viewport/screenshot`,
      );
    }
  }
  if (value.renderRecipe !== undefined) {
    if (!isRecord(value.renderRecipe)) {
      throw new Error(`${path}.renderRecipe 必须是对象`);
    }
    for (const key of ["projectRoot", "startCommand", "url"]) {
      if (
        typeof value.renderRecipe[key] !== "string" ||
        !value.renderRecipe[key].trim()
      ) {
        throw new Error(`${path}.renderRecipe.${key} 必须为非空字符串`);
      }
    }
    for (const key of ["selector", "viewport"]) {
      if (
        value.renderRecipe[key] !== undefined &&
        typeof value.renderRecipe[key] !== "string"
      ) {
        throw new Error(`${path}.renderRecipe.${key} 必须为字符串`);
      }
    }
    const readyTimeoutMs = value.renderRecipe.readyTimeoutMs;
    if (
      readyTimeoutMs !== undefined &&
      (typeof readyTimeoutMs !== "number" ||
        !Number.isInteger(readyTimeoutMs) ||
        readyTimeoutMs < 1000 ||
        readyTimeoutMs > 300000)
    ) {
      throw new Error(
        `${path}.renderRecipe.readyTimeoutMs 必须为 1000..300000 的整数`,
      );
    }
  }
  if (
    value.fidelity === "pixel-vs-real" &&
    value.renderEvidence === undefined
  ) {
    throw new Error(
      `${path}.fidelity=pixel-vs-real 必须提供 renderEvidence.recipe/viewport/screenshot`,
    );
  }
};

const validatePageGraph = (value: unknown, path: string): void => {
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    throw new Error(`${path} 必须包含 nodes 与 edges 数组`);
  }
  const ids = new Set<string>();
  value.nodes.forEach((node, index) => {
    if (
      !isRecord(node) ||
      typeof node.id !== "string" ||
      typeof node.label !== "string"
    ) {
      throw new Error(`${path}.nodes[${index}] 需要 id 与 label`);
    }
    if (ids.has(node.id))
      throw new Error(`${path}.nodes[${index}] id 重复: ${node.id}`);
    ids.add(node.id);
    if (
      node.status !== undefined &&
      !["context", "changed", "result"].includes(node.status as string)
    ) {
      throw new Error(`${path}.nodes[${index}].status 非法`);
    }
  });
  value.edges.forEach((edge, index) => {
    if (
      !isRecord(edge) ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string"
    ) {
      throw new Error(`${path}.edges[${index}] 需要 from 与 to`);
    }
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`${path}.edges[${index}] 引用了未知节点`);
    }
    if (
      edge.kind !== undefined &&
      !["data", "control", "dependency"].includes(edge.kind as string)
    ) {
      throw new Error(`${path}.edges[${index}].kind 非法`);
    }
    if (edge.label !== undefined && typeof edge.label !== "string") {
      throw new Error(`${path}.edges[${index}].label 必须为字符串`);
    }
  });
};

/**
 * 多 agent 协作清单校验（HARD-GATE 30）：
 * - schemaVersion 1（或缺省）
 * - pages[] pageId 必须存在且唯一；nodes[] ref 唯一；owner 非空
 * - lease.holder 非空；heartbeatAt 字符串
 */
const validateCollaboration = (
  value: unknown,
  path: string,
  pageIds: Set<string>,
): CollaborationManifest | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new Error(`${path}.schemaVersion 必须为 1 或缺省`);
  }
  if (value.patchOnly !== undefined && typeof value.patchOnly !== "boolean") {
    throw new Error(`${path}.patchOnly 必须为布尔值`);
  }
  const visitedPages = new Set<string>();
  if (value.pages !== undefined) {
    if (!Array.isArray(value.pages))
      throw new Error(`${path}.pages 必须是数组`);
    value.pages.forEach((owner, index) => {
      if (
        !isRecord(owner) ||
        typeof owner.pageId !== "string" ||
        typeof owner.owner !== "string" ||
        !owner.owner.trim()
      ) {
        throw new Error(`${path}.pages[${index}] 需要 pageId 与 owner`);
      }
      if (!pageIds.has(owner.pageId)) {
        throw new Error(
          `${path}.pages[${index}] 引用未知 page: ${owner.pageId}`,
        );
      }
      if (visitedPages.has(owner.pageId)) {
        throw new Error(`${path}.pages[${index}] pageId 重复: ${owner.pageId}`);
      }
      visitedPages.add(owner.pageId);
      if (owner.session !== undefined && typeof owner.session !== "string") {
        throw new Error(`${path}.pages[${index}].session 必须为字符串`);
      }
    });
  }
  const visitedNodes = new Set<string>();
  if (value.nodes !== undefined) {
    if (!Array.isArray(value.nodes))
      throw new Error(`${path}.nodes 必须是数组`);
    value.nodes.forEach((owner, index) => {
      if (
        !isRecord(owner) ||
        typeof owner.ref !== "string" ||
        typeof owner.owner !== "string" ||
        !owner.owner.trim()
      ) {
        throw new Error(`${path}.nodes[${index}] 需要 ref 与 owner`);
      }
      if (visitedNodes.has(owner.ref)) {
        throw new Error(`${path}.nodes[${index}] ref 重复: ${owner.ref}`);
      }
      visitedNodes.add(owner.ref);
      if (owner.session !== undefined && typeof owner.session !== "string") {
        throw new Error(`${path}.nodes[${index}].session 必须为字符串`);
      }
    });
  }
  if (value.lease !== undefined) {
    if (
      !isRecord(value.lease) ||
      typeof value.lease.holder !== "string" ||
      !value.lease.holder.trim()
    ) {
      throw new Error(`${path}.lease.holder 必须为非空字符串`);
    }
    if (
      value.lease.heartbeatAt !== undefined &&
      typeof value.lease.heartbeatAt !== "string"
    ) {
      throw new Error(`${path}.lease.heartbeatAt 必须为字符串`);
    }
  }
  return value as unknown as CollaborationManifest;
};

const validatePageInteractions = (
  value: unknown,
  path: string,
  pageIds: Set<string>,
  elementIds?: Set<string>,
): ReviewPageInteraction[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
  return value.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.source !== "string" ||
      !item.source.trim()
    ) {
      throw new Error(`${path}[${index}] 需要非空 source`);
    }
    if (
      item.trigger !== undefined &&
      !PAGE_INTERACTION_TRIGGERS.includes(item.trigger as never)
    ) {
      throw new Error(`${path}[${index}].trigger 非法`);
    }
    if (
      typeof item.action !== "string" ||
      !PAGE_INTERACTION_ACTIONS.includes(item.action as never)
    ) {
      throw new Error(`${path}[${index}].action 非法`);
    }
    if (item.targetPageId !== undefined) {
      if (
        typeof item.targetPageId !== "string" ||
        !pageIds.has(item.targetPageId)
      ) {
        throw new Error(`${path}[${index}] targetPageId 未知`);
      }
    }
    if (
      item.targetNodeId !== undefined &&
      (typeof item.targetNodeId !== "string" || !item.targetNodeId.trim())
    ) {
      throw new Error(`${path}[${index}].targetNodeId 必须为非空字符串`);
    }
    if (
      item.targetElementId !== undefined &&
      (typeof item.targetElementId !== "string" || !item.targetElementId.trim())
    ) {
      throw new Error(`${path}[${index}].targetElementId 必须为非空字符串`);
    }
    if (item.action === "navigate" && item.targetPageId === undefined) {
      throw new Error(`${path}[${index}] navigate 必须指定 targetPageId`);
    }
    if (
      (item.action === "detail" || item.action === "highlight") &&
      item.targetNodeId === undefined
    ) {
      throw new Error(`${path}[${index}] ${item.action} 必须指定 targetNodeId`);
    }
    if (
      (item.action === "show" ||
        item.action === "hide" ||
        item.action === "toggle") &&
      item.targetElementId === undefined
    ) {
      throw new Error(
        `${path}[${index}] ${item.action} 必须指定 targetElementId`,
      );
    }
    if (
      item.targetElementId !== undefined &&
      elementIds &&
      !elementIds.has(item.targetElementId)
    ) {
      throw new Error(
        `${path}[${index}] targetElementId 未命中当前页面元素: ${item.targetElementId}`,
      );
    }
    if (item.label !== undefined && typeof item.label !== "string") {
      throw new Error(`${path}[${index}].label 必须为字符串`);
    }
    return item as unknown as ReviewPageInteraction;
  });
};

const collectPageElementIds = (pageHtml: string): Set<string> => {
  const ids = new Set<string>();
  const pattern =
    /(?:^|\s)(?:data-(?:review-element-id|review-overlay-id|scene-id)|id)=["']([^"']+)["']/g;
  for (const match of pageHtml.matchAll(pattern)) ids.add(match[1]);
  return ids;
};

const collectInteractionSourceIds = (pageHtml: string): Set<string> => {
  const ids = new Set<string>();
  const pattern = /data-review-interaction-source=["']([^"']+)["']/g;
  for (const match of pageHtml.matchAll(pattern)) ids.add(match[1]);
  return ids;
};

const validatePageScene = (
  value: unknown,
  path: string,
): ReviewScene | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.components)) {
    throw new Error(`${path} 需要 components 数组`);
  }
  const ids = new Set<string>();
  const components = value.components.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      typeof item.role !== "string"
    ) {
      throw new Error(`${path}.components[${index}] 需要 id 与 role`);
    }
    if (ids.has(item.id))
      throw new Error(`${path}.components[${index}].id 重复: ${item.id}`);
    ids.add(item.id);
    if (
      item.mappingIds !== undefined &&
      (!Array.isArray(item.mappingIds) ||
        item.mappingIds.some((id) => typeof id !== "string" || !id.trim()))
    ) {
      throw new Error(
        `${path}.components[${index}].mappingIds 必须是非空字符串数组`,
      );
    }
    if (
      item.nodeId !== undefined &&
      (typeof item.nodeId !== "string" || !item.nodeId.trim())
    ) {
      throw new Error(`${path}.components[${index}].nodeId 必须是非空字符串`);
    }
    if (
      item.componentId !== undefined &&
      (typeof item.componentId !== "string" || !item.componentId.trim())
    ) {
      throw new Error(
        `${path}.components[${index}].componentId 必须是非空字符串`,
      );
    }
    if (item.source !== undefined) {
      if (!isRecord(item.source))
        throw new Error(`${path}.components[${index}].source 必须是对象`);
      for (const key of [
        "projectRoot",
        "file",
        "exportName",
        "selector",
      ] as const) {
        if (
          item.source[key] !== undefined &&
          typeof item.source[key] !== "string"
        ) {
          throw new Error(
            `${path}.components[${index}].source.${key} 必须是字符串`,
          );
        }
      }
    }
    for (const key of ["props", "state"] as const) {
      if (item[key] !== undefined && !isRecord(item[key])) {
        throw new Error(`${path}.components[${index}].${key} 必须是对象`);
      }
    }
    return item;
  });
  if (value.state !== undefined && !isRecord(value.state))
    throw new Error(`${path}.state 必须是对象`);
  return {
    components: components as ReviewScene["components"],
    ...(value.state ? { state: value.state } : {}),
  };
};

/** 从 pageHtml 中提取 data-review-node-id 锚点集合。 */
const collectNodeAnchors = (pages: PageSpec[]): Set<string> => {
  const markup = pages.map((page) => page.pageHtml).join("\n");
  const values = [...markup.matchAll(/data-review-node-id=["']([^"']*)["']/g)];
  return new Set(
    values.flatMap((match) => match[1].split(/\s+/).filter(Boolean)),
  );
};

/**
 * 递归严格校验 David schema 节点：
 * interaction / mappingIds / mapping / deepDive / children；
 * 全局 node id 唯一（含与 component id 冲突）；嵌套深度 <= 8；
 * 每个节点都必须在 pageHtml 中存在 data-review-node-id 等于 target 或 id 的锚点；
 * mappingIds 非空时每个 id 必须命中所属 root component 的 mapping，
 * 且不能与 node.mapping 同时存在。
 */
const validateReviewNode = (
  node: unknown,
  path: string,
  ids: Set<string>,
  depth: number,
  anchors: Set<string>,
  rootMappingIds: Set<string>,
  contractIds: Set<string>,
): void => {
  if (depth > MAX_REVIEW_TREE_DEPTH) {
    throw new Error(`node 嵌套深度超过 ${MAX_REVIEW_TREE_DEPTH}`);
  }
  if (!isRecord(node) || typeof node.id !== "string" || !node.id.trim()) {
    throw new Error(`${path} 缺少 id`);
  }
  if (typeof node.label !== "string" || !node.label.trim()) {
    throw new Error(`${path}(${node.id}) 缺少 label`);
  }
  if (
    node.interaction !== undefined &&
    (typeof node.interaction !== "string" ||
      !REVIEW_INTERACTIONS.includes(node.interaction as ReviewInteraction))
  ) {
    throw new Error(
      `${path}(${node.id}).interaction 非法: ${String(node.interaction)}`,
    );
  }
  if (node.canvas !== undefined && typeof node.canvas !== "boolean") {
    throw new Error(`${path}(${node.id}).canvas 必须为布尔值`);
  }
  if (ids.has(node.id)) throw new Error(`node id 重复: ${node.id}`);
  ids.add(node.id);
  if (node.target !== undefined && typeof node.target !== "string") {
    throw new Error(`${path}(${node.id}).target 必须为字符串`);
  }
  if (node.mapping !== undefined) {
    if (!Array.isArray(node.mapping))
      throw new Error(`${path}(${node.id}).mapping 必须是数组`);
    node.mapping.forEach((row, index) =>
      validateMappingRow(
        row,
        `${path}(${node.id}).mapping[${index}]`,
        contractIds,
      ),
    );
  }
  if (node.mappingIds !== undefined) {
    if (node.mapping !== undefined) {
      throw new Error(`${path}(${node.id}) 不能同时指定 mapping 与 mappingIds`);
    }
    if (
      !Array.isArray(node.mappingIds) ||
      node.mappingIds.some((id) => typeof id !== "string")
    ) {
      throw new Error(`${path}(${node.id}).mappingIds 必须是字符串数组`);
    }
    if (node.mappingIds.length === 0) {
      throw new Error(`${path}(${node.id}).mappingIds 不能为空`);
    }
    for (const mappingId of node.mappingIds) {
      if (!rootMappingIds.has(mappingId)) {
        throw new Error(
          `${path}(${node.id}).mappingIds 引用未知 mapping ID: ${mappingId}`,
        );
      }
    }
  }
  if (node.deepDive !== undefined)
    validateDeepDive(node.deepDive, `${path}(${node.id}).deepDive`);
  const anchor =
    typeof node.target === "string" && node.target ? node.target : node.id;
  if (!anchors.has(anchor)) {
    throw new Error(
      `node ${node.id} 在 pageHtml 中缺少 data-review-node-id="${anchor}" 锚点`,
    );
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children))
      throw new Error(`${path}(${node.id}).children 必须是数组`);
    node.children.forEach((child, index) =>
      validateReviewNode(
        child,
        `${path}(${node.id}).children[${index}]`,
        ids,
        depth + 1,
        anchors,
        rootMappingIds,
        contractIds,
      ),
    );
  }
};

/** 校验 component 上的 David schema 扩展字段及其 children 树。 */
const validateComponentTree = (
  component: ReviewComponent,
  index: number,
  ids: Set<string>,
  anchors: Set<string>,
  contractIds: Set<string>,
): void => {
  const path = `components[${index}]`;
  if (
    component.interaction !== undefined &&
    !REVIEW_INTERACTIONS.includes(component.interaction)
  ) {
    throw new Error(
      `${path}(${component.id}).interaction 非法: ${String(component.interaction)}`,
    );
  }
  if (component.target !== undefined && typeof component.target !== "string") {
    throw new Error(`${path}(${component.id}).target 必须为字符串`);
  }
  if (component.source !== undefined) {
    validateComponentSource(
      component.source,
      `${path}(${component.id}).source`,
    );
  }
  if (component.deepDive !== undefined) {
    validateDeepDive(component.deepDive, `${path}(${component.id}).deepDive`);
  }
  if (component.children !== undefined) {
    if (!Array.isArray(component.children)) {
      throw new Error(`${path}(${component.id}).children 必须是数组`);
    }
    const rootMappingIds = new Set(component.mapping.map((row) => row.id));
    component.children.forEach((child: ReviewNode, childIndex: number) =>
      validateReviewNode(
        child,
        `${path}(${component.id}).children[${childIndex}]`,
        ids,
        1,
        anchors,
        rootMappingIds,
        contractIds,
      ),
    );
  }
};

/** 校验可选 overview（title/summary 字符串，mapping 行严格校验）。 */
const validateOverview = (
  value: unknown,
  contractIds: Set<string>,
): ReviewOverview | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("overview 必须是对象");
  if (value.title !== undefined && typeof value.title !== "string") {
    throw new Error("overview.title 必须为字符串");
  }
  if (value.summary !== undefined && typeof value.summary !== "string") {
    throw new Error("overview.summary 必须为字符串");
  }
  if (value.mapping !== undefined) {
    if (!Array.isArray(value.mapping))
      throw new Error("overview.mapping 必须是数组");
    value.mapping.forEach((row, index) =>
      validateMappingRow(row, `overview.mapping[${index}]`, contractIds),
    );
  }
  return value as unknown as ReviewOverview;
};

export function parseReviewSpec(value: unknown): ReviewPayload {
  if (!isRecord(value)) throw new Error("JSON 根节点必须是对象");
  if (typeof value.title !== "string" || !value.title.trim())
    throw new Error("缺少 title");
  if (typeof value.subtitle !== "string") throw new Error("缺少 subtitle");
  if (!Array.isArray(value.components) || value.components.length === 0)
    throw new Error("components 不能为空");
  if (value.sourcePath !== undefined && typeof value.sourcePath !== "string")
    throw new Error("sourcePath 必须是字符串");

  // 待澄清问题与扁平 API 契约：先于 mapping 校验。契约校验建立 id 表，
  // 供 mapping.api.contractIds 跨引用命中校验使用；校验顺序与
  // render-review.mjs 镜像保持一致（openQuestions → apiContracts）。
  assertOpenQuestions(value.openQuestions, "openQuestions");
  const openQuestions: OpenQuestion[] | undefined = Array.isArray(
    value.openQuestions,
  )
    ? (value.openQuestions as OpenQuestion[])
    : undefined;
  assertApiContracts(value.apiContracts, "apiContracts");
  const apiContracts: ApiContract[] | undefined = Array.isArray(
    value.apiContracts,
  )
    ? (value.apiContracts as ApiContract[])
    : undefined;
  const contractIds = new Set(
    (apiContracts ?? []).map((contract) => contract.id),
  );

  // 解析 pages 数组：优先使用 pages，否则用 pageHtml 构造单页
  let pages: PageSpec[] = [];
  if (Array.isArray(value.pages) && value.pages.length > 0) {
    for (const [index, page] of value.pages.entries()) {
      if (
        !isRecord(page) ||
        typeof page.id !== "string" ||
        typeof page.label !== "string" ||
        (page.pageHtml !== undefined && typeof page.pageHtml !== "string") ||
        (typeof page.pageHtml === "string" && !page.pageHtml.trim())
      ) {
        throw new Error(`pages[${index}] 缺少 id 或 label`);
      }
      const scene = page.scene
        ? validatePageScene(page.scene, `pages[${index}].scene`)
        : undefined;
      if (!page.pageHtml && !scene)
        throw new Error(`pages[${index}] 需要 pageHtml 或 scene`);
      if (
        page.kind !== undefined &&
        (typeof page.kind !== "string" ||
          !PAGE_KINDS.includes(page.kind as PageKind))
      ) {
        throw new Error(`pages[${index}].kind 必须为 screen | canvas`);
      }
      validatePageGraph(page.graph, `pages[${index}].graph`);
      if (
        page.overview !== undefined &&
        (!isRecord(page.overview) ||
          Object.entries(page.overview).some(
            ([key, text]) =>
              !["title", "summary"].includes(key) || typeof text !== "string",
          ))
      ) {
        throw new Error(`pages[${index}].overview 仅支持 title/summary 字符串`);
      }
      pages.push({
        id: page.id,
        label: page.label,
        pageHtml: page.pageHtml ?? sceneFallbackHtml(scene!),
        ...(page.overview
          ? { overview: page.overview as PageSpec["overview"] }
          : {}),
        ...(page.kind === "canvas" ? { kind: "canvas" as const } : {}),
        ...(page.graph ? { graph: page.graph as PageSpec["graph"] } : {}),
        ...(scene ? { scene } : {}),
      });
    }
  } else if (typeof value.pageHtml === "string" && value.pageHtml.trim()) {
    pages = [{ id: "default", label: "页面", pageHtml: value.pageHtml }];
  } else {
    throw new Error("缺少 pages 或 pageHtml");
  }

  const pageIds = new Set(pages.map((page) => page.id));
  const rawPages = Array.isArray(value.pages) ? value.pages : [];
  pages = pages.map((page, index) => ({
    ...page,
    ...(isRecord(rawPages[index]) && rawPages[index].interactions !== undefined
      ? {
          interactions: validatePageInteractions(
            rawPages[index].interactions,
            `pages[${index}].interactions`,
            pageIds,
            collectPageElementIds(page.pageHtml),
          ),
        }
      : {}),
    ...(isRecord(rawPages[index]) && rawPages[index].scene !== undefined
      ? {
          scene: validatePageScene(
            rawPages[index].scene,
            `pages[${index}].scene`,
          ),
        }
      : {}),
  }));

  for (const [index, component] of value.components.entries()) {
    if (
      !isRecord(component) ||
      typeof component.id !== "string" ||
      typeof component.label !== "string" ||
      !Array.isArray(component.mapping) ||
      component.mapping.length === 0
    ) {
      throw new Error(`components[${index}] 缺少 id、label 或 mapping`);
    }
    for (const [rowIndex, row] of component.mapping.entries()) {
      validateMappingRow(
        row,
        `components[${index}].mapping[${rowIndex}]`,
        contractIds,
      );
    }
  }
  // David schema：递归节点校验（全局 id 唯一、深度 <= 8、anchor 完整性）。
  // component id 也纳入唯一集合，避免与 node id 冲突；旧 spec 无 children 不受影响。
  const spec = value as unknown as ReviewSpec;
  const nodeIds = new Set<string>();
  for (const component of spec.components) {
    if (nodeIds.has(component.id)) {
      throw new Error(`node id 重复: ${component.id}`);
    }
    nodeIds.add(component.id);
  }
  const nodeAnchors = collectNodeAnchors(pages);
  spec.components.forEach((component, index) =>
    validateComponentTree(component, index, nodeIds, nodeAnchors, contractIds),
  );
  // scene 是画板与 TRD/评审树的连接层：引用必须在当前 spec 中可解析，
  // 否则画板会出现“能点但无法联动”的悬空语义。
  const mappingIds = new Set(
    spec.components.flatMap((component) => [
      ...component.mapping.map((row) => row.id),
      ...component.mapping.map((row) => `${component.id}:${row.id}`),
    ]),
  );
  pages.forEach((page, pageIndex) => {
    const sourceIds = new Set([
      ...(page.scene?.components.map((item) => item.id) ?? []),
      ...collectInteractionSourceIds(page.pageHtml),
    ]);
    page.interactions?.forEach((interaction, interactionIndex) => {
      if (page.scene && !sourceIds.has(interaction.source)) {
        throw new Error(
          `pages[${pageIndex}].interactions[${interactionIndex}].source 未命中 scene 或 HTML 触点: ${interaction.source}`,
        );
      }
    });
    page.scene?.components.forEach((sceneComponent, sceneIndex) => {
      sceneComponent.mappingIds?.forEach((mappingId) => {
        if (!mappingIds.has(mappingId)) {
          throw new Error(
            `pages[${pageIndex}].scene.components[${sceneIndex}].mappingIds 未知: ${mappingId}`,
          );
        }
      });
      if (sceneComponent.nodeId && !nodeIds.has(sceneComponent.nodeId)) {
        throw new Error(
          `pages[${pageIndex}].scene.components[${sceneIndex}].nodeId 未知: ${sceneComponent.nodeId}`,
        );
      }
      if (
        sceneComponent.componentId &&
        !spec.components.some(
          (component) => component.id === sceneComponent.componentId,
        )
      ) {
        throw new Error(
          `pages[${pageIndex}].scene.components[${sceneIndex}].componentId 未知: ${sceneComponent.componentId}`,
        );
      }
    });
  });
  pages = pages.map((page) => ({
    ...page,
    pageHtml: injectMappingIds(page.pageHtml, spec.components).markup,
  }));
  const overview = validateOverview(spec.overview, contractIds);
  // 评论服务地址：只接受 127.0.0.1 / localhost 的 http(s)，其余一律丢弃。
  // 页面绝不能被 review JSON 指向任意远端主机（HARD-GATE 25）。
  const service = validateFeedbackService(spec.service);
  // 多 agent 协作清单（HARD-GATE 30）：pageId 必须命中 pages。
  const collaboration = validateCollaboration(
    spec.collaboration,
    "collaboration",
    new Set(pages.map((page) => page.id)),
  );
  return {
    data: {
      slug: typeof spec.slug === "string" ? spec.slug : spec.title,
      title: spec.title,
      subtitle: spec.subtitle,
      components: spec.components,
      // 使用已补全 scene fallback、interaction 的归一化页面，确保所有消费者
      // （App、导出器、测试工具）读取到同一份页面契约。
      pages,
      ...(openQuestions !== undefined ? { openQuestions } : {}),
      ...(apiContracts !== undefined ? { apiContracts } : {}),
      ...(overview !== undefined ? { overview } : {}),
      ...(typeof spec.sourcePath === "string"
        ? { sourcePath: spec.sourcePath }
        : {}),
      ...(collaboration !== undefined ? { collaboration } : {}),
      ...(service !== undefined ? { service } : {}),
    },
    pages,
  };
}

/**
 * 校验注入的评论服务地址。
 * 只允许 loopback 或私网/CGNAT 字面量主机——否则一份被篡改的 review JSON
 * 就能把页面里的评论发到外部服务器。放宽到私网是为了支持内网访问；公网仍拒绝。
 * 协议限 http/https，且不接受任何用户名/密码/查询串。
 */
function validateFeedbackService(
  value: unknown,
): { baseUrl: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.baseUrl !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    return undefined;
  }
  if (!["http:", "https:"].includes(url.protocol)) return undefined;
  if (!isAllowedFeedbackHost(url.hostname)) return undefined;
  if (url.username || url.password) return undefined;
  return { baseUrl: `${url.protocol}//${url.host}` };
}
