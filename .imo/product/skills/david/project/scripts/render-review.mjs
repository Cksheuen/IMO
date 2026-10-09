#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const [specPath, outArg] = process.argv.slice(2);
if (!specPath) {
  console.error("Usage: node render-review.mjs <review.json> [output.html]");
  process.exit(2);
}
const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// Both published entry points resolve the same canonical pure models.
const sourceRoot = fs.existsSync(path.join(skillRoot, "src/lib/changeModel.ts"))
  ? skillRoot
  : path.join(skillRoot, "project");
const { isValidChangeBlock: isChangeBlockShape } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/changeModel.ts")).href
);
const { isValidLogicGraph, isValidCodeFlow } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/logicGraph.ts")).href
);
const { isValidDetailPreview } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/detailPreview.ts")).href
);
const { isValidCodeAnnotations } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/codeAnnotations.ts")).href
);
const { assertPreparation } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/preparationModel.ts")).href
);
const { buildDesignContext } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/designContext.ts")).href
);
const bundledTemplatePath = path.join(skillRoot, "dist/template.html");
const templatePath = process.env.DAVID_TEMPLATE_PATH
  ? path.resolve(process.env.DAVID_TEMPLATE_PATH)
  : fs.existsSync(bundledTemplatePath)
    ? bundledTemplatePath
    : path.join(skillRoot, "template.html");
const specInput = fs.readFileSync(path.resolve(specPath), "utf8");
const spec = JSON.parse(specInput);

const escapeSceneHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

const sceneFallbackHtml = (scene) => {
  if (!scene || !Array.isArray(scene.components)) return "";
  return `<div class="david-scene-renderer" data-review-target="scene" data-review-label="结构化画板">${scene.components
    .map((component) => {
      const id = escapeSceneHtml(component.id);
      const role = escapeSceneHtml(component.role ?? "component");
      const componentId = component.componentId
        ? ` data-component-id="${escapeSceneHtml(component.componentId)}"`
        : "";
      const nodeId = component.nodeId
        ? ` data-review-node-id="${escapeSceneHtml(component.nodeId)}"`
        : "";
      return `<section class="david-scene-component${component.role === "modal" ? " david-scene-modal" : ""}" data-scene-id="${id}" data-review-element-id="${id}" data-review-target="${id}" data-review-label="${id}"${component.role === "modal" ? ` role="dialog" aria-modal="true" aria-hidden="true"` : ""}${componentId}${nodeId}><strong>${id}</strong><small>${role}${component.source?.file ? ` · ${escapeSceneHtml(component.source.file)}` : ""}</small>${component.role === "modal" ? `<button type="button" data-review-overlay-close aria-label="关闭弹窗">关闭</button>` : ""}</section>`;
    })
    .join("")}</div>`;
};

// 支持 pages 数组或单页 pageHtml
const hasPages = Array.isArray(spec.pages) && spec.pages.length > 0;
const required = hasPages
  ? ["title", "subtitle", "components"]
  : ["title", "subtitle", "pageHtml", "components"];
for (const key of required)
  if (!(key in spec)) throw new Error(`review spec 缺少字段: ${key}`);
if (typeof spec.title !== "string" || typeof spec.subtitle !== "string") {
  throw new Error("review spec 的 title 和 subtitle 必须为字符串");
}

let pages;
if (hasPages) {
  pages = spec.pages;
  for (const [index, page] of pages.entries()) {
    if (!page.id || !page.label || (!page.pageHtml && !page.scene)) {
      throw new Error(`pages[${index}] 需要 id、label 以及 pageHtml 或 scene`);
    }
    if (
      page.overview !== undefined &&
      (!page.overview ||
        typeof page.overview !== "object" ||
        Array.isArray(page.overview) ||
        Object.entries(page.overview).some(
          ([key, text]) =>
            !["title", "summary"].includes(key) || typeof text !== "string",
        ))
    ) {
      throw new Error(`pages[${index}].overview 仅支持 title/summary 字符串`);
    }
    if (!page.pageHtml && page.scene)
      page.pageHtml = sceneFallbackHtml(page.scene);
  }
} else {
  pages = [{ id: "default", label: "页面", pageHtml: spec.pageHtml }];
}

if (!Array.isArray(spec.components) || spec.components.length === 0)
  throw new Error("components 不能为空");

for (const [index, page] of pages.entries()) {
  const ids = new Set();
  for (const match of page.pageHtml.matchAll(
    /(?:^|\s)(?:data-(?:review-element-id|review-overlay-id|scene-id)|id)=["']([^"']+)["']/g,
  ))
    ids.add(match[1]);
  for (const [interactionIndex, interaction] of (Array.isArray(
    page.interactions,
  )
    ? page.interactions
    : []
  ).entries()) {
    if (
      ["show", "hide", "toggle", "close"].includes(interaction.action) &&
      interaction.targetElementId &&
      !ids.has(interaction.targetElementId)
    ) {
      throw new Error(
        `pages[${index}].interactions[${interactionIndex}] targetElementId 未命中当前页面元素`,
      );
    }
  }
}

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * 校验代码块的语义行范围注释：1-based、含两端、有序不重叠、不越界，
 * title 与 bullets 非空。与 src/lib/reviewSpec.ts 保持同一口径。
 */

const isTrdColumnContent = (value) => {
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
      if (tp.changeBlock !== undefined && !isChangeBlockShape(tp.changeBlock))
        return false;
      if (tp.codeLabel !== undefined && typeof tp.codeLabel !== "string")
        return false;
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
      if (
        it.codeAnnotations !== undefined &&
        !isValidCodeAnnotations(it.codeAnnotations, it.code)
      ) {
        return false;
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
          it.fields.some((f) => !isRecord(f) || typeof f.name !== "string"))
      ) {
        return false;
      }
    }
  }

  if (
    value.fields !== undefined &&
    (!Array.isArray(value.fields) ||
      value.fields.some((f) => !isRecord(f) || typeof f.name !== "string"))
  ) {
    return false;
  }

  return true;
};

const isCrossSection = (value) => {
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

const validateApiField = (field, fieldPath) => {
  if (!isRecord(field) || typeof field.name !== "string") {
    throw new Error(`${fieldPath} 缺少 name`);
  }
  if (field.target !== undefined && typeof field.target !== "string") {
    throw new Error(`${fieldPath}.target 必须为字符串`);
  }
};

// changeBlock 校验（与 src/lib/changeModel.ts 保持同一口径）。
const validateChangeBlock = (block, pathLabel) => {
  if (!isChangeBlockShape(block)) {
    throw new Error(
      `${pathLabel} 格式错误（kind=add|modify|migrate|remove；rationale 必填 ≤800；add 仅 after、remove 仅 before、modify/migrate 双侧；side 的 code/text 二选一）`,
    );
  }
};

// openQuestions 校验（与 src/lib/openQuestionModel.ts 保持同一口径）。
const OPEN_QUESTION_KEYS = [
  "id",
  "topic",
  "status",
  "prd",
  "prdRef",
  "design",
  "designRef",
  "conflict",
  "options",
  "recommendation",
];
const OPEN_QUESTION_STATUSES = new Set(["open", "resolved"]);
const validateOpenQuestions = (list) => {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new Error("openQuestions 必须是数组");
  const ids = new Set();
  list.forEach((item, index) => {
    const p = `openQuestions[${index}]`;
    if (!isRecord(item)) throw new Error(`${p} 必须是对象`);
    for (const key of Object.keys(item)) {
      if (!OPEN_QUESTION_KEYS.includes(key))
        throw new Error(`${p}.${key} 非法字段`);
    }
    if (typeof item.id !== "string" || !item.id.trim())
      throw new Error(`${p}.id 必填且为非空字符串`);
    if (ids.has(item.id)) throw new Error(`${p}.id 重复: ${item.id}`);
    ids.add(item.id);
    if (typeof item.topic !== "string" || !item.topic.trim())
      throw new Error(`${p}.topic 必填且为非空字符串`);
    if (item.topic.length > 120)
      throw new Error(
        `${p}.topic 长度不能超过 120 字符（当前 ${item.topic.length}）`,
      );
    if (item.status !== undefined && !OPEN_QUESTION_STATUSES.has(item.status)) {
      throw new Error(`${p}.status 必须为 open | resolved`);
    }
    const boundedStrings = [
      ["prd", 2000],
      ["prdRef", 400],
      ["design", 2000],
      ["designRef", 400],
      ["conflict", 2000],
      ["recommendation", 1000],
    ];
    for (const [key, max] of boundedStrings) {
      const value = item[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !value.trim())
        throw new Error(`${p}.${key} 必须为非空字符串`);
      if (value.length > max)
        throw new Error(
          `${p}.${key} 长度不能超过 ${max} 字符（当前 ${value.length}）`,
        );
    }
    if (item.options !== undefined) {
      if (!Array.isArray(item.options))
        throw new Error(`${p}.options 必须是字符串数组`);
      if (item.options.length > 8)
        throw new Error(
          `${p}.options 最多 8 项（当前 ${item.options.length}）`,
        );
      item.options.forEach((option, optionIndex) => {
        if (typeof option !== "string" || !option.trim())
          throw new Error(`${p}.options[${optionIndex}] 必须为非空字符串`);
        if (option.length > 400)
          throw new Error(
            `${p}.options[${optionIndex}] 长度不能超过 400 字符（当前 ${option.length}）`,
          );
      });
    }
  });
};

// apiContracts 校验（与 src/lib/contractModel.ts 保持同一口径）；
// 返回全部契约 id，供 mapping.api.contractIds 跨引用命中校验。
const API_CONTRACT_KEYS = [
  "provision",
  "id",
  "status",
  "title",
  "endpoint",
  "method",
  "request",
  "response",
  "notes",
];
const API_CONTRACT_FIELD_KEYS = [
  "name",
  "type",
  "required",
  "meaning",
  "provision",
];
const API_CONTRACT_PROVISIONS = new Set([
  "backend-defined",
  "existing",
  "missing",
]);
const API_CONTRACT_STATUSES = new Set(["proposed", "confirmed"]);
const validateApiContractField = (field, p) => {
  if (!isRecord(field)) throw new Error(`${p} 必须是对象`);
  for (const key of Object.keys(field)) {
    if (!API_CONTRACT_FIELD_KEYS.includes(key))
      throw new Error(`${p}.${key} 非法字段`);
  }
  if (
    field.provision !== undefined &&
    !API_CONTRACT_PROVISIONS.has(field.provision)
  )
    throw new Error(
      `${p}.provision 必须为 backend-defined | existing | missing`,
    );
  if (typeof field.name !== "string" || !field.name.trim())
    throw new Error(`${p}.name 必填且为非空字符串`);
  if (field.name.length > 120)
    throw new Error(
      `${p}.name 长度不能超过 120 字符（当前 ${field.name.length}）`,
    );
  if (field.type !== undefined) {
    if (typeof field.type !== "string" || !field.type.trim())
      throw new Error(`${p}.type 必须为非空字符串`);
    if (field.type.length > 120)
      throw new Error(
        `${p}.type 长度不能超过 120 字符（当前 ${field.type.length}）`,
      );
  }
  if (field.required !== undefined && typeof field.required !== "boolean")
    throw new Error(`${p}.required 必须为布尔值`);
  if (field.meaning !== undefined) {
    if (typeof field.meaning !== "string" || !field.meaning.trim())
      throw new Error(`${p}.meaning 必须为非空字符串`);
    if (field.meaning.length > 400)
      throw new Error(
        `${p}.meaning 长度不能超过 400 字符（当前 ${field.meaning.length}）`,
      );
  }
};
const validateApiContractFieldList = (list, p) => {
  if (!Array.isArray(list)) throw new Error(`${p} 必须是数组`);
  list.forEach((field, index) =>
    validateApiContractField(field, `${p}[${index}]`),
  );
};
const validateApiContracts = (list) => {
  const ids = new Set();
  if (list === undefined) return ids;
  if (!Array.isArray(list)) throw new Error("apiContracts 必须是数组");
  list.forEach((item, index) => {
    const p = `apiContracts[${index}]`;
    if (!isRecord(item)) throw new Error(`${p} 必须是对象`);
    for (const key of Object.keys(item)) {
      if (!API_CONTRACT_KEYS.includes(key))
        throw new Error(`${p}.${key} 非法字段`);
    }
    if (typeof item.id !== "string" || !item.id.trim())
      throw new Error(`${p}.id 必填且为非空字符串`);
    if (ids.has(item.id)) throw new Error(`${p}.id 重复: ${item.id}`);
    ids.add(item.id);
    if (
      item.provision !== undefined &&
      !API_CONTRACT_PROVISIONS.has(item.provision)
    )
      throw new Error(
        `${p}.provision 必须为 backend-defined | existing | missing`,
      );
    if (!API_CONTRACT_STATUSES.has(item.status))
      throw new Error(`${p}.status 必须为 proposed | confirmed`);
    const boundedStrings = [
      ["title", 160],
      ["endpoint", 400],
      ["method", 40],
      ["notes", 2000],
    ];
    for (const [key, max] of boundedStrings) {
      const value = item[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !value.trim())
        throw new Error(`${p}.${key} 必须为非空字符串`);
      if (value.length > max)
        throw new Error(
          `${p}.${key} 长度不能超过 ${max} 字符（当前 ${value.length}）`,
        );
    }
    if (item.request !== undefined)
      validateApiContractFieldList(item.request, `${p}.request`);
    if (item.response !== undefined)
      validateApiContractFieldList(item.response, `${p}.response`);
  });
  return ids;
};
// mapping.api.contractIds：非空字符串数组、不重复、每项命中顶层契约 id。
const validateContractIds = (list, pathLabel, knownContractIds) => {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new Error(`${pathLabel} 必须是字符串数组`);
  const seen = new Set();
  list.forEach((id, index) => {
    const p = `${pathLabel}[${index}]`;
    if (typeof id !== "string" || !id.trim())
      throw new Error(`${p} 必须为非空字符串`);
    if (seen.has(id)) throw new Error(`${p} 重复: ${id}`);
    if (!knownContractIds.has(id))
      throw new Error(`${p} 引用未知 apiContracts id: ${id}`);
    seen.add(id);
  });
};

const validateMappingRow = (
  row,
  pathLabel,
  seenIds = new Set(),
  knownContractIds = new Set(),
) => {
  if (
    !isRecord(row) ||
    typeof row.id !== "string" ||
    typeof row.requirement !== "string" ||
    typeof row.change !== "string" ||
    !isRecord(row.api)
  ) {
    throw new Error(`${pathLabel} 缺少 id、requirement、change 或 api`);
  }
  if (seenIds.has(row.id)) {
    throw new Error(`${pathLabel} 行 ID 重复: ${row.id}`);
  }
  seenIds.add(row.id);
  if (row.title !== undefined && typeof row.title !== "string") {
    throw new Error(`${pathLabel}.title 必须为字符串`);
  }
  if (
    row.codePaths !== undefined &&
    (!Array.isArray(row.codePaths) ||
      row.codePaths.some((p) => typeof p !== "string"))
  ) {
    throw new Error(`${pathLabel}.codePaths 格式错误`);
  }
  if (row.reviewBrief !== undefined && !isRecord(row.reviewBrief)) {
    throw new Error(`${pathLabel}.reviewBrief 格式错误`);
  }
  if (row.d2c !== undefined && typeof row.d2c !== "string") {
    throw new Error(`${pathLabel}.d2c 必须为字符串`);
  }
  if (row.overviewSummary !== undefined) {
    if (!isRecord(row.overviewSummary)) {
      throw new Error(`${pathLabel}.overviewSummary 格式错误`);
    }
    for (const key of Object.keys(row.overviewSummary)) {
      if (key !== "requirement" && key !== "change" && key !== "api") {
        throw new Error(`${pathLabel}.overviewSummary.${key} 非法字段`);
      }
      const value = row.overviewSummary[key];
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 240
      ) {
        throw new Error(
          `${pathLabel}.overviewSummary.${key} 必须为非空字符串且长度不超过 240`,
        );
      }
    }
  }
  if (row.api.fields !== undefined) {
    if (!Array.isArray(row.api.fields)) {
      throw new Error(`${pathLabel}.api.fields 格式错误`);
    }
    row.api.fields.forEach((field, index) =>
      validateApiField(field, `${pathLabel}.api.fields[${index}]`),
    );
  }
  if (row.api.contractIds !== undefined) {
    validateContractIds(
      row.api.contractIds,
      `${pathLabel}.api.contractIds`,
      knownContractIds,
    );
  }
  if (row.preparation !== undefined)
    assertPreparation(row.preparation, `${pathLabel}.preparation`);
  if (row.changeBlock !== undefined) {
    validateChangeBlock(row.changeBlock, `${pathLabel}.changeBlock`);
  }
  if (row.cross !== undefined && !isCrossSection(row.cross)) {
    throw new Error(`${pathLabel}.cross 格式错误`);
  }
  if (row.trd !== undefined) {
    if (!isRecord(row.trd)) {
      throw new Error(`${pathLabel}.trd 格式错误`);
    }
    for (const column of ["productDesign", "technical", "apiChange"]) {
      if (
        row.trd[column] !== undefined &&
        !isTrdColumnContent(row.trd[column])
      ) {
        throw new Error(`${pathLabel}.trd.${column} 格式错误`);
      }
    }
    const apiChange = row.trd.apiChange;
    if (isRecord(apiChange)) {
      if (Array.isArray(apiChange.items)) {
        apiChange.items.forEach((item, itemIndex) => {
          if (isRecord(item) && Array.isArray(item.fields)) {
            item.fields.forEach((field, fieldIndex) =>
              validateApiField(
                field,
                `${pathLabel}.trd.apiChange.items[${itemIndex}].fields[${fieldIndex}]`,
              ),
            );
          }
        });
      }
      if (Array.isArray(apiChange.fields)) {
        apiChange.fields.forEach((field, fieldIndex) =>
          validateApiField(
            field,
            `${pathLabel}.trd.apiChange.fields[${fieldIndex}]`,
          ),
        );
      }
    }
  }
};

// 顶层待澄清问题与扁平 API 契约先于 mapping 校验：契约 id 表供
// mapping.api.contractIds 跨引用命中校验（与 reviewSpec.ts 同序）。
validateOpenQuestions(spec.openQuestions);
const knownContractIds = validateApiContracts(spec.apiContracts);

for (const [componentIndex, component] of spec.components.entries()) {
  if (
    !isRecord(component) ||
    typeof component.id !== "string" ||
    !component.id.trim() ||
    typeof component.label !== "string" ||
    !component.label.trim() ||
    !Array.isArray(component.mapping) ||
    component.mapping.length === 0
  ) {
    throw new Error(
      `components[${componentIndex}] 缺少 id、label 或非空 mapping`,
    );
  }
  const mappingIds = new Set();
  component.mapping.forEach((row, rowIndex) =>
    validateMappingRow(
      row,
      `组件 ${component.id} 的 mapping[${rowIndex}]`,
      mappingIds,
      knownContractIds,
    ),
  );
}

// 显式 target 必须能在 pageHtml 中命中一个 review/API 锚点，否则字段按钮会
// 看似可点击但没有任何视觉反馈。没有 target 的字段允许作为契约/容器证据存在，
// 但生成方应在 meaning 中说明它不是独立视觉节点。
const pageMarkup = pages.map((page) => page.pageHtml).join("\n");
const readAttributeTokens = (attribute) => {
  const values = [
    ...pageMarkup.matchAll(new RegExp(`${attribute}=["']([^"']*)["']`, "g")),
  ];
  return new Set(
    values.flatMap((match) => match[1].split(/\s+/).filter(Boolean)),
  );
};
const apiAnchors = readAttributeTokens("data-api-field");
const reviewTargets = readAttributeTokens("data-review-target");

// David schema：递归节点等价校验（与 src/lib/reviewSpec.ts 保持一致）。
// 全局 node id 唯一、嵌套深度 <= 8、每个节点都必须存在
// data-review-node-id 等于 target 或 id 的锚点；
// mappingIds 非空时每个 id 必须命中所属 root component 的 mapping。
const REVIEW_INTERACTIONS = new Set(["highlight", "drilldown", "auto"]);
const MAX_REVIEW_TREE_DEPTH = 8;
const DEEP_DIVE_KEYS = [
  "summary",
  "codePaths",
  "logic",
  "state",
  "edgeCases",
  "tests",
];
const nodeAnchors = readAttributeTokens("data-review-node-id");
const mappingRowsToCheck = [];
const addMappingRows = (rows, context) => {
  rows.forEach((row, index) =>
    mappingRowsToCheck.push({ row, context: `${context}.mapping[${index}]` }),
  );
};

for (const component of spec.components) {
  addMappingRows(component.mapping, `组件 ${component.id}`);
}

const validateDeepDive = (value, pathLabel) => {
  if (!isRecord(value)) throw new Error(`${pathLabel}.deepDive 必须是对象`);
  for (const key of DEEP_DIVE_KEYS) {
    const list = value[key];
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some((item) => typeof item !== "string"))
    ) {
      throw new Error(`${pathLabel}.deepDive.${key} 必须是字符串数组`);
    }
  }
};

const validateReviewNode = (node, pathLabel, ids, depth, rootMappingIds) => {
  if (depth > MAX_REVIEW_TREE_DEPTH) {
    throw new Error(`node 嵌套深度超过 ${MAX_REVIEW_TREE_DEPTH}`);
  }
  if (!isRecord(node) || !node.id || typeof node.id !== "string") {
    throw new Error(`${pathLabel} 缺少 id`);
  }
  if (typeof node.label !== "string" || !node.label.trim()) {
    throw new Error(`${pathLabel}(${node.id}) 缺少 label`);
  }
  if (
    node.interaction !== undefined &&
    !REVIEW_INTERACTIONS.has(node.interaction)
  ) {
    throw new Error(
      `${pathLabel}(${node.id}).interaction 非法: ${String(node.interaction)}`,
    );
  }
  if (ids.has(node.id)) throw new Error(`node id 重复: ${node.id}`);
  ids.add(node.id);
  if (node.target !== undefined && typeof node.target !== "string") {
    throw new Error(`${pathLabel}(${node.id}).target 必须为字符串`);
  }
  if (node.mapping !== undefined) {
    if (!Array.isArray(node.mapping))
      throw new Error(`${pathLabel}(${node.id}).mapping 必须是数组`);
    const mappingIds = new Set();
    node.mapping.forEach((row, index) => {
      const rowPath = `${pathLabel}(${node.id}).mapping[${index}]`;
      validateMappingRow(row, rowPath, mappingIds, knownContractIds);
    });
    addMappingRows(node.mapping, `${pathLabel}(${node.id})`);
  }
  if (node.mappingIds !== undefined) {
    if (node.mapping !== undefined) {
      throw new Error(
        `${pathLabel}(${node.id}) 不能同时指定 mapping 与 mappingIds`,
      );
    }
    if (
      !Array.isArray(node.mappingIds) ||
      node.mappingIds.some((id) => typeof id !== "string")
    ) {
      throw new Error(`${pathLabel}(${node.id}).mappingIds 必须是字符串数组`);
    }
    if (node.mappingIds.length === 0) {
      throw new Error(`${pathLabel}(${node.id}).mappingIds 不能为空`);
    }
    for (const mappingId of node.mappingIds) {
      if (!rootMappingIds.has(mappingId)) {
        throw new Error(
          `${pathLabel}(${node.id}).mappingIds 引用未知 mapping ID: ${mappingId}`,
        );
      }
    }
  }
  if (node.deepDive !== undefined) {
    validateDeepDive(node.deepDive, `${pathLabel}(${node.id})`);
  }
  const anchor = node.target || node.id;
  if (!nodeAnchors.has(anchor)) {
    throw new Error(
      `node ${node.id} 在 pageHtml 中缺少 data-review-node-id="${anchor}" 锚点`,
    );
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children))
      throw new Error(`${pathLabel}(${node.id}).children 必须是数组`);
    node.children.forEach((child, index) =>
      validateReviewNode(
        child,
        `${pathLabel}(${node.id}).children[${index}]`,
        ids,
        depth + 1,
        rootMappingIds,
      ),
    );
  }
};

const nodeIds = new Set();
for (const component of spec.components) {
  if (nodeIds.has(component.id)) {
    throw new Error(`node id 重复: ${component.id}`);
  }
  nodeIds.add(component.id);
}

for (const component of spec.components) {
  if (
    component.interaction !== undefined &&
    !REVIEW_INTERACTIONS.has(component.interaction)
  ) {
    throw new Error(
      `组件 ${component.id} 的 interaction 非法: ${String(component.interaction)}`,
    );
  }
  if (component.target !== undefined && typeof component.target !== "string") {
    throw new Error(`组件 ${component.id} 的 target 必须为字符串`);
  }
  if (component.deepDive !== undefined)
    validateDeepDive(component.deepDive, `组件 ${component.id}`);
  if (component.children !== undefined) {
    if (!Array.isArray(component.children))
      throw new Error(`组件 ${component.id} 的 children 必须是数组`);
    component.children.forEach((child, index) =>
      validateReviewNode(
        child,
        `组件 ${component.id}.children[${index}]`,
        nodeIds,
        1,
        new Set(component.mapping.map((row) => row.id)),
      ),
    );
  }
}

if (spec.overview !== undefined) {
  if (!isRecord(spec.overview)) throw new Error("overview 必须是对象");
  if (
    spec.overview.title !== undefined &&
    typeof spec.overview.title !== "string"
  ) {
    throw new Error("overview.title 必须为字符串");
  }
  if (
    spec.overview.summary !== undefined &&
    typeof spec.overview.summary !== "string"
  ) {
    throw new Error("overview.summary 必须为字符串");
  }
  if (spec.overview.mapping !== undefined) {
    if (!Array.isArray(spec.overview.mapping))
      throw new Error("overview.mapping 必须是数组");
    const mappingIds = new Set();
    spec.overview.mapping.forEach((row, index) =>
      validateMappingRow(
        row,
        `overview.mapping[${index}]`,
        mappingIds,
        knownContractIds,
      ),
    );
    addMappingRows(spec.overview.mapping, "overview");
  }
}
let targetBindings = 0;
let fieldBindings = 0;
let targetOnlyBindings = 0;
const collectMappingFields = (row) => {
  const fields = [];
  if (Array.isArray(row.api.fields)) fields.push(...row.api.fields);
  const apiChange = isRecord(row.trd) ? row.trd.apiChange : undefined;
  if (isRecord(apiChange)) {
    if (Array.isArray(apiChange.items)) {
      for (const item of apiChange.items) {
        if (isRecord(item) && Array.isArray(item.fields)) {
          fields.push(...item.fields);
        }
      }
    }
    if (Array.isArray(apiChange.fields)) fields.push(...apiChange.fields);
  }
  return fields;
};

for (const { row, context } of mappingRowsToCheck) {
  for (const field of collectMappingFields(row)) {
    const hasExactFieldAnchor = apiAnchors.has(field.name);
    if (hasExactFieldAnchor) fieldBindings += 1;
    if (!field.target) continue;
    const tokens = field.target.split(/[\s,]+/).filter(Boolean);
    if (
      !tokens.some((token) => apiAnchors.has(token) || reviewTargets.has(token))
    ) {
      throw new Error(
        `字段 ${context}/${row.id}/${field.name} 的 target 无法在 pageHtml 命中: ${field.target}`,
      );
    }
    if (!hasExactFieldAnchor) targetOnlyBindings += 1;
    targetBindings += 1;
  }
}
let sourceHash;
try {
  const sourcePath = path.resolve(
    path.dirname(specPath),
    spec.sourcePath || specPath,
  );
  if (fs.existsSync(sourcePath)) {
    sourceHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(sourcePath))
      .digest("hex");
  } else if (fs.existsSync(specPath)) {
    sourceHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(specPath))
      .digest("hex");
  } else {
    sourceHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(spec))
      .digest("hex");
  }
} catch {
  sourceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(spec))
    .digest("hex");
}
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeInlineJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// ── hover 联动契约（写入端）────────────────────────────────────────────────
// 读取端在 project/src/components/details/OverviewDetails.tsx 用
//   [data-review-mapping-id~="<componentId>:<rowId>"]
// 在 pageHtml 中定位 hover 的 mapping 行对应元素。该属性由此处自动注入，作者
// 无需手写；若两端只改一侧，overview hover 会退化成整组件高亮或完全不高亮。
// 修改本函数或删除调用前，请同步确认 OverviewDetails 的选择器。
const { injectMappingIds } = await import(
  pathToFileURL(path.join(sourceRoot, "src/lib/mappingTargets.ts")).href
);
let mappingIdInjections = 0;
for (const page of pages) {
  const result = injectMappingIds(page.pageHtml, spec.components);
  page.pageHtml = result.markup;
  mappingIdInjections += result.injected;
}

// 默认分享产物不注入 collaboration ownership；开发态可用
// DAVID_COLLAB_RUNTIME=1 显式注入，供协作工具读取，不改变普通评审页边界。
const replacements = {
  "{{TITLE}}": escapeHtml(spec.title),
  "{{SUBTITLE}}": escapeHtml(spec.subtitle),
  "{{SOURCE_SHA256}}": sourceHash,
  "{{PAGE_HTML}}": pages[0]?.pageHtml ?? "",
  "{{REVIEW_DATA_JSON}}": safeInlineJson({
    slug: spec.slug || path.basename(specPath, ".json"),
    title: spec.title,
    subtitle: spec.subtitle,
    ...(typeof spec.sourcePath === "string"
      ? { sourcePath: spec.sourcePath }
      : {}),
    // 本机评论服务地址。刻意不注入任何 token——评审页是要发给别人看的产物，
    // 凭据会随文件外泄。安全边界是服务只绑 127.0.0.1。
    service: {
      baseUrl:
        process.env.DAVID_FEEDBACK_BASE_URL ||
        `http://127.0.0.1:${process.env.DAVID_FEEDBACK_PORT || 5180}`,
    },
    components: spec.components,
    pages,
    ...(spec.overview ? { overview: spec.overview } : {}),
    ...(spec.openQuestions ? { openQuestions: spec.openQuestions } : {}),
    ...(spec.apiContracts ? { apiContracts: spec.apiContracts } : {}),
    ...(process.env.DAVID_COLLAB_RUNTIME === "1" && spec.collaboration
      ? { collaboration: spec.collaboration }
      : {}),
  }),
};
let html = fs.readFileSync(templatePath, "utf8");
html = html.replace(
  /{{(?:TITLE|SUBTITLE|SOURCE_SHA256|PAGE_HTML|REVIEW_DATA_JSON)}}/g,
  (token) => replacements[token],
);
// Keep a real directory in the disk artifact, before React runs. createRoot
// replaces this child with App's current-data directory, so there is only one.
const contextScript = `<script id="david-design-context" type="application/json">${safeInlineJson(buildDesignContext({ ...spec, slug: spec.slug || path.basename(specPath, ".json") }, pages))}</script>`;
const rootTag = /<div\b[^>]*\bid\s*=\s*(["'])review-root\1[^>]*>/i;
html = rootTag.test(html)
  ? html.replace(rootTag, (tag) => tag + contextScript)
  : html.replace(/<\/body>/i, () => contextScript + "</body>");
if (
  (html.match(/<script\b[^>]*\bid=["']david-design-context["']/gi) ?? [])
    .length !== 1
) {
  throw new Error(
    "rendered HTML must contain exactly one david-design-context script",
  );
}
const outPath = path.resolve(
  outArg ||
    spec.output ||
    path.join(
      path.dirname(specPath),
      `${path.basename(specPath, ".json")}.review.html`,
    ),
);
// Bind the artifact to the actual renderer input, not spec.sourcePath (a PRD/code reference).
const sourceReceipt = {
  schema: "david-review-source/v1",
  dataSha256: crypto
    .createHash("sha256")
    .update(JSON.stringify(JSON.parse(replacements["{{REVIEW_DATA_JSON}}"])))
    .digest("hex"),
  relativePath: path.relative(path.dirname(outPath), path.resolve(specPath)),
  sha256: crypto.createHash("sha256").update(specInput).digest("hex"),
};
html = html.replace(
  /<\/body>/i,
  () =>
    `<script id="david-review-source" type="application/json">${safeInlineJson(sourceReceipt)}</script></body>`,
);
fs.writeFileSync(outPath, html);
console.log(
  JSON.stringify(
    {
      output: outPath,
      sourceSha256: sourceHash,
      components: spec.components.length,
      pages: pages.length,
      targetBindings,
      fieldBindings,
      targetOnlyBindings,
      mappingIdInjections,
    },
    null,
    2,
  ),
);
