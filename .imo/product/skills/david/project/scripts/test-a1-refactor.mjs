#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * A1 refactor regression (SSR only):
 * - richContent barrel keeps every pre-split export signature;
 * - contract-1 renderChangeBlock: add/modify/remove side filtering and
 *   wiring through MappingRow.changeBlock / TechPoint.changeBlock;
 * - ui primitives (Chip/Toolbar/Disclosure/Modal closed state) render their
 *   dv-ui- classes;
 * - CommentRail thin entry still renders the rail and returns null on empty.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";

const server = await createSsrTestServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const rich = await server.ssrLoadModule("/src/lib/richContent/index.ts");

  // 1) Barrel export surface: every symbol consumed before the split.
  const requiredExports = [
    "renderRichText",
    "renderContractCodeBlock",
    "rowApiChanged",
    "columnContent",
    "renderBriefChips",
    "renderCodePaths",
    "renderProductSections",
    "renderPoints",
    "renderBullets",
    "renderPseudoCode",
    "groupTechPoints",
    "renderTechGroups",
    "renderApiFieldButton",
    "renderApiFieldStatic",
    "renderApiItems",
    "collectApiFields",
    "renderCrossSection",
    "renderDeepDive",
    "renderChangeBlock",
    "renderOverviewCell",
    "renderRowExtras",
  ];
  for (const name of requiredExports) {
    assert.equal(typeof rich[name], "function", `missing export: ${name}`);
  }
  assert.ok(rich.CHANGE_INFO && rich.CHANGE_INFO.new, "CHANGE_INFO map kept");

  // 2) renderChangeBlock side semantics.
  const beforeOnly = { lang: "ts", code: "const BEFORE = 1;" };
  const afterOnly = { lang: "ts", code: "const AFTER = 2;" };

  const addHtml = renderToStaticMarkup(
    rich.renderChangeBlock({
      kind: "add",
      rationale: "why add",
      before: beforeOnly,
      after: afterOnly,
    }),
  );
  assert.ok(addHtml.includes("why add"), "add keeps rationale");
  assert.ok(addHtml.includes("const AFTER = 2;"), "add renders after");
  assert.ok(!addHtml.includes("const BEFORE = 1;"), "add hides before side");
  assert.match(addHtml, /data-change-kind="add"/);

  const removeHtml = renderToStaticMarkup(
    rich.renderChangeBlock({
      kind: "remove",
      rationale: "why remove",
      before: beforeOnly,
      after: afterOnly,
    }),
  );
  assert.ok(removeHtml.includes("const BEFORE = 1;"), "remove renders before");
  assert.ok(
    !removeHtml.includes("const AFTER = 2;"),
    "remove hides after side",
  );

  const modifyHtml = renderToStaticMarkup(
    rich.renderChangeBlock({
      kind: "modify",
      rationale: "why modify",
      before: beforeOnly,
      after: afterOnly,
    }),
  );
  assert.ok(modifyHtml.includes("const BEFORE = 1;"), "modify renders before");
  assert.ok(modifyHtml.includes("const AFTER = 2;"), "modify renders after");

  assert.equal(renderToStaticMarkup(rich.renderChangeBlock(undefined)), "");

  // 3a) Wiring: MappingRow.changeBlock renders inside the change column.
  const rowWithChange = {
    id: "r-change",
    requirement: "req",
    change: "chg",
    api: { summary: "api" },
    changeBlock: {
      kind: "add",
      rationale: "row rationale",
      after: { code: "const ROW_AFTER = 1;" },
    },
  };
  const changeCell = renderToStaticMarkup(
    rich.renderOverviewCell(rowWithChange, "change"),
  );
  assert.ok(changeCell.includes("row rationale"), "row changeBlock wired");
  assert.ok(changeCell.includes("const ROW_AFTER = 1;"));
  const requirementCell = renderToStaticMarkup(
    rich.renderOverviewCell(rowWithChange, "requirement"),
  );
  assert.ok(
    !requirementCell.includes("row rationale"),
    "changeBlock must not leak into requirement column",
  );

  // 3b) Wiring: TechPoint.changeBlock renders inside technical tech groups.
  const rowWithTechPoint = {
    id: "r-tp",
    requirement: "req",
    change: "chg",
    api: { summary: "api" },
    trd: {
      technical: {
        techPoints: [
          {
            title: "tp title",
            changeBlock: {
              kind: "modify",
              rationale: "tp rationale",
              before: { code: "TP_BEFORE" },
              after: { code: "TP_AFTER" },
            },
          },
        ],
      },
    },
  };
  const techCell = renderToStaticMarkup(
    rich.renderOverviewCell(rowWithTechPoint, "change"),
  );
  assert.ok(techCell.includes("tp rationale"), "techPoint changeBlock wired");
  assert.ok(techCell.includes("TP_BEFORE") && techCell.includes("TP_AFTER"));

  // 4) UI primitives.
  const { Chip } = await server.ssrLoadModule("/src/components/ui/Chip.tsx");
  const chipHtml = renderToStaticMarkup(
    createElement(Chip, { tone: "accent" }, "新增"),
  );
  assert.ok(chipHtml.includes("dv-ui-chip dv-ui-chip--accent"));

  const { Toolbar, ToolbarGroup } = await server.ssrLoadModule(
    "/src/components/ui/Toolbar.tsx",
  );
  const toolbarHtml = renderToStaticMarkup(
    createElement(
      Toolbar,
      null,
      createElement(ToolbarGroup, { key: "g" }, "x"),
    ),
  );
  assert.ok(toolbarHtml.includes("dv-ui-toolbar"));
  assert.ok(toolbarHtml.includes("dv-ui-toolbar-group"));

  const { Disclosure } = await server.ssrLoadModule(
    "/src/components/ui/Disclosure.tsx",
  );
  const disclosureHtml = renderToStaticMarkup(
    createElement(Disclosure, { summary: "更多" }, "body"),
  );
  assert.ok(disclosureHtml.includes("dv-ui-disclosure"));
  assert.ok(!disclosureHtml.includes("<details open"), "default collapsed");
  const openDisclosure = renderToStaticMarkup(
    createElement(Disclosure, { summary: "更多", defaultOpen: true }, "body"),
  );
  assert.ok(openDisclosure.includes("open"), "defaultOpen honored");

  const { Modal } = await server.ssrLoadModule("/src/components/ui/Modal.tsx");
  assert.equal(
    renderToStaticMarkup(
      createElement(Modal, { open: false, onClose: () => {} }),
    ),
    "",
  );

  // 5) CommentRail thin entry: null without entries, aside with entries.
  const { CommentRail } = await server.ssrLoadModule(
    "/src/components/CommentRail.tsx",
  );
  const noop = () => {};
  assert.equal(
    renderToStaticMarkup(
      createElement(CommentRail, {
        entries: [],
        onLocate: noop,
        onReply: noop,
        onStatusChange: noop,
        onEdit: noop,
      }),
    ),
    "",
  );
  const railHtml = renderToStaticMarkup(
    createElement(CommentRail, {
      entries: [
        {
          id: "e1",
          category: "visual",
          suggestion: "一条视觉反馈",
          createdAt: "2026-09-06T00:00:00.000Z",
        },
      ],
      onLocate: noop,
      onReply: noop,
      onStatusChange: noop,
      onEdit: noop,
    }),
  );
  assert.ok(railHtml.includes('class="comment-rail '), "rail root preserved");
  assert.ok(railHtml.includes('data-feedback-id="e1"'));
  assert.ok(railHtml.includes("comment-rail-author-badge"));
  assert.ok(railHtml.includes(">我<"), "legacy entry renders user badge");

  console.log(
    "test-a1-refactor: barrel exports, change block wiring, ui kit and CommentRail split passed",
  );
} finally {
  await server.close();
}
