import { MockCases } from "../../mock-cases/src/public";
import { RichDocument } from "../../rich-content/src/public";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LogicCanvas,
  FoldableLogicCanvas,
} from "../../logic-canvas/src/public";
import { CodeBlock } from "../../rich-code/src/public";
import { CommentRail } from "@david/components/comment/CommentRail";
import { DavidFeedbackPanel } from "@david/components/feedback/DavidFeedbackPanel";
import {
  GlobalRegionSelection,
  REQUEST_CAPTURE_EVENT,
} from "@david/components/feedback/GlobalRegionSelection";
import { prepareReviewTargets } from "@david/lib/domTargets";
import { useDavidFeedback } from "@david/hooks/useDavidFeedback";
import {
  createFeedbackDocument,
  feedbackSelections,
  type DavidFeedbackEntry,
} from "@david/lib/davidFeedback";
import type { AppearanceSelection } from "@david/lib/globalSelection";
import { IconButton } from "@david/components/ui/IconButton";
import { Toolbar } from "@david/components/ui/Toolbar";
import type {
  ResearchExplanation,
  ResearchQuestion,
  ResearchSpec,
} from "./schema";
import "./research.css";
import { Reveal } from "./Reveal";
import { SourceResource } from "../../resource-cards/src/public";
import { explanationFlow, selectedFlowCodes } from "./dataFlow";
const resourcesFor = (e: ResearchExplanation) => [
  ...(e.resource ? [e.resource] : []),
  ...(e.resources ?? []),
];
import { graphReadingOrder } from "../../logic-canvas/src/public";
const layerLabels = {
  frontend: "前端",
  backend: "后端",
  contract: "接口契约",
  infrastructure: "基础设施",
} as const;
export function ResearchWorkbench({
  data,
  baseUrl,
}: {
  data: ResearchSpec;
  baseUrl: string;
}) {
  const [pageId, setPageId] = useState(data.pages[0].id),
    [questionId, setQuestionId] = useState(data.pages[0].questions[0].id);
  const page = data.pages.find((item) => item.id === pageId) ?? data.pages[0],
    question =
      page.questions.find((item) => item.id === questionId) ??
      page.questions[0];
  const david = useDavidFeedback(data.slug, baseUrl),
    doc = useMemo(
      () => david.feedback ?? createFeedbackDocument(data.slug),
      [david.feedback, data.slug],
    );
  const leftRef = useRef<HTMLElement>(null);
  const compactGraphObstacle = useCallback(
    () =>
      leftRef.current
        ?.querySelector<HTMLButtonElement>(
          'button[aria-controls="research-main-board"]',
        )
        ?.getBoundingClientRect(),
    [],
  );
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null),
    bodyRef = useRef<HTMLDivElement>(null),
    emptyRef = useRef<HTMLDivElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false),
    [selection, setSelection] = useState<AppearanceSelection>(),
    [capturing, setCapturing] = useState(false);
  const captureFor = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState<{
      id: string;
      selection: AppearanceSelection;
      error: string;
    }>(),
    [missed, setMissed] = useState<string>(),
    [locateTarget, setLocateTarget] = useState<{
      id: string;
      target?: string;
    }>();
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedFunctions, setSelectedFunctions] = useState<
    Record<string, string[]>
  >({});
  const flows = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(question.explanations ?? {}).map(([id, e]) => [
          id,
          explanationFlow(id, e, question),
        ]),
      ),
    [question],
  );
  const graphViews = useMemo(
    () => [
      {
        id: "logic",
        label: question.graphViews?.length ? "总链路" : "逻辑关系",
        graph: question.graph,
        readingGuide: question.readingGuide,
        readingSections: question.readingSections,
      },
      ...(question.graphViews ?? []),
      ...(question.dependencyGraph
        ? [
            {
              id: "dependencies",
              label: "文件引用",
              graph: question.dependencyGraph,
              readingGuide: undefined,
              readingSections: undefined,
            },
          ]
        : []),
    ],
    [question],
  );
  const [graphKind, setGraphKind] = useState("logic");
  const graphView =
    graphViews.find((view) => view.id === graphKind) ?? graphViews[0];
  const graph = graphView.graph;
  const readingGuide = graphView.readingGuide ?? question.readingGuide;
  const readingSections = graphView.readingSections ?? question.readingSections;
  const nodeBadges = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(question.explanations ?? {}).map(([id, explanation]) => [
          id,
          [layerLabels[explanation.layer], ...(explanation.serviceTags ?? [])],
        ]),
      ),
    [question],
  );
  const orderedExplanations: [string, ResearchExplanation][] = [];
  const legacyCodes = new Set<string>();
  for (const id of graphReadingOrder(graph)) {
    if (question.explanations?.[id])
      orderedExplanations.push([id, question.explanations[id]]);
    else if (!question.explanations) {
      const code = question.codes.find(
        (item) => item.id === question.nodeCode?.[id],
      );
      const node = graph.nodes.find((item) => item.id === id);
      if (
        code &&
        node &&
        (!selectedNodes.includes(id) || !legacyCodes.has(code.id))
      ) {
        if (selectedNodes.includes(id)) legacyCodes.add(code.id);
        orderedExplanations.push([
          id,
          {
            title: node.label,
            layer: "contract",
            inputs: ["旧资料未标注入参"],
            outputs: ["旧资料未标注出参"],
            summary: node.description?.join(" ") ?? node.label,
            codeIds: [code.id],
          },
        ]);
      }
    }
  }
  const selectionKey = selectedNodes.join("|");
  const functionSelectionKey = JSON.stringify(selectedFunctions);
  const navigate = (nextPage: string, nextQuestion?: string) => {
    const p = data.pages.find((item) => item.id === nextPage)!;
    setPageId(p.id);
    setSelectedFunctions({});
    setQuestionId(nextQuestion ?? p.questions[0].id);
    setSelectedNodes([]);
    setLocateTarget(undefined);
    setGraphKind("logic");
  };
  const requestCapture = (id?: string) => {
    captureFor.current = id;
    setCapturing(true);
    window.dispatchEvent(new Event(REQUEST_CAPTURE_EVENT));
  };
  const attach = async (id: string, value: AppearanceSelection) => {
    try {
      await david.addFeedbackSelection(id, value);
      setPending(undefined);
    } catch (error) {
      setPending({ id, selection: value, error: String(error) });
    }
  };
  const locate = (entry: DavidFeedbackEntry, chosen?: AppearanceSelection) => {
    const value = chosen ?? feedbackSelections(entry.scope)[0],
      p = data.pages.find(
        (item) => item.id === (value?.scene.pageId ?? entry.scope?.pageId),
      );
    if (!p) {
      setMissed(entry.id);
      return;
    }
    const component = value?.scene.componentId ?? entry.scope?.nodePath?.[0],
      q =
        p.questions.find(
          (item) =>
            item.id === component || item.aliases?.includes(component ?? ""),
        ) ?? p.questions[0];
    navigate(p.id, q.id);
    setMissed(undefined);
    const rawTargets = value?.targets.map((item) => item.targetId) ?? [];
    if (entry.scope?.targetId) rawTargets.push(entry.scope.targetId);
    const targets = rawTargets
      .map((id) => q.targetAliases?.[id] ?? id)
      .map((id) => id.startsWith("explanation:") ? "code:" + id.slice(12) : id.startsWith("summary:") ? "node:" + id.slice(8) : id)
      .map((id) => {
        const fn = id.startsWith("logic:") ? id.slice(6) : undefined;
        return fn &&
          Object.values(q.explanations ?? {}).some((e) =>
            e.functionGraph?.nodes.some((n) => n.id === fn),
          )
          ? "code:" + fn
          : id;
      });
    for (const [nodeId, e] of Object.entries(q.explanations ?? {})) {
      const ids =
        explanationFlow(nodeId, e, q)
          ?.graph.nodes.filter(
            (n) =>
              targets.includes("code:" + n.id) ||
              targets.includes("logic:" + n.id),
          )
          .map((n) => n.id) ?? [];
      if (ids.length)
        setSelectedFunctions((current) => ({ ...current, [nodeId]: ids }));
    }
    const nodeIds = new Set(
      graphViews.flatMap((view) => view.graph.nodes.map((node) => node.id)),
    );
    const owners = (target: string) => {
      if (target.startsWith("mock:") || target.startsWith("sources:"))
        return Object.keys(q.explanations ?? {}).filter(id =>
          target.startsWith(`mock:${id}:`) || target.startsWith(`sources:${id}:`));
      if (target.startsWith("lineage:"))
        return nodeIds.has(target.slice(8)) ? [target.slice(8)] : [];
      if (target.startsWith("functions:"))
        return nodeIds.has(target.slice(10)) ? [target.slice(10)] : [];
      if (target.startsWith("contract:")) {
        const id = target.slice(9).replace(/:(?:inputs|outputs)$/, "");
        return nodeIds.has(id) ? [id] : [];
      }
      if (target.startsWith("code:")) {
        const id = target.slice(5);
        if (q.explanations)
          return Object.entries(q.explanations)
            .filter(([, value]) =>
              [...value.codeIds, ...(value.definitionIds ?? [])].includes(id),
            )
            .map(([node]) => node);
        return Object.entries(q.nodeCode ?? {})
          .filter(([, code]) => code === id)
          .map(([node]) => node);
      }
      const id = target.replace(/^(?:logic|node):/, "");
      if (nodeIds.has(id)) return [id];
      return Object.entries(q.explanations ?? {})
        .filter(([node, e]) =>
          explanationFlow(node, e, q)?.graph.nodes.some((n) => n.id === id),
        )
        .map(([node]) => node);
    };
    const selected = [...new Set(targets.flatMap(owners))];
    setSelectedNodes(selected);
    if (selected.length) {
      const selectedView = graphViews.find((view) =>
        view.graph.nodes.some((node) => selected.includes(node.id)),
      );
      if (selectedView) setGraphKind(selectedView.id);
    }
    const readingTarget = targets.find((id) => id.startsWith(`reading:${q.id}:`));
    if (readingTarget) {
      const suffix = readingTarget.slice(`reading:${q.id}:`.length);
      setGraphKind(q.graphViews?.find((view) => suffix.startsWith(view.id + ":"))?.id ?? "logic");
      setGraphCollapsed(false);
    }
    const target =
      targets.find(
        (id) => /^(?:code|contract):/.test(id) && owners(id).length,
      ) ??
      targets.find((id) => owners(id).length) ??
      readingTarget ?? targets[0];
    if (target?.startsWith("logic:") || target === "surface:page")
      setGraphCollapsed(false);
    setLocateTarget({ id: entry.id, target });
  };
  useEffect(() => {
    window.scrollTo({ top: 0 });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [pageId, question.id]);
  useEffect(() => {
    if (bodyRef.current) prepareReviewTargets(bodyRef.current);
    if (graphRef.current) prepareReviewTargets(graphRef.current);
  }, [pageId, question.id, graphKind, selectionKey, functionSelectionKey]);
  useEffect(() => {
    if (!locateTarget) return;
    const node = locateTarget.target
      ? document.querySelector<HTMLElement>(
          `[data-review-target="${CSS.escape(locateTarget.target)}"]`,
        )
      : null;
    if (!node) {
      setMissed(locateTarget.id);
      return;
    }
    const details = node.closest("details");
    if (details) details.open = true;
    let cancelled = false;
    const pendingAnimations: Animation[] = [];
    for (
      let ancestor: HTMLElement | null = node;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.classList.contains("research-reveal"))
        pendingAnimations.push(
          ...ancestor.getAnimations().filter((a) => a.playState !== "finished"),
        );
    }
    const scroll = () => {
      if (!cancelled && node.isConnected)
        node.scrollIntoView({ block: "center" });
    };
    if (pendingAnimations.length)
      void Promise.all(
        pendingAnimations.map((a) => a.finished.catch(() => {})),
      ).then(scroll);
    else scroll();
    node.classList.add("research-located");
    const timer = setTimeout(
      () => node.classList.remove("research-located"),
      1500,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      node.classList.remove("research-located");
    };
  }, [
    locateTarget,
    pageId,
    question.id,
    graphKind,
    selectionKey,
    graphCollapsed,
  ]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"],.comment-rail',
          )) ||
        capturing ||
        feedbackOpen ||
        document.body.classList.contains("david-gc-mode")
      )
        return;
      const index = data.pages.findIndex((item) => item.id === pageId);
      if (event.key === "ArrowRight" && index < data.pages.length - 1) {
        event.preventDefault();
        const next = data.pages[index + 1];
        setPageId(next.id);
        setQuestionId(next.questions[0].id);
        setSelectedNodes([]);
        setLocateTarget(undefined);
        setGraphKind("logic");
      }
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        const next = data.pages[index - 1];
        setPageId(next.id);
        setQuestionId(next.questions[0].id);
        setSelectedNodes([]);
        setLocateTarget(undefined);
        setGraphKind("logic");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [data.pages, pageId, capturing, feedbackOpen]);
  const codeSections = (ids: string[], availableIds = ids) => (
    <div className="research-code-group" data-code-count={ids.length}>
      {availableIds
        .map((id) => question.codes.find((code) => code.id === id)!)
        .map((code) => (
          <Reveal key={code.id} open={ids.includes(code.id)}>
            <section
              className="research-code"
              id={"research-code-" + code.id}
              data-review-target={`code:${code.id}`}
              data-review-label={code.title}
            >
              <h4>{code.title}</h4>
              {!!code.explanation?.length && (
                <div className="research-code-explanation" data-code-explanation={code.id}
                  data-review-target={`explanation:${code.id}`} data-review-label={`${code.title} · 节点说明`}>
                  {code.explanation.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                </div>
              )}
              {code.source && (
                <p className="research-code-source">{code.source}</p>
              )}
              <CodeBlock
                code={code.code}
                codeLabel={code.language}
                annotations={code.annotations}
                highlights={question.highlights}
                symbols={question.symbols}
                lineNumbers={code.lineNumbers}
                definitions={code.definitions}
              />
              {Object.values(question.explanations ?? {})
                .flatMap(resourcesFor)
                .filter((resource) => resource.afterCodeId === code.id)
                .map((resource, i) => (
                  <SourceResource key={resource.id ?? i} resource={resource} />
                ))}
            </section>
          </Reveal>
        ))}
    </div>
  );
  const graphToggle = (
    <IconButton
      label={graphCollapsed ? "展开主逻辑画板" : "向左收起主逻辑画板"}
      expanded={!graphCollapsed}
      controls="research-main-board"
      onClick={() => {
        setLocateTarget(undefined);
        setGraphCollapsed((value) => !value);
        requestAnimationFrame(() =>
          leftRef.current
            ?.querySelector<HTMLButtonElement>(
              'button[aria-controls="research-main-board"]',
            )
            ?.focus({ preventScroll: true }),
        );
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d={graphCollapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </IconButton>
  );
  return (
    <main
      className="app research-workbench"
      data-page-id={page.id}
      data-question-id={question.id}
    >
      <script
        id="david-agent-feedback"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(doc).replaceAll("<", "\\u003c"),
        }}
      />
      <header className="research-header">
        <h1>{data.title}</h1>
      </header>
      {david.sync === "offline" && (
        <p role="alert">
          本机评论服务暂不可用。<button onClick={david.reload}>重试连接</button>
        </p>
      )}
      {david.error && <p role="alert">{david.error.message}</p>}
      <nav className="research-pages" aria-label="研究页面">
        <Toolbar>
          {data.pages.map((item, index) => (
            <IconButton
              key={item.id}
              label={item.label}
              pressed={item.id === page.id}
              onClick={() => navigate(item.id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item.label}
            </IconButton>
          ))}
        </Toolbar>
      </nav>
      <div className="research-content">
        <div
          className={`research-layout${graphCollapsed ? " is-graph-collapsed" : ""}`}
        >
          <aside className="research-left" ref={leftRef}>
            {graphCollapsed && (
              <div className="research-board-toggle">{graphToggle}</div>
            )}
            <div
              id="research-main-board"
              hidden={graphCollapsed}
              inert={graphCollapsed ? true : undefined}
            >
              {page.questions.length > 1 && (
                <nav aria-label="调研问题" className="research-questions">
                  <Toolbar>
                    {page.questions.map((item) => (
                      <IconButton
                        key={item.id}
                        label={item.title}
                        pressed={item.id === question.id}
                        onClick={() => {
                          setQuestionId(item.id);
                          setSelectedNodes([]);
                          setLocateTarget(undefined);
                          setGraphKind("logic");
                        }}
                      >
                        {item.title}
                      </IconButton>
                    ))}
                  </Toolbar>
                </nav>
              )}
              <div
                ref={graphRef}
                className="research-graphs"
                data-surface="page"
                data-component-id={question.id}
                data-review-label={question.title}
              >
                <div className="research-graph-title">
                  {graphViews.length > 1 ? (
                    <nav aria-label="画板视图">
                      <Toolbar>
                        {graphViews.map((view) => (
                          <IconButton
                            key={view.id}
                            label={view.label}
                            pressed={graphKind === view.id}
                            onClick={() => {
                              setGraphKind(view.id);
                              setSelectedNodes([]);
                              setLocateTarget(undefined);
                            }}
                          >
                            {view.label}
                          </IconButton>
                        ))}
                      </Toolbar>
                    </nav>
                  ) : (
                    <span className="research-graph-caption">逻辑关系</span>
                  )}
                  {!graphCollapsed && (
                    <div className="research-board-toggle">{graphToggle}</div>
                  )}
                </div>
                <LogicCanvas
                  key={question.id + ":" + graphKind}
                  graph={graph}
                  label={question.title + " · " + graphView.label}
                  nodeBadges={nodeBadges}
                  selectedNodeIds={selectedNodes}
                  onSelectNode={(id) => {
                    const opening = !selectedNodes.includes(id);
                    setLocateTarget(opening && question.explanations?.[id]
                      ? { id: `select-${id}`, target: question.explanations[id].cases?.length
                        ? `mock:${id}:output-example` : `summary:${id}` }
                      : undefined);
                    setSelectedNodes((current) =>
                      current.includes(id)
                        ? current.filter((node) => node !== id)
                        : [...current, id],
                    );
                  }}
                />
              </div>
            </div>
          </aside>
          <div
            ref={bodyRef}
            className="research-answer"
            data-surface="overview"
            data-component-id={question.id}
            data-review-target={`question:${question.id}`}
            data-review-label={question.title}
          >
            <h2>{question.title}</h2>
            <p className="research-conclusion">{question.answer}</p>
            {(!!readingSections?.length || !!readingGuide?.length) && (
              <section className="research-reading-guide" aria-label="链路说明"
                data-reading-view={graphView.id}>
                {readingSections?.length ? <RichDocument sections={readingSections}
                  targetPrefix={graphView.id === "logic" ? `reading:${question.id}` : `reading:${question.id}:${graphView.id}`} /> : readingGuide?.map((text, index) => (
                  <p key={index}
                    data-review-target={graphView.id === "logic" ? `reading:${question.id}:${index}` : `reading:${question.id}:${graphView.id}:${index}`}
                    data-review-label={text.slice(0, 150)}>{text}</p>
                ))}
              </section>
            )}
            {orderedExplanations.map(([nodeId, explanation]) => (
              <Reveal
                key={question.id + ":" + nodeId}
                open={selectedNodes.includes(nodeId)}
              >
                <article
                  className="research-explanation"
                  data-node-explanation={nodeId}
                  data-review-target={`node:${nodeId}`}
                  data-review-label={explanation.title}
                >
                  <header>
                    <h3>{explanation.title}</h3>
                  </header>
                  <p className="research-node-summary" data-review-target={`summary:${nodeId}`}
                    data-review-label={`${explanation.title} · 作用说明`}>{explanation.summary}</p>
                  {resourcesFor(explanation)
                    .filter((resource) => !resource.afterCodeId)
                    .map((resource, i) => (
                      <SourceResource
                        key={resource.id ?? i}
                        resource={resource}
                      />
                    ))}
                  <dl
                    className={`research-io${explanation.contracts ? " has-contracts" : ""}`}
                  >
                    {(["inputs", "outputs"] as const).map((direction) => {
                      const contract = explanation.contracts?.[direction];
                      return (
                        <div
                          key={direction}
                          data-review-target={`contract:${nodeId}:${direction}`}
                          data-review-label={`${explanation.title} · ${direction === "inputs" ? "入参" : "出参"}`}
                        >
                          <dt>{direction === "inputs" ? "入参" : "出参"}</dt>
                          <dd>
                            {direction === "inputs" && explanation.inputSources && <RichDocument
                              sections={explanation.inputSources} targetPrefix={`sources:${nodeId}`} />}
                            {direction === "outputs" && explanation.cases && (
                              <MockCases id={`${nodeId}:output-example`} cases={explanation.cases} />
                            )}
                            {contract ? (
                              <CodeBlock
                                code={contract.code}
                                codeLabel={contract.language}
                                annotations={contract.annotations}
                                highlights={question.highlights}
                                symbols={question.symbols}
                                lineNumbers={contract.lineNumbers}
                                definitions={contract.definitions}
                              />
                            ) : (
                              <ul>
                                {explanation[direction].map((value) => (
                                  <li key={value}>{value}</li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  {!!explanation.definitionIds?.length && (
                    <section
                      className="research-definitions"
                      aria-label="复杂类型定义"
                    >
                      <h4>复杂类型定义</h4>
                      {codeSections(explanation.definitionIds)}
                    </section>
                  )}
                  {!!explanation.findings?.length && (
                    <ul className="research-findings">
                      {explanation.findings.map((value) => (
                        <li key={value}>{value}</li>
                      ))}
                    </ul>
                  )}
                  {flows[nodeId] ? (
                    <section
                      className="research-function-flow"
                      data-function-flow={nodeId}
                      data-review-target={`functions:${nodeId}`}
                      data-review-label="函数、文件与数据转换"
                    >
                      <h4>函数、文件与数据转换</h4>
                      <p className="research-flow-legend">
                        箭头表示代码执行顺序；字段传递、调用关系和依赖只作为边标签说明。
                      </p>
                      <div
                        data-review-target={`lineage:${nodeId}`}
                        data-review-label="字段来源与转换"
                      >
                        <FoldableLogicCanvas
                          compactAvoid={compactGraphObstacle}
                          active={selectedNodes.includes(nodeId)}
                          graph={flows[nodeId]!.graph}
                          nodeBadges={flows[nodeId]!.badges}
                          label="函数、文件与数据转换"
                          selectedNodeIds={
                            selectedFunctions[nodeId] ?? flows[nodeId]!.initial
                          }
                          onSelectNode={(id) => {
                            const direction = flows[nodeId]!.contractDirections[id];
                            setLocateTarget(direction
                              ? { id: `contract-${nodeId}-${direction}`, target: direction === "outputs" && explanation.cases?.length
                                ? `mock:${nodeId}:output-example` : `contract:${nodeId}:${direction}` }
                              : undefined);
                            setSelectedFunctions((current) => {
                              const ids = (current[nodeId] ?? flows[nodeId]!.initial)
                                .filter((selected) => Boolean(flows[nodeId]!.contractDirections[selected]) === Boolean(direction));
                              return {
                                ...current,
                                [nodeId]: ids.includes(id)
                                  ? ids.filter((v) => v !== id)
                                  : [...ids, id],
                              };
                            });
                          }}
                        />
                      </div>
                      {codeSections(
                        selectedFlowCodes(
                          flows[nodeId]!,
                          selectedFunctions[nodeId] ?? flows[nodeId]!.initial,
                          explanation,
                        ),
                        flows[nodeId]!.codeOrder,
                      )}
                    </section>
                  ) : (
                    codeSections(explanation.codeIds)
                  )}
                  {!explanation.cases && (
                    <MockCases id={nodeId} cases={explanation.cases} />
                  )}
                  {!!explanation.evidence?.length && (
                    <details className="research-evidence">
                      <summary>来源与边界</summary>
                      <ul>
                        {explanation.evidence.map((item) => (
                          <li key={item.href}>
                            <a
                              href={item.href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {item.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              </Reveal>
            ))}
            <ul className="research-findings">
              {question.findings.map((item, index) => (
                <li
                  key={index}
                  data-review-target={`finding:${question.id}:${index}`}
                  data-review-label={item.slice(0, 150)}
                >
                  {item}
                </li>
              ))}
            </ul>
            <MockCases
              key={question.id}
              id={question.id}
              cases={question.cases}
            />
            {!!question.details?.length && (
              <details
                key={"details-" + question.id}
                className="research-detail-notes"
              >
                <summary>补充说明与边界</summary>
                <ul>
                  {question.details.map((text, index) => (
                    <li
                      key={index}
                      data-review-target={`detail:${question.id}:${index}`}
                    >
                      {text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {question.evidence.length > 0 && (
              <details className="research-evidence">
                <summary>来源与可下载文件 · {question.evidence.length}</summary>
                <ul>
                  {question.evidence.map((item) => (
                    <li key={item.href}>
                      <a href={item.href} target="_blank" rel="noreferrer">
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>
      <CommentRail
        processingTasks={david.feedbackTasks}
        processingBatch={david.feedbackBatch}
        supportsProcessingStatus={david.supportsFeedbackTasks}
        entries={doc.entries}
        loading={david.sync === "checking"}
        currentPageId={page.id}
        activeComponentId={question.id}
        onLocate={locate}
        onLocateSelection={(entry, index) =>
          locate(entry, feedbackSelections(entry.scope)[index])
        }
        onAddSelection={
          david.supportsMultiSelection ? requestCapture : undefined
        }
        onReply={async (id, body) => {
          await david.replyToFeedback(id, body);
        }}
        onStatusChange={david.setFeedbackStatus}
        onEdit={david.editFeedbackSuggestion}
        onDecision={david.setFeedbackDecision}
        onDelete={
          david.supportsFeedbackDeletion ? david.deleteFeedbackEntry : undefined
        }
        onRemoveSelection={
          david.supportsFeedbackDeletion
            ? (entry, index) =>
                david.removeFeedbackSelection(
                  entry.id,
                  feedbackSelections(entry.scope)[index],
                )
            : undefined
        }
        locateMissedEntryId={missed}
      />
      <GlobalRegionSelection
        surfaces={{
          page: graphRef,
          overview: bodyRef,
          inspector: emptyRef,
          dock: emptyRef,
        }}
        scene={{ pageId: page.id, componentId: question.id }}
        onCancel={() => {
          setCapturing(false);
          captureFor.current = undefined;
        }}
        onAppearance={(value) => {
          setCapturing(false);
          const id = captureFor.current;
          captureFor.current = undefined;
          if (id) void attach(id, value);
          else {
            setSelection(value);
            setFeedbackOpen(true);
          }
        }}
      />
      {feedbackOpen && (
        <DavidFeedbackPanel
          compact
          doc={doc}
          pageId={page.id}
          nodePath={[question.id]}
          selection={selection}
          onAddSelection={() => requestCapture()}
          suspended={capturing}
          onChange={david.updateFeedback}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
      {pending && (
        <div className="research-pending" role="alert">
          选区尚未保存：{pending.error}
          <button onClick={() => void attach(pending.id, pending.selection)}>
            重试保存选区
          </button>
          <button onClick={() => setPending(undefined)}>取消</button>
        </div>
      )}
    </main>
  );
}
