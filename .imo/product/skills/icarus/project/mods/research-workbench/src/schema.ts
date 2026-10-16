import {
  isValidServiceResource,
  type ServiceResource,
} from "../../resource-cards/src/public";
import {
  isValidCodeHighlights,
  isValidCodeSymbols,
  codeDefinitionLinks,
  type CodeDefinitions,
  type CodeHighlightRule,
} from "../../rich-code/src/public";
import { isValidLogicGraph } from "../../logic-canvas/src/public";
import { isValidCodeAnnotations } from "../../rich-code/src/public";
import type { LogicGraph } from "../../logic-canvas/src/public";
import type { CodeAnnotation } from "../../rich-code/src/public";
import type { MockCase } from "../../mock-cases/src/public";
import { isValidRichSections, type RichSection } from "../../rich-content/src/public";
export type ResearchCode = {
  id: string;
  title: string;
  /** Visible node explanation shown before source code, independently of hover. */
  explanation?: string[];
  language: string;
  code: string;
  annotations: CodeAnnotation[];
  source?: string;
  lineNumbers?: (number | null)[];
  definitions?: CodeDefinitions;
};
export type ResearchContract = Pick<
  ResearchCode,
  "language" | "code" | "annotations" | "lineNumbers" | "definitions"
>;
export type ResearchResource = ServiceResource & { afterCodeId?: string };
export type ResearchExplanation = {
  title: string;
  layer: "frontend" | "backend" | "contract" | "infrastructure";
  inputs: string[];
  outputs: string[];
  contracts?: { inputs: ResearchContract; outputs: ResearchContract };
  summary: string;
  findings?: string[];
  inputSources?: RichSection[];
  codeIds: string[];
  definitionIds?: string[];
  resource?: ResearchResource;
  resources?: ResearchResource[];
  serviceTags?: string[];
  entryFunction?: string;
  /** Explicit authoring boundary for resource inventories with no executable code. */
  flowExclusion?: string;
  transformations?: {
    input: string;
    operation: string;
    output: string;
    functionIds?: string[];
  }[];
  functionGraph?: LogicGraph;
  evidence?: { label: string; href: string }[];
  cases?: ResearchQuestion["cases"];
};
export type ResearchGraphView = {
  id: string;
  label: string;
  graph: LogicGraph;
  readingGuide?: string[];
  readingSections?: RichSection[];
};
export type ResearchQuestion = {
  id: string;
  title: string;
  answer: string;
  /** Visible explanation adjacent to the main graph; named views may override it. */
  readingGuide?: string[];
  readingSections?: RichSection[];
  aliases?: string[];
  findings: string[];
  details?: string[];
  graph: LogicGraph;
  graphViews?: ResearchGraphView[];
  dependencyGraph?: LogicGraph;
  nodeCode?: Record<string, string>;
  explanations?: Record<string, ResearchExplanation>;
  targetAliases?: Record<string, string>;
  codes: ResearchCode[];
  handoffs?: {
    from: string;
    to: string;
    mapping: string;
    extraInputs?: string;
    kind?: "data" | "control" | "dependency";
  }[];
  highlights?: CodeHighlightRule[];
  symbols?: string[];
  evidence: { label: string; href: string }[];
  cases?: MockCase[];
};
export type ResearchSpec = {
  schema: "icarus-research/v1";
  slug: string;
  title: string;
  pages: { id: string; label: string; questions: ResearchQuestion[] }[];
};
export function validateResearch(input: unknown): ResearchSpec {
  const prose = (value: unknown) => value === undefined ||
    (Array.isArray(value) && value.length > 0 && value.every((s) => typeof s === "string" && s.trim()));
  const data = input as ResearchSpec;
  if (
    !data ||
    data.schema !== "icarus-research/v1" ||
    !data.slug ||
    !data.title ||
    !Array.isArray(data.pages) ||
    !data.pages.length
  )
    throw Error("Expected icarus-research/v1 with pages");
  const pages = new Set<string>();
  for (const page of data.pages) {
    if (
      !page.id ||
      pages.has(page.id) ||
      !page.label ||
      !page.questions?.length
    )
      throw Error("Unique research pages and questions are required");
    pages.add(page.id);
    const ids = new Set<string>();
    for (const q of page.questions) {
      if (q.symbols !== undefined && !isValidCodeSymbols(q.symbols))
        throw Error("Invalid question symbols: " + q.id);
      if (
        !q.id ||
        ids.has(q.id) ||
        !q.title ||
        !q.answer ||
        !Array.isArray(q.findings) ||
        !isValidLogicGraph(q.graph) ||
        !Array.isArray(q.codes) ||
        !Array.isArray(q.evidence)
      )
        throw Error("Invalid research question " + q.id);
      ids.add(q.id);
      if (q.readingSections !== undefined && !isValidRichSections(q.readingSections))
        throw Error("Invalid structured reading sections: " + q.id);
      for (const [id, e] of Object.entries(q.explanations ?? {}))
        if (e.inputSources !== undefined && !isValidRichSections(e.inputSources))
          throw Error("Invalid input sources: " + id);
      if (
        q.readingGuide !== undefined &&
        (!Array.isArray(q.readingGuide) ||
          q.readingGuide.some((text) => typeof text !== "string" || !text.trim()))
      )
        throw Error("Invalid reading guide: " + q.id);
      if (q.highlights !== undefined && !isValidCodeHighlights(q.highlights))
        throw Error("Invalid code highlights: " + q.id);
      if (q.dependencyGraph && !isValidLogicGraph(q.dependencyGraph))
        throw Error("Invalid dependency graph: " + q.id);
      if (
        q.graphViews !== undefined &&
        (!Array.isArray(q.graphViews) ||
          !q.graphViews.length ||
          q.graphViews.some(
            (view) =>
              !view ||
              typeof view.id !== "string" ||
              !view.id.trim() ||
              typeof view.label !== "string" ||
              !view.label.trim() ||
              !prose(view.readingGuide) ||
              (view.readingSections !== undefined && !isValidRichSections(view.readingSections)) ||
              !isValidLogicGraph(view.graph),
          ) ||
          new Set(q.graphViews.map((view) => view.id)).size !==
            q.graphViews.length)
      )
        throw Error("Invalid research graph views: " + q.id);
      const codeIds = new Set<string>();
      for (const code of q.codes) {
        if (codeIds.has(code.id)) throw Error("Duplicate code id: " + code.id);
        codeIds.add(code.id);
        if (
          !code.id ||
          !code.code ||
          !prose(code.explanation) ||
          !isValidCodeAnnotations(code.annotations, code.code) ||
          !validSourceLines(code)
        )
          throw Error("Invalid code annotations: " + code.id);
        if (code.definitions)
          codeDefinitionLinks(code.code, q.symbols ?? [], code.definitions);
      }
      const graphs = [
        q.graph,
        ...(q.dependencyGraph ? [q.dependencyGraph] : []),
        ...(q.graphViews?.map((view) => view.graph) ?? []),
      ];
      const nodes = new Set(
        graphs.flatMap((graph) => graph.nodes.map((node) => node.id)),
      );
      const edges = graphs.flatMap((graph) => graph.edges);
      if (
        q.handoffs &&
        (!Array.isArray(q.handoffs) ||
          q.handoffs.some(
            (h) =>
              !h ||
              !nodes.has(h.from) ||
              !nodes.has(h.to) ||
              typeof h.mapping !== "string" ||
              !h.mapping.trim() ||
              !edges.some((edge) => edge.from === h.from && edge.to === h.to) ||
              (h.extraInputs !== undefined &&
                typeof h.extraInputs !== "string") ||
              (h.kind && !["data", "control", "dependency"].includes(h.kind)),
          ))
      )
        throw Error("Invalid graph handoff: " + q.id);
      if (q.explanations) {
        const usedCodes = new Set<string>();
        for (const node of nodes) {
          const explanation = q.explanations[node];
          if (
            !explanation ||
            !explanation.title ||
            !explanation.summary ||
            !["frontend", "backend", "contract", "infrastructure"].includes(
              explanation.layer,
            ) ||
            !Array.isArray(explanation.inputs) ||
            !explanation.inputs.length ||
            !Array.isArray(explanation.outputs) ||
            !explanation.outputs.length ||
            !Array.isArray(explanation.codeIds) ||
            ![...explanation.inputs, ...explanation.outputs].every(
              (text) => typeof text === "string" && text.trim(),
            )
          )
            throw Error("Node requires its own explanation and I/O: " + node);
          if (explanation.contracts !== undefined) {
            for (const direction of ["inputs", "outputs"] as const) {
              const contract = explanation.contracts?.[direction];
              if (
                !contract ||
                typeof contract.language !== "string" ||
                !contract.language.trim() ||
                typeof contract.code !== "string" ||
                !contract.code.trim() ||
                !isValidCodeAnnotations(contract.annotations, contract.code) ||
                !validSourceLines(contract)
              )
                throw Error(
                  "Invalid typed I/O contract: " + node + "/" + direction,
                );
              if (contract.definitions)
                codeDefinitionLinks(
                  contract.code,
                  q.symbols ?? [],
                  contract.definitions,
                );
            }
          }
          if (
            explanation.flowExclusion !== undefined &&
            (typeof explanation.flowExclusion !== "string" ||
              !explanation.flowExclusion.trim() ||
              explanation.codeIds.length > 0 ||
              explanation.transformations?.length ||
              explanation.functionGraph)
          )
            throw Error(
              "Only non-executable nodes may exclude function flow: " + node,
            );
          if (
            explanation.definitionIds !== undefined &&
            (!Array.isArray(explanation.definitionIds) ||
              explanation.definitionIds.some(
                (id) =>
                  !q.codes.some(
                    (code) => code.id === id && code.source?.trim(),
                  ),
              ))
          )
            throw Error("Type definitions require code and source: " + node);
          if (
            explanation.entryFunction !== undefined &&
            (typeof explanation.entryFunction !== "string" ||
              !explanation.functionGraph?.nodes.some(
                (n) => n.id === explanation.entryFunction,
              ))
          )
            throw Error("Entry function must be a graph node: " + node);
          if (
            explanation.serviceTags &&
            (!Array.isArray(explanation.serviceTags) ||
              explanation.serviceTags.some(
                (t) => typeof t !== "string" || !t.trim(),
              ) ||
              explanation.serviceTags.length > 4)
          )
            throw Error("Invalid service tags: " + node);
          if (
            explanation.transformations &&
            (!Array.isArray(explanation.transformations) ||
              explanation.transformations.some(
                (t) =>
                  !t ||
                  (t.functionIds !== undefined &&
                    (!Array.isArray(t.functionIds) ||
                      !t.functionIds.length ||
                      new Set(t.functionIds).size !== t.functionIds.length ||
                      t.functionIds.some(
                        (id) =>
                          !explanation.functionGraph?.nodes.some(
                            (n) => n.id === id,
                          ),
                      ))) ||
                  ![t.input, t.operation, t.output].every(
                    (v) => typeof v === "string" && !!v.trim(),
                  ),
              ))
          )
            throw Error("Invalid transformations: " + node);
          if (
            explanation.resources !== undefined &&
            !Array.isArray(explanation.resources)
          )
            throw Error("Resources must be an array");
          if (
            explanation.functionGraph !== undefined &&
            (!isValidLogicGraph(explanation.functionGraph) ||
              explanation.functionGraph.nodes.some(
                (n) => !explanation.codeIds.includes(n.id),
              ))
          )
            throw Error("Function graph must bind owned code: " + node);
          for (const resource of [
            ...(explanation.resource ? [explanation.resource] : []),
            ...(explanation.resources ?? []),
          ])
            if (
              !isValidServiceResource(resource) ||
              (resource.afterCodeId !== undefined &&
                !explanation.codeIds.includes(resource.afterCodeId))
            )
              throw Error("Invalid source resource: " + node);
          for (const code of [
            ...explanation.codeIds,
            ...(explanation.definitionIds ?? []),
          ]) {
            if (!codeIds.has(code) || usedCodes.has(code))
              throw Error("Code must belong to exactly one node: " + code);
            usedCodes.add(code);
          }
        }
        if (Object.keys(q.explanations).some((id) => !nodes.has(id)))
          throw Error("Explanation has no graph node: " + q.id);
        if ([...codeIds].some((id) => !usedCodes.has(id)))
          throw Error("Code has no explanation owner: " + q.id);
      } else {
        for (const [node, code] of Object.entries(q.nodeCode ?? {})) {
          if (!nodes.has(node) || !codeIds.has(code))
            throw Error("Invalid node-code binding: " + q.id + "/" + node);
        }
        for (const code of codeIds) {
          if (!Object.values(q.nodeCode ?? {}).includes(code))
            throw Error(
              "Code requires a graph node binding: " + q.id + "/" + code,
            );
        }
      }
    }
  }
  return data;
}

function validSourceLines(value: ResearchContract): boolean {
  return (
    value.lineNumbers === undefined ||
    (Array.isArray(value.lineNumbers) &&
      value.lineNumbers.length === value.code.split("\n").length &&
      value.lineNumbers.every(
        (n) => n === null || (Number.isSafeInteger(n) && n > 0),
      ))
  );
}
