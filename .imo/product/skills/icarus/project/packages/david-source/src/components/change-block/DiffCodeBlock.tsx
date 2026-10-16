import { useId, useMemo, useState } from "react";
import { CodeBlock } from "../CodeBlock";
import { IconButton } from "../ui/IconButton";
import { ChevronIcon } from "../ui/ChevronIcon";
import type { ChangeKind, ChangeSide } from "../../types/review";
import { alignDiffLines } from "../../lib/lineDiff";
import "./DiffCodeBlock.css";

export function DiffCodeBlock({
  kind,
  before,
  after,
}: {
  kind: ChangeKind;
  before?: ChangeSide;
  after?: ChangeSide;
}) {
  const [collapsed, setCollapsed] = useState<"before" | "after" | null>(null);
  const id = useId();
  const rows = useMemo(
    () =>
      alignDiffLines(before?.code ?? before?.text, after?.code ?? after?.text),
    [before?.code, before?.text, after?.code, after?.text],
  );
  return (
    <div
      className="dv-diff"
      data-collapsed={collapsed ?? "none"}
      data-dv-diff-kind={kind}
      onScrollCapture={(event) => {
        const source = event.target as HTMLElement;
        if (!source.classList.contains("trd-cb-body")) return;
        event.currentTarget
          .querySelectorAll<HTMLElement>(".trd-cb-body")
          .forEach((peer) => {
            if (peer !== source && peer.scrollTop !== source.scrollTop)
              peer.scrollTop = source.scrollTop;
          });
      }}
    >
      {(["before", "after"] as const).map((role, index) => {
        const side = role === "before" ? before : after;
        const isCollapsed = collapsed === role;
        const title =
          kind === "migrate"
            ? index === 0
              ? "迁移来源"
              : "迁移后"
            : index === 0
              ? "改动前"
              : "改动后";
        const contentId = `${id}-${role}`;
        return (
          <div
            key={role}
            className={`dv-diff-pane dv-diff-pane-${role}${side ? "" : " dv-diff-pane-missing"}`}
            data-dv-diff-role={role}
            data-dv-diff-kind={kind}
            data-collapsed={isCollapsed}
          >
            <div className="dv-diff-pane-bar">
              <span className="dv-diff-pane-title">{title}</span>
              <span className="dv-diff-pane-lang">
                {side
                  ? (side.lang ?? "文本")
                  : index === 0
                    ? "新增内容"
                    : "删除内容"}
              </span>
              <IconButton
                label={`${isCollapsed ? "展开" : "收起"}${title}`}
                expanded={!isCollapsed}
                controls={contentId}
                onClick={() =>
                  setCollapsed((current) => (current === role ? null : role))
                }
              >
                <ChevronIcon />
              </IconButton>
            </div>
            <div
              id={contentId}
              className={`dv-diff-pane-content ${side?.code !== undefined ? "dv-diff-code" : "dv-diff-text"}`}
              inert={isCollapsed}
              aria-hidden={isCollapsed}
            >
              <CodeBlock
                code={side?.code ?? side?.text ?? ""}
                codeLabel={side?.lang ?? (side ? "文本" : "空行对应另一侧改动")}
                annotations={side?.codeAnnotations}
                alignedLines={rows.map((row) => row[role])}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
