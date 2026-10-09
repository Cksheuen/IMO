import { findMappingTargets } from "../../lib/mappingHighlight";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewData } from "../../types/review";
import { resolveOverview, resolveLayerMapping } from "../../lib/reviewTree";
import { type OverviewColumn } from "../../lib/richContent";
import { hasOverviewApiSummary } from "../../lib/disclosureContent";
import { DisclosureCell } from "./DisclosureCell";
import { useOverviewAlignment } from "../../hooks/useOverviewAlignment";
import "../../styles/overview-linking.css";

type Props = {
  review: ReviewData;
  onComponentSelect: (id: string) => void;
  /**
   * 同伴 keep-alive：false 时总览内容仍挂载、布局不变，
   * 但停用 hover/focus 联动并清掉自身链接高亮。
   */
  active?: boolean;
};

const OVERVIEW_COLUMNS: Array<{ column: OverviewColumn; label: string }> = [
  { column: "requirement", label: "需求" },
  { column: "change", label: "改动" },
  { column: "api", label: "API 摘要" },
];

export function OverviewDetails({
  review,
  onComponentSelect,
  active = true,
}: Props) {
  const overview = resolveOverview(review);
  const hostRef = useRef<HTMLElement | null>(null);
  useOverviewAlignment(hostRef, active, review);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverToken, setHoverToken] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState<string | null>(null);
  const [prevActive, setPrevActive] = useState(active);

  // active 切换时清掉自身链接状态（render 阶段派生，避免 effect 内
  // setState 触发级联渲染）；不卸载内容、不改布局。
  if (prevActive !== active) {
    setPrevActive(active);
    setHoverId(null);
    setFocusId(null);
    setHoverToken(null);
    setFocusToken(null);
  }

  type Component = (typeof review.components)[number];
  type MappingRow = Component["mapping"][number];

  const groups = useMemo(() => {
    const nextGroups: Array<{
      component: Component | null;
      rows: MappingRow[];
    }> = review.components.map((component) => ({
      component,
      rows: [],
    }));

    if (review.overview?.mapping === undefined) {
      return review.components.map((component) => ({
        component,
        rows: resolveLayerMapping(component),
      }));
    }

    const neutralRows: MappingRow[] = [];

    review.overview.mapping.forEach((row) => {
      const matchingGroupIndexes = review.components.flatMap(
        (component, componentIndex) =>
          component.mapping.some(
            (rootRow) =>
              rootRow.id === row.id ||
              `${component.id}:${rootRow.id}` === row.id,
          )
            ? [componentIndex]
            : [],
      );

      if (matchingGroupIndexes.length === 1) {
        nextGroups[matchingGroupIndexes[0]].rows.push(row);
      } else {
        neutralRows.push(row);
      }
    });

    return neutralRows.length > 0
      ? [...nextGroups, { component: null, rows: neutralRows }]
      : nextGroups;
  }, [review.components, review.overview]);

  const linkedId = active ? (hoverId ?? focusId) : null;
  // 全部行都显式声明无接口改动时，总览表切两列（不堆“无接口改动”）。
  const overviewRows = groups.flatMap((group) => group.rows);
  const showApiColumn = overviewRows.some(hasOverviewApiSummary);
  const overviewColumns = showApiColumn
    ? OVERVIEW_COLUMNS
    : OVERVIEW_COLUMNS.filter(({ column }) => column !== "api");

  useEffect(() => {
    if (!active) {
      return;
    }

    const host = hostRef.current;
    if (!host) {
      return;
    }

    const stage = host.closest(".stage");
    const pageFrame = stage?.querySelector<HTMLElement>(".page-frame");
    const knownIds = new Set(
      review.components.map((component) => component.id),
    );
    const knownRowTokens = new Set(
      review.components.flatMap((component) =>
        component.mapping.map((row) => `${component.id}:${row.id}`),
      ),
    );

    const rootForTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      const root = target.closest("[data-component-id]");
      const id = root?.getAttribute("data-component-id");
      return id && knownIds.has(id) ? root : null;
    };

    const idForTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      const componentButton = target.closest(
        ".david-overview-component-button",
      );
      const buttonComponent = componentButton?.closest<HTMLElement>(
        "[data-component-id]",
      )?.dataset.componentId;
      if (buttonComponent) return buttonComponent;
      const row = target.closest("tr[data-mapping-id]");
      const rowToken = row?.getAttribute("data-mapping-id");
      if (rowToken && knownRowTokens.has(rowToken)) {
        return rowToken;
      }

      return rootForTarget(target)?.getAttribute("data-component-id") ?? null;
    };

    const linkedStateForTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      const componentButton = target.closest(
        ".david-overview-component-button",
      );
      const buttonComponent = componentButton?.closest<HTMLElement>(
        "[data-component-id]",
      )?.dataset.componentId;
      if (buttonComponent)
        return { kind: "component" as const, id: buttonComponent };
      const row = target.closest("tr[data-mapping-id]");
      const rowToken = row?.getAttribute("data-mapping-id");
      if (rowToken && knownRowTokens.has(rowToken)) {
        return { kind: "token" as const, id: rowToken };
      }

      const root = rootForTarget(target);
      const id = root?.getAttribute("data-component-id");
      return id ? { kind: "component" as const, id } : null;
    };

    const handlePointerOver = (event: Event) => {
      const state = linkedStateForTarget(event.target);
      if (state?.kind === "component") {
        setHoverId(state.id);
        setHoverToken(null);
      } else if (state?.kind === "token") {
        setHoverToken(state.id);
        setHoverId(null);
      }
    };

    const handlePointerOut = (event: PointerEvent) => {
      const state = linkedStateForTarget(event.target);
      if (!state) {
        return;
      }

      if (idForTarget(event.relatedTarget) === state.id) {
        return;
      }

      if (state.kind === "component") {
        setHoverId((currentId) => (currentId === state.id ? null : currentId));
      } else {
        setHoverToken((currentId) =>
          currentId === state.id ? null : currentId,
        );
      }
    };

    const handleFocusIn = (event: Event) => {
      const state = linkedStateForTarget(event.target);
      if (state?.kind === "component") {
        setFocusId(state.id);
        setFocusToken(null);
      } else if (state?.kind === "token") {
        setFocusToken(state.id);
        setFocusId(null);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const state = linkedStateForTarget(event.target);
      if (!state) {
        return;
      }

      if (idForTarget(event.relatedTarget) === state.id) {
        return;
      }

      if (state.kind === "component") {
        setFocusId((currentId) => (currentId === state.id ? null : currentId));
      } else {
        setFocusToken((currentId) =>
          currentId === state.id ? null : currentId,
        );
      }
    };

    host.addEventListener("pointerover", handlePointerOver);
    host.addEventListener("pointerout", handlePointerOut);
    host.addEventListener("focusin", handleFocusIn);
    host.addEventListener("focusout", handleFocusOut);
    pageFrame?.addEventListener("pointerover", handlePointerOver);
    pageFrame?.addEventListener("pointerout", handlePointerOut);
    pageFrame?.addEventListener("focusin", handleFocusIn);
    pageFrame?.addEventListener("focusout", handleFocusOut);

    return () => {
      host.removeEventListener("pointerover", handlePointerOver);
      host.removeEventListener("pointerout", handlePointerOut);
      host.removeEventListener("focusin", handleFocusIn);
      host.removeEventListener("focusout", handleFocusOut);
      pageFrame?.removeEventListener("pointerover", handlePointerOver);
      pageFrame?.removeEventListener("pointerout", handlePointerOut);
      pageFrame?.removeEventListener("focusin", handleFocusIn);
      pageFrame?.removeEventListener("focusout", handleFocusOut);
    };
  }, [review.components, active]);

  useEffect(() => {
    const host = hostRef.current;
    const stage = host?.closest(".stage");
    const pageFrame = stage?.querySelector<HTMLElement>(".page-frame");
    const linkedToken = active ? (hoverToken ?? focusToken) : null;
    const linkedRoots: Element[] = [];

    if (linkedToken) {
      linkedRoots.push(...findMappingTargets(pageFrame, linkedToken));

      if (linkedRoots.length === 0) {
        const component = review.components.find((item) =>
          item.mapping.some((row) => `${item.id}:${row.id}` === linkedToken),
        );
        if (component) {
          const componentSelector = `[data-component-id="${CSS.escape(component.id)}"]`;
          if (pageFrame) {
            linkedRoots.push(
              ...Array.from(pageFrame.querySelectorAll(componentSelector)),
            );
          }
        }
      }
    } else if (linkedId) {
      const selector = `[data-component-id="${CSS.escape(linkedId)}"]`;
      if (host) {
        linkedRoots.push(...Array.from(host.querySelectorAll(selector)));
      }
      if (pageFrame) {
        linkedRoots.push(...Array.from(pageFrame.querySelectorAll(selector)));
      }
    }

    if (linkedToken && host) {
      linkedRoots.push(
        ...host.querySelectorAll(
          `tr[data-mapping-id="${CSS.escape(linkedToken)}"]`,
        ),
      );
    }
    linkedRoots.forEach((root) => root.classList.add("david-overview-linked"));

    return () => {
      linkedRoots.forEach((root) =>
        root.classList.remove("david-overview-linked"),
      );
    };
  }, [active, hoverToken, focusToken, linkedId, review.components]);

  const hasGroups = groups.length > 0;

  return (
    <section
      ref={hostRef}
      className="david-overview"
      data-testid="david-overview"
    >
      <header className="david-overview-header">
        {overview.title ? (
          <h2 className="david-overview-title">{overview.title}</h2>
        ) : null}
        {overview.summary ? (
          <p className="david-overview-summary">{overview.summary}</p>
        ) : null}
      </header>

      {hasGroups ? (
        <table className="david-overview-mapping">
          <colgroup>
            <col />
            <col />
            <col />
            {showApiColumn && <col />}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">组件</th>
              <th scope="col">需求</th>
              <th scope="col">改动</th>
              {showApiColumn && <th scope="col">API 摘要</th>}
            </tr>
          </thead>
          {groups.map((group) => {
            const component = group.component;

            return (
              <tbody
                key={component?.id ?? "david-overview-neutral"}
                data-component-id={component?.id}
              >
                {group.rows.length === 0 ? (
                  <tr>
                    <th
                      scope="rowgroup"
                      className="david-overview-component-cell"
                    >
                      <button
                        type="button"
                        className="david-overview-component-button"
                        data-testid={`overview-component-${group.component?.id}`}
                        aria-label={`查看组件 ${group.component?.label} 的评审详情`}
                        onClick={() =>
                          component && onComponentSelect(component.id)
                        }
                      >
                        <span className="overview-component-label">
                          {component?.label}
                        </span>
                        {component?.source?.kind === "component" ? (
                          <span
                            className="overview-component-kind"
                            title="基于项目现有组件复用"
                          >
                            复用组件
                          </span>
                        ) : null}
                        {component?.kindLabel ? (
                          <span className="overview-component-kind">
                            {component.kindLabel}
                          </span>
                        ) : null}
                        <span className="overview-component-mapping-count">
                          {component?.mapping.length ?? 0} 条映射
                        </span>
                      </button>
                    </th>
                    <td
                      colSpan={showApiColumn ? 3 : 2}
                      className="david-overview-empty"
                    >
                      暂无映射说明
                    </td>
                  </tr>
                ) : (
                  group.rows.map((row, rowIndex) => (
                    <tr
                      key={row.id}
                      data-mapping-id={
                        component ? `${component.id}:${row.id}` : undefined
                      }
                    >
                      {rowIndex === 0 ? (
                        <th
                          scope="rowgroup"
                          rowSpan={group.rows.length}
                          className={
                            component
                              ? "david-overview-component-cell"
                              : "david-overview-neutral-cell"
                          }
                        >
                          {component ? (
                            <button
                              type="button"
                              className="david-overview-component-button"
                              data-testid={`overview-component-${component.id}`}
                              aria-label={`查看组件 ${component.label} 的评审详情`}
                              onClick={() => onComponentSelect(component.id)}
                            >
                              <span className="overview-component-label">
                                {component.label}
                              </span>
                              {component.source?.kind === "component" ? (
                                <span
                                  className="overview-component-kind"
                                  title="基于项目现有组件复用"
                                >
                                  复用组件
                                </span>
                              ) : null}
                              {component.kindLabel ? (
                                <span className="overview-component-kind">
                                  {component.kindLabel}
                                </span>
                              ) : null}
                              <span className="overview-component-mapping-count">
                                {group.rows.length} 个功能
                              </span>
                            </button>
                          ) : (
                            <span className="david-overview-neutral-title">
                              整体说明
                            </span>
                          )}
                        </th>
                      ) : null}
                      {overviewColumns.map(({ column, label }) => (
                        <td
                          key={column}
                          data-review-target={`overview:${component?.id ?? "general"}:${row.id}:${column}`}
                          data-review-label={`${component?.label ?? "整体说明"} · ${label}`}
                        >
                          <DisclosureCell
                            row={row}
                            column={column}
                            level="overview"
                            componentId={component?.id}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            );
          })}
        </table>
      ) : null}
    </section>
  );
}
