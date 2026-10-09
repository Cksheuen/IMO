#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * David 反馈栏真实浏览器回归（需 BASE_URL 指向运行中的 david 页面）。
 *
 * 默认使用仓库内 sample review + 由其结构派生的合成反馈，任何机器可直接运行：
 *   BASE_URL=http://127.0.0.1:5186 node scripts/test-feedback-rail.mjs
 *
 * 显式覆盖以回归原生导出的真实反馈（不硬编码用户原文/UUID/本机路径）：
 *   REVIEW_FIXTURE=<review.json> FEEDBACK_FIXTURE=<david-feedback.json> \
 *   BASE_URL=http://127.0.0.1:5186 node scripts/test-feedback-rail.mjs
 *
 * 覆盖：
 * - 旧评论 UI 不再出现（popover / 区域划选层 / 文字按钮 / tech-review sidecar）
 * - 列表完整：每条 fixture 条目（id/原文）在 rail 可见
 * - rail 回复 / 状态 / 编辑走同一持久化通道，刷新后保留（先回读存储再展开行）
 * - 显式全局框选 → 写入 david:<slug>:feedback → rail 可见 → 刷新仍在
 * - 普通文本拖拽不产生旧评论控件、不新增反馈，原生选择仍可用
 * - 损坏存储经显式导入恢复；写入失败保留草稿并提示
 * - 0 条列表无空白预留；折叠/展开释放与恢复预留空间
 * - 场景导航（按 fixture 真实结构数据驱动）：A 子节点→A 根、A→B、
 *   详情→总览、rich-detail 打开真实 dialog、shell:feedback-panel 打开真实面板、
 *   overview 锚点命中并 pulse、invalid page/node/component 明确提示失效
 * - 评论列表始终显示全部场景，不受当前画板定位影响
 * - 布局：rail 展开为 inspector 预留空间，rich-detail dialog 层级低于 rail
 *
 * 不读取或清空真实浏览器存储；仅操作本测试上下文。
 * 浏览器选择沿用系统 Chrome 优先（与 drilldown 测试一致）。
 */

import assert from "node:assert/strict";
import { shouldInlineDisclosure } from "../src/lib/disclosureContent.ts";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5186";
const SAMPLE_REVIEW_PATH = fileURLToPath(
  new URL(
    "../src/samples/video-conversion-shooting-guide.review.json",
    import.meta.url,
  ),
);
const REVIEW_FIXTURE = process.env.REVIEW_FIXTURE || SAMPLE_REVIEW_PATH;
const FEEDBACK_FIXTURE = process.env.FEEDBACK_FIXTURE || "";
const TIMEOUT = 8000;

const reviewFixture = JSON.parse(fs.readFileSync(REVIEW_FIXTURE, "utf8"));
const reviewSlug = reviewFixture.slug;
const reviewTitle = reviewFixture.title;
const components = Array.isArray(reviewFixture.components)
  ? reviewFixture.components
  : Object.values(reviewFixture.components);
const pageIds = new Set(
  (reviewFixture.pages ?? [{ id: "default" }]).map((page) => page.id),
);
const flattenNodes = (nodes) => {
  const out = [];
  const walk = (list) => {
    for (const node of list ?? []) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
};
const componentById = (id) => components.find((item) => item.id === id);

// Load the real pure helper through Vite SSR so the assertions stay aligned
// with the application implementation instead of duplicating its logic.
const viteServer = await createSsrTestServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  appType: "custom",
  server: {
    middlewareMode: true,
  },
});

let hasDisclosureDetail;
try {
  ({ hasDisclosureDetail } = await viteServer.ssrLoadModule(
    "/src/lib/disclosureContent.ts",
  ));
} finally {
  await viteServer.close();
}

// 与 App.resolveFeedbackTarget 保持一致的纯解析，用于数据驱动断言。
const resolveTarget = (scope) => {
  if (!scope) return undefined;
  const nodePath = scope.nodePath ?? [];
  return {
    pageId: scope.pageId ?? scope.selection?.scene?.pageId,
    componentId:
      nodePath[0] ??
      scope.selection?.detail?.componentId ??
      scope.selection?.scene?.componentId,
    nodeId:
      nodePath.length > 1
        ? nodePath[nodePath.length - 1]
        : (scope.selection?.detail?.nodeId ?? scope.selection?.scene?.nodeId),
  };
};

// 默认合成反馈：全部 id/文案由本脚本生成，结构取自 review fixture 真实组件/行/节点。
const makeSelection = (overrides = {}) => ({
  version: 1,
  kind: "appearance-selection",
  capturedAt: "2026-09-06T00:00:00.000Z",
  surface: "shell",
  scene: { pageId: "default" },
  viewport: { width: 1440, height: 1000 },
  windowScroll: { x: 0, y: 0 },
  rect: { nx: 0.1, ny: 0.1, nw: 0.2, nh: 0.1 },
  targets: [{ targetId: "shell:layout", label: "外壳", kind: "shell" }],
  ...overrides,
});

let feedbackDoc;
if (FEEDBACK_FIXTURE) {
  feedbackDoc = JSON.parse(fs.readFileSync(FEEDBACK_FIXTURE, "utf8"));
} else {
  const compA = components.find(
    (item) => (item.mapping?.length ?? 0) > 0 && !(item.children?.length > 0),
  );
  const compB = components.find(
    (item) =>
      (item.mapping?.length ?? 0) > 0 && (item.children?.length ?? 0) > 0,
  );
  assert.ok(compA && compB, "sample review 需含两个带 mapping 的组件");
  const nodeB = compB.children[0];
  const rowA = compA.mapping[0].id;
  const rowB = compB.mapping[0].id;
  const at = (minutes) =>
    `2026-09-06T08:${String(minutes).padStart(2, "0")}:00.000Z`;
  feedbackDoc = {
    schema: "david-feedback/v1",
    schemaVersion: 1,
    slug: reviewSlug,
    updatedAt: "2026-09-06T00:00:00.000Z",
    mode: "integrated",
    entries: [
      {
        id: "synth-rich-req",
        category: "visual",
        suggestion: "合成反馈：rich-detail 需求列定位",
        createdAt: at(0),
        scope: {
          pageId: "default",
          nodePath: [compA.id],
          targetId: `rich-detail:${rowA}:requirement:${compA.id}`,
          selection: makeSelection({
            surface: "rich-detail",
            detail: {
              rowId: rowA,
              column: "requirement",
              componentId: compA.id,
            },
            targets: [
              {
                targetId: `rich-detail:${rowA}:requirement:${compA.id}`,
                label: "Rich detail",
                kind: "rich-detail",
              },
            ],
          }),
        },
      },
      {
        id: "synth-panel",
        category: "interaction",
        suggestion: "合成反馈：反馈面板 shell 锚点",
        createdAt: at(1),
        scope: {
          pageId: "default",
          targetId: "shell:feedback-panel",
          selection: makeSelection({
            targets: [
              {
                targetId: "shell:feedback-panel",
                label: "反馈面板",
                kind: "shell",
              },
            ],
          }),
        },
      },
      {
        id: "synth-inspector-root",
        category: "visual",
        suggestion: "合成反馈：组件根层 inspector 表面",
        createdAt: at(2),
        scope: {
          pageId: "default",
          nodePath: [compA.id],
          targetId: "surface:inspector",
          selection: makeSelection({
            surface: "inspector",
            scene: { pageId: "default", componentId: compA.id },
          }),
        },
      },
      {
        id: "synth-layout",
        category: "content",
        suggestion: "合成反馈：shell 布局级反馈",
        createdAt: at(3),
        scope: {
          pageId: "default",
          targetId: "shell:layout",
          selection: makeSelection(),
        },
      },
      {
        id: "synth-node",
        category: "interaction",
        suggestion: "合成反馈：节点级 inspector 定位",
        createdAt: at(4),
        scope: {
          pageId: "default",
          nodePath: [compB.id, nodeB.id],
          targetId: "surface:inspector",
          selection: makeSelection({
            surface: "inspector",
            scene: {
              pageId: "default",
              componentId: compB.id,
              nodeId: nodeB.id,
            },
          }),
        },
      },
      {
        id: "synth-overview-anchor",
        category: "visual",
        suggestion: "合成反馈：总览单元格锚点定位",
        createdAt: at(5),
        scope: {
          pageId: "default",
          targetId: `overview:${compB.id}:${rowB}:change`,
          selection: makeSelection(),
        },
      },
      {
        id: "synth-unscoped",
        category: "other",
        suggestion: "合成反馈：无 scope 只在全部可见",
        createdAt: at(6),
      },
      {
        id: "synth-resolved",
        category: "schema",
        suggestion: "合成反馈：已解决条目",
        createdAt: at(7),
        status: "resolved",
      },
      {
        id: "synth-invalid-page",
        category: "other",
        suggestion: "合成反馈：失效 page",
        createdAt: at(8),
        scope: { pageId: "no-such-page" },
      },
      {
        id: "synth-invalid-node",
        category: "other",
        suggestion: "合成反馈：失效 node",
        createdAt: at(9),
        scope: { pageId: "default", nodePath: [compA.id, "no-such-node"] },
      },
      {
        id: "synth-invalid-component",
        category: "other",
        suggestion: "合成反馈：失效 component",
        createdAt: at(10),
        scope: { pageId: "default", nodePath: ["no-such-component"] },
      },
      {
        id: "synth-long-label",
        category: "content",
        suggestion:
          "合成反馈：超长建议用于折叠裁切回归。" +
          "这段内容需要足够长，确保折叠状态下超过三行显示区域，" +
          "从而验证摘要被正确裁切而不是画出布局盒遮挡时间戳；".repeat(6),
        createdAt: at(11),
      },
      {
        id: "synth-with-replies",
        category: "interaction",
        suggestion: "合成反馈：含 agent 与用户回复",
        createdAt: at(12),
        // agent 回复在列表末尾（createdAt 最晚），折叠态最新回复预览应为 Agent。
        replies: [
          {
            id: "reply-user-1",
            body: "用户回复：保持现状",
            createdAt: at(13),
          },
          {
            id: "reply-agent-1",
            body: "Agent 回复：建议补充说明",
            createdAt: at(14),
            author: "agent",
          },
        ],
      },
    ],
  };
}

assert.equal(feedbackDoc.schema, "david-feedback/v1");
assert.equal(feedbackDoc.slug, reviewSlug, "feedback slug 与 review 一致");
const fixtureEntries = feedbackDoc.entries;
assert.ok(fixtureEntries.length > 0, "fixture 需有条目");
const openCount = fixtureEntries.filter(
  (entry) => entry.status !== "resolved",
).length;

async function launchChromium() {
  const candidates = [
    { channel: "chrome" },
    { channel: "chromium" },
    ...(process.env.CHROME_BIN
      ? [{ executablePath: process.env.CHROME_BIN }]
      : []),
    {},
  ];
  for (const options of candidates) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch {
      // 尝试下一个候选浏览器
    }
  }
  throw new Error(
    "failed to launch Playwright chromium (tried chrome, chromium, CHROME_BIN, bundled)",
  );
}

const feedbackService = await startBrowserFeedbackService();
const browser = await launchChromium();
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await feedbackService.attach(page);
  page.on("pageerror", (err) => errors.push(["pageerror", err.message]));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const expectedServiceFailure =
      msg.location().url.includes("/feedback/") &&
      /status of (404|422|503)/.test(msg.text());
    if (!expectedServiceFailure) errors.push(["console", msg.text()]);
  });
  page.setDefaultTimeout(TIMEOUT);

  const importReview = async () => {
    await page
      .locator("label.import-control")
      .filter({ hasText: "导入 review" })
      .locator("input[type=file]")
      .setInputFiles({
        name: "review.json",
        mimeType: "application/json",
        buffer: fs.readFileSync(REVIEW_FIXTURE),
      });
    await page
      .locator("h1.title")
      .filter({ hasText: reviewTitle })
      .waitFor({ state: "visible" });
  };

  const importFeedback = async () => {
    await page
      .locator("label.import-control")
      .filter({ hasText: "导入 feedback JSON" })
      .locator("input[type=file]")
      .setInputFiles({
        name: "feedback.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(feedbackDoc)),
      });
    await feedbackService.waitFor(
      reviewSlug,
      (stored) =>
        stored?.entries?.length === fixtureEntries.length &&
        fixtureEntries.every((expected) =>
          stored.entries.some(
            (actual) =>
              actual.id === expected.id &&
              actual.suggestion === expected.suggestion &&
              (actual.status ?? "open") === (expected.status ?? "open"),
          ),
        ),
    );
  };

  const railRow = (id) =>
    page.locator(`.comment-rail-row[data-feedback-id="${id}"]`);
  const closeFeedbackPanel = async () => {
    const close = page.getByRole("button", {
      name: "关闭反馈面板",
      exact: true,
    });
    if ((await close.count()) > 0) {
      await close.click();
      await page
        .getByTestId("david-feedback-panel")
        .waitFor({ state: "hidden" });
    }
  };
  const selectStatus = async (status) => {
    await page
      .locator(".comment-rail-status-tabs")
      .getByRole("button", {
        name: status === "resolved" ? "已解决" : "未解决",
        exact: true,
      })
      .click();
  };
  const expand = async (id) => {
    await selectStatus(
      (await readFeedback()).entries.find((e) => e.id === id)?.status,
    );
    const nav = railRow(id).locator(".comment-rail-nav");
    if ((await nav.getAttribute("aria-expanded")) !== "true") {
      await nav.click();
    }
    await railRow(id)
      .locator(".comment-rail-thread")
      .waitFor({ state: "visible" });
  };
  const locate = async (id) => {
    await selectStatus(
      (await readFeedback()).entries.find((e) => e.id === id)?.status,
    );
    const nav = railRow(id).locator(".comment-rail-nav");
    if ((await nav.getAttribute("aria-expanded")) !== "true") {
      await nav.click();
    } else {
      await railRow(id)
        .getByRole("button", { name: "定位", exact: true })
        .click();
    }
  };
  const showAll = async () => {
    await selectStatus("open");
    await page
      .locator(".comment-rail")
      .getByRole("button", { name: "全部", exact: true })
      .click();
  };
  const readFeedback = () => feedbackService.read(reviewSlug);
  const backToOverview = async () => {
    const crumb = page.locator(".david-breadcrumb-item").first();
    if ((await crumb.count()) > 0) {
      await crumb.click();
    }
    await page
      .locator(".david-overview-surface.is-active")
      .waitFor({ state: "visible" });
  };

  await page.goto(BASE_URL);
  await importReview();
  await importFeedback();

  // --- 旧评论 UI 不再出现 ----------------------------------------------
  await page.locator(".comment-rail").waitFor({ state: "visible" });
  assert.equal(await page.locator(".comment-popover").count(), 0);
  assert.equal(await page.locator(".region-selection-rect").count(), 0);
  assert.equal(await page.locator(".text-selection-btn").count(), 0);
  assert.equal(
    (await page.locator("#tech-review-agent-comments").count()) +
      (await page.locator(".comment-panel-shell").count()),
    0,
  );

  // --- 列表完整：每条 fixture 条目（id/原文）可见 -----------------------
  assert.equal(
    await page.locator(".comment-rail-list [data-feedback-id]").count(),
    openCount,
  );
  const countText = await page.locator(".comment-rail-count").textContent();
  assert.ok(countText.includes(`${openCount} 条未解决`));
  for (const entry of fixtureEntries) {
    await selectStatus(entry.status);
    assert.equal(
      await page.locator(".comment-rail-list [data-feedback-id]").count(),
      entry.status === "resolved"
        ? fixtureEntries.length - openCount
        : openCount,
    );
    const text = await railRow(entry.id).textContent();
    assert.ok(
      text.includes(entry.suggestion.slice(0, 12)),
      `反馈 ${entry.id} 原文可见`,
    );
  }

  // --- 折叠/展开排版：长摘要裁切不遮时间，展开后全文有空间 ---------------
  await showAll();
  const longEntry = fixtureEntries.find(
    (entry) => entry.id === "synth-long-label",
  );
  assert.ok(longEntry, "fixture 含超长摘要条目");
  const longRow = railRow(longEntry.id);
  await longRow.scrollIntoViewIfNeeded();
  const foldedLabel = longRow.locator(".comment-rail-label");
  const foldedMetrics = await foldedLabel.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      overflow: style.overflow,
      lineClamp: style.webkitLineClamp,
      clientHeight: el.clientHeight,
    };
  });
  assert.equal(foldedMetrics.lineClamp, "3", "折叠行长摘要保持 3 行裁切");
  assert.notEqual(
    foldedMetrics.overflow,
    "visible",
    "折叠行摘要不允许 overflow visible 画出布局盒",
  );
  const foldedLabelBox = await foldedLabel.boundingBox();
  const foldedTimeBox = await longRow
    .locator(".comment-rail-time")
    .boundingBox();
  assert.ok(foldedLabelBox && foldedTimeBox, "折叠行 label/time 均参与布局");
  assert.ok(
    foldedTimeBox.y >= foldedLabelBox.y + foldedLabelBox.height - 1,
    "折叠行时间戳位于摘要布局盒下方，不与 label 重叠",
  );

  await expand(longEntry.id);
  const expandedLabel = longRow.locator(".comment-rail-label");
  const expandedMetrics = await expandedLabel.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      overflow: style.overflow,
      lineClamp: style.webkitLineClamp,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    };
  });
  assert.equal(expandedMetrics.lineClamp, "none", "展开后取消行数限制");
  assert.equal(expandedMetrics.overflow, "visible", "展开后解除裁切");
  assert.ok(
    expandedMetrics.clientHeight > foldedMetrics.clientHeight,
    "长摘要确实超出折叠盒，展开后获得完整高度",
  );
  assert.ok(
    expandedMetrics.scrollHeight <= expandedMetrics.clientHeight + 1,
    "展开后全文有空间，不再被裁切",
  );
  const expandedLabelBox = await expandedLabel.boundingBox();
  const expandedTimeBox = await longRow
    .locator(".comment-rail-time")
    .boundingBox();
  assert.ok(
    expandedTimeBox.y >= expandedLabelBox.y + expandedLabelBox.height - 1,
    "展开后时间戳仍位于全文下方",
  );

  // 恢复折叠，避免影响后续默认折叠状态的断言。
  const sceneBeforeCollapse = await page
    .locator(".david-breadcrumb")
    .allTextContents();
  const dataBeforeCollapse = await readFeedback();
  await longRow.locator(".comment-rail-nav").click();
  assert.deepEqual(
    await page.locator(".david-breadcrumb").allTextContents(),
    sceneBeforeCollapse,
  );
  assert.deepEqual(await readFeedback(), dataBeforeCollapse);
  await longRow.locator(".comment-rail-thread").waitFor({ state: "hidden" });

  // --- 回复 / 状态 / 编辑持久化 + 刷新保留 -------------------------------
  const replyTarget = fixtureEntries[0];
  await expand(replyTarget.id);
  await railRow(replyTarget.id)
    .locator("textarea")
    .first()
    .fill("rail 回复内容");
  await railRow(replyTarget.id)
    .getByRole("button", { name: "回复", exact: true })
    .click();
  let stored = await feedbackService.waitFor(reviewSlug, (doc) =>
    doc?.entries?.some(
      (item) =>
        item.id === replyTarget.id &&
        item.replies?.some((reply) => reply.body === "rail 回复内容"),
    ),
  );
  let entry = stored.entries.find((item) => item.id === replyTarget.id);
  assert.equal(entry.replies.length, 1, "回复已持久化");
  assert.equal(entry.replies[0].body, "rail 回复内容");

  await railRow(replyTarget.id)
    .getByRole("button", { name: "标记解决", exact: true })
    .click();
  stored = await feedbackService.waitFor(
    reviewSlug,
    (doc) =>
      doc?.entries?.find((item) => item.id === replyTarget.id)?.status ===
      "resolved",
  );
  assert.equal(
    stored.entries.find((item) => item.id === replyTarget.id).status,
    "resolved",
    "解决状态已持久化",
  );

  await railRow(replyTarget.id).waitFor({ state: "detached" });
  await expand(replyTarget.id);
  await railRow(replyTarget.id)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await railRow(replyTarget.id)
    .locator("textarea")
    .first()
    .fill("编辑后的建议");
  await railRow(replyTarget.id)
    .getByRole("button", { name: "保存", exact: true })
    .click();
  stored = await feedbackService.waitFor(
    reviewSlug,
    (doc) =>
      doc?.entries?.find((item) => item.id === replyTarget.id)?.suggestion ===
      "编辑后的建议",
  );
  entry = stored.entries.find((item) => item.id === replyTarget.id);
  assert.equal(entry.suggestion, "编辑后的建议", "编辑已持久化");
  assert.ok(
    entry.scope !== undefined || replyTarget.scope === undefined,
    "scope 保留",
  );

  // 刷新后：先回读存储确认数据仍在，再展开行确认用户可见的回复/编辑。
  await page.reload();
  await importReview();
  stored = await readFeedback();
  entry = stored.entries.find((item) => item.id === replyTarget.id);
  assert.equal(entry.replies.length, 1, "刷新后回复仍在存储中");
  assert.equal(entry.replies[0].body, "rail 回复内容");
  await expand(replyTarget.id);
  const reloadedText = await railRow(replyTarget.id).textContent();
  assert.ok(reloadedText.includes("编辑后的建议"), "刷新后编辑可见");
  assert.ok(reloadedText.includes("rail 回复内容"), "刷新后回复可见");

  await railRow(replyTarget.id)
    .getByRole("button", { name: "重新打开", exact: true })
    .click();
  const reopened = await feedbackService.waitFor(
    reviewSlug,
    (doc) =>
      doc?.entries?.find((e) => e.id === replyTarget.id)?.status === "open",
  );
  assert.equal(
    reopened.entries.find((e) => e.id === replyTarget.id).status,
    "open",
  );
  await railRow(replyTarget.id).waitFor({ state: "detached" });
  await selectStatus("open");
  await railRow(replyTarget.id).waitFor({ state: "visible" });

  // --- 回复作者：agent 回复与用户回复可区分（含刷新后保留） ---------------
  const authorEntryId = "synth-with-replies";
  const authorEntry = fixtureEntries.find((e) => e.id === authorEntryId);
  assert.ok(authorEntry, "fixture 含带作者回复的条目");
  await showAll();
  await expand(authorEntryId);
  // 展开态：agent 回复带徽标，文案为 Agent
  const agentReply = railRow(authorEntryId).locator(
    '.comment-rail-reply-item[data-reply-author="agent"]',
  );
  await agentReply.waitFor({ state: "visible" });
  const replyLayout = await agentReply.evaluate((element) => {
    const author = element.querySelector(".comment-rail-reply-author");
    const body = element.querySelector(".comment-rail-reply-locate");
    const time = element.querySelector("time");
    const rect = (node) => node?.getBoundingClientRect();
    return {
      direction: getComputedStyle(element).flexDirection,
      authorFontSize: author ? getComputedStyle(author).fontSize : "",
      timeFontSize: time ? getComputedStyle(time).fontSize : "",
      author: rect(author),
      body: rect(body),
      time: rect(time),
    };
  });
  assert.equal(replyLayout.direction, "column", "回复条目采用竖向排列");
  assert.ok(
    replyLayout.author &&
      replyLayout.body &&
      replyLayout.time &&
      replyLayout.body.y >=
        replyLayout.author.y + replyLayout.author.height - 1 &&
      replyLayout.time.y >= replyLayout.body.y + replyLayout.body.height - 1,
    "回复正文与时间按作者→正文→时间顺序排列",
  );
  assert.ok(
    Number.parseFloat(replyLayout.authorFontSize) <= 11 &&
      Number.parseFloat(replyLayout.timeFontSize) <= 11,
    "作者和时间使用小号辅助信息字号",
  );
  assert.equal(
    (
      await agentReply.locator(".comment-rail-reply-author").textContent()
    ).trim(),
    "Agent",
    "展开态 agent 回复徽标文案为 Agent",
  );
  // 旧数据（无 author 字段）→ 归为用户回复，徽标文案为我
  const userReply = railRow(authorEntryId).locator(
    '.comment-rail-reply-item[data-reply-author="user"]',
  );
  await userReply.waitFor({ state: "visible" });
  assert.equal(
    (
      await userReply.locator(".comment-rail-reply-author").textContent()
    ).trim(),
    "我",
    "旧数据回复徽标文案为我",
  );
  // 折叠态：「2 回复 · 1 来自 Agent」标注 + 最新回复预览徽标
  await railRow(authorEntryId).locator(".comment-rail-nav").click();
  const collapsedKind = await railRow(authorEntryId)
    .locator(".comment-rail-kind")
    .textContent();
  assert.ok(
    collapsedKind.includes("2 回复") && collapsedKind.includes("1 来自 Agent"),
    `折叠态回复计数标注 agent 数量：${collapsedKind}`,
  );
  const latestBadge = railRow(authorEntryId).locator(
    ".comment-rail-latest-reply .comment-rail-reply-author",
  );
  assert.equal(
    (await latestBadge.textContent()).trim(),
    "Agent",
    "折叠态最新回复预览带作者徽标",
  );
  // 刷新后保留：先回读 localStorage 确认 author 落盘，再展开确认仍渲染徽标
  await page.reload();
  await importReview();
  const authorStored = await readFeedback();
  const authorStoredReplies = authorStored.entries.find(
    (e) => e.id === authorEntryId,
  ).replies;
  assert.equal(
    authorStoredReplies.find((r) => r.id === "reply-agent-1").author,
    "agent",
    "刷新后 agent 回复 author 字段保留",
  );
  assert.equal(
    authorStoredReplies.find((r) => r.id === "reply-user-1").author,
    undefined,
    "用户回复不落 author 字段",
  );
  await expand(authorEntryId);
  await railRow(authorEntryId)
    .locator('.comment-rail-reply-item[data-reply-author="agent"]')
    .waitFor({ state: "visible" });
  assert.equal(
    (
      await railRow(authorEntryId)
        .locator(
          '.comment-rail-reply-item[data-reply-author="agent"] .comment-rail-reply-author',
        )
        .textContent()
    ).trim(),
    "Agent",
    "刷新后折叠重入展开态仍渲染 Agent 徽标",
  );

  // --- 显式全局框选 → 写入 → rail 可见 → 刷新仍在 -----------------------
  // 重新加载以确保从干净的总览状态开始，同时保留 localStorage 中的反馈数据
  await page.reload();
  await importReview();
  await page.getByTestId("component-dock").waitFor({ state: "hidden" });
  await page.getByTestId("david-overview").waitFor({ state: "visible" });
  const beforeCount = (await readFeedback()).entries.length;
  await page.getByRole("button", { name: "进入框选评价模式" }).click();
  const overviewBox = await page
    .locator('[data-testid="david-overview"]')
    .boundingBox();
  await page.mouse.move(overviewBox.x + 160, overviewBox.y + 140);
  await page.mouse.down();
  await page.mouse.move(overviewBox.x + 320, overviewBox.y + 240, {
    steps: 8,
  });
  await page.mouse.up();
  await page.getByTestId("feedback-suggestion").waitFor({ state: "visible" });
  const capturedNote = `rail-capture-${Date.now()}`;
  await page.getByTestId("feedback-suggestion").fill(capturedNote);
  await page.getByTestId("feedback-submit").click();
  await page.getByText("反馈已保存", { exact: true }).waitFor();
  await page
    .locator(".comment-rail-list [data-feedback-id]")
    .filter({ hasText: capturedNote })
    .waitFor({ state: "visible" });
  assert.equal(
    (await readFeedback()).entries.length,
    beforeCount + 1,
    "框选反馈已写入",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await importReview();
  await page
    .locator(".comment-rail-list [data-feedback-id]")
    .filter({ hasText: capturedNote })
    .waitFor({ state: "visible" });

  // --- 普通文本拖拽：不产生旧入口、不新增反馈，原生选择保留 ---------------
  const railCountBefore = await page
    .locator(".comment-rail-list [data-feedback-id]")
    .count();
  const summary = page.locator(".david-overview-summary");
  const summaryBox = await summary.boundingBox();
  await page.mouse.move(summaryBox.x + 8, summaryBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(summaryBox.x + 140, summaryBox.y + 24, { steps: 6 });
  await page.mouse.up();
  const selectedText = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  assert.ok(selectedText.trim().length > 0, "普通文本选择仍然可用");
  assert.equal(await page.locator(".comment-popover").count(), 0);
  assert.equal(await page.locator(".text-selection-btn").count(), 0);
  assert.equal(await page.locator(".region-selection-rect").count(), 0);
  assert.equal(
    await page.locator(".comment-rail-list [data-feedback-id]").count(),
    railCountBefore,
    "普通拖拽不新增反馈",
  );

  // --- 损坏存储：显式导入恢复 -------------------------------------------
  feedbackService.seed(reviewSlug, "{broken json");
  await page.reload();
  await importReview();
  await page.locator(".comment-load-warning").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".comment-rail").count(),
    0,
    "损坏存储不渲染列表",
  );
  await importFeedback();
  assert.equal(
    await page.locator(".comment-load-warning").count(),
    0,
    "显式导入后恢复",
  );
  await page.locator(".comment-rail").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".comment-rail-list [data-feedback-id]").count(),
    openCount,
  );

  // --- 写入失败：保留草稿并提示，不做假成功 ------------------------------
  const draftTarget = fixtureEntries[1];
  await expand(draftTarget.id);
  await closeFeedbackPanel();
  await railRow(draftTarget.id).locator("textarea").first().fill("失败草稿");
  feedbackService.failNextWrite();
  await railRow(draftTarget.id)
    .getByRole("button", { name: "回复", exact: true })
    .click();
  await Promise.race([
    railRow(draftTarget.id)
      .locator(".comment-rail-error")
      .waitFor({ state: "visible" }),
    page.locator(".comment-load-warning").waitFor({ state: "visible" }),
  ]);
  const draftValue = await railRow(draftTarget.id)
    .locator("textarea")
    .first()
    .inputValue();
  assert.equal(draftValue, "失败草稿", "写入失败保留草稿");

  // --- 0 条列表无空白；折叠/展开释放与恢复 -------------------------------
  feedbackService.seed(reviewSlug, {
    schema: "david-feedback/v1",
    schemaVersion: 1,
    slug: reviewSlug,
    updatedAt: "2026-09-06T00:00:00.000Z",
    mode: "integrated",
    entries: [],
  });
  await page.reload();
  await importReview();
  await page.waitForFunction(
    () => !document.querySelector('.comment-rail[aria-busy="true"]'),
  );
  assert.equal(
    await page.locator(".comment-rail").count(),
    0,
    "0 条反馈不渲染 rail",
  );
  assert.ok(
    !(await page.evaluate(() =>
      document.body.classList.contains("comment-rail-open"),
    )),
    "0 条反馈不预留空白",
  );
  await importFeedback();
  await page.locator(".comment-rail").waitFor({ state: "visible" });
  assert.ok(
    await page.evaluate(() =>
      document.body.classList.contains("comment-rail-open"),
    ),
    "有反馈时预留空间",
  );
  await page.locator(".comment-rail-toggle").click();
  assert.ok(
    !(await page.evaluate(() =>
      document.body.classList.contains("comment-rail-open"),
    )),
    "折叠后释放空间",
  );
  await page.locator(".comment-rail-toggle").click();

  // --- 全部场景：切换画板不隐藏其他评论 -------------------------------
  await backToOverview();
  const allCount = await page
    .locator(".comment-rail-list [data-feedback-id]")
    .count();
  assert.equal(
    await page
      .locator(".comment-rail")
      .getByRole("button", { name: "当前场景", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator(".comment-rail")
      .getByRole("button", { name: "待我复评", exact: true })
      .count(),
    0,
  );
  const componentWithEntries = components[0];
  await page
    .locator(`[data-testid="overview-component-${componentWithEntries.id}"]`)
    .first()
    .click();
  await page
    .locator(".component-dock.is-visible")
    .waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".comment-rail-list [data-feedback-id]").count(),
    allCount,
    "画板切换后评论列表仍显示全部场景",
  );

  // --- 布局：rail 展开为 inspector 预留空间；dialog 层级高于 rail ----------
  await backToOverview();
  await showAll();
  await page
    .locator(`[data-testid="overview-component-${componentWithEntries.id}"]`)
    .first()
    .click();
  await page
    .locator(".component-dock.is-visible")
    .waitFor({ state: "visible" });
  assert.ok(
    await page.evaluate(() =>
      document.body.classList.contains("comment-rail-open"),
    ),
  );
  const paddingOpen = await page
    .locator(".inspector-shell")
    .evaluate((el) => getComputedStyle(el).paddingRight);
  assert.ok(parseFloat(paddingOpen) > 100, "rail 展开时 inspector 预留空间");
  await page.locator(".comment-rail-toggle").click();
  const paddingClosed = await page
    .locator(".inspector-shell")
    .evaluate((el) => getComputedStyle(el).paddingRight);
  assert.ok(parseFloat(paddingClosed) < parseFloat(paddingOpen), "折叠后释放");
  await page.locator(".comment-rail-toggle").click();

  const richEntry = fixtureEntries.find(
    (entry) => entry.scope?.selection?.detail,
  );
  const layoutDetail = richEntry?.scope.selection.detail;
  const layoutRow = layoutDetail
    ? components
        .find((c) => c.id === layoutDetail.componentId)
        ?.mapping?.find((r) => r.id === layoutDetail.rowId)
    : undefined;
  if (
    richEntry &&
    layoutRow &&
    !shouldInlineDisclosure(layoutRow, layoutDetail.column)
  ) {
    await locate(richEntry.id);
    await page
      .locator('[data-david-surface="rich-detail"]')
      .waitFor({ state: "visible" });
    const zDialog = await page
      .locator(".rich-detail-host")
      .evaluate((el) => getComputedStyle(el).zIndex);
    const zRail = await page
      .locator(".comment-rail")
      .evaluate((el) => getComputedStyle(el).zIndex);
    assert.ok(
      Number(zDialog) < Number(zRail),
      "rail 层级高于无蒙层 rich-detail",
    );
    await page.keyboard.press("Escape");
  }

  // --- 场景导航：按 fixture 真实结构数据驱动回放 --------------------------
  await backToOverview();
  await showAll();
  for (const entry of fixtureEntries) {
    if (!entry.scope) continue;
    const target = resolveTarget(entry.scope);
    const comp = target?.componentId
      ? componentById(target.componentId)
      : undefined;
    const detail = entry.scope.selection?.detail;
    const historicalRow = detail
      ? [
          ...(comp?.mapping ?? []),
          ...flattenNodes(comp?.children).flatMap((item) => item.mapping ?? []),
        ].find((row) => row.id === detail.rowId)
      : undefined;
    const node =
      comp && target.nodeId
        ? flattenNodes(comp.children).find((item) => item.id === target.nodeId)
        : undefined;
    const reservedTargetIds = new Set([
      "surface:page",
      "surface:overview",
      "surface:inspector",
      "surface:dock",
      "shell:layout",
    ]);
    const expectMissed =
      (target?.pageId && !pageIds.has(target.pageId)) ||
      (target?.componentId && !comp) ||
      (target?.nodeId && !node) ||
      Boolean(
        detail &&
        (!historicalRow ||
          !hasDisclosureDetail(
            historicalRow,
            detail.column,
            detail.nodeId ? "node" : "component",
          )),
      ) ||
      reservedTargetIds.has(entry.scope.targetId);
    await locate(entry.id);
    if (expectMissed) {
      await railRow(entry.id)
        .locator(".comment-rail-missed")
        .waitFor({ state: "visible" });
      if (detail && comp && (!target?.pageId || pageIds.has(target.pageId))) {
        await page.waitForFunction(
          ({ selector, label }) =>
            document.querySelector(selector)?.textContent?.includes(label) ??
            false,
          {
            selector: "[data-testid='david-breadcrumb']",
            label: comp.label,
          },
          { timeout: TIMEOUT },
        );
      }
      continue;
    }
    if (entry.scope.targetId === "shell:feedback-panel") {
      await page
        .getByTestId("david-feedback-panel")
        .waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
    } else if (
      detail &&
      historicalRow &&
      shouldInlineDisclosure(historicalRow, detail.column)
    ) {
      await page
        .locator(
          `.inspector [data-trd-row="${detail.rowId}"] [data-disclosure-column="${detail.column}"]`,
        )
        .waitFor({ state: "visible" });
      assert.equal(
        await page.locator('[data-david-surface="rich-detail"]').count(),
        0,
        "short historical detail locates inline content",
      );
    } else if (entry.scope.selection?.detail) {
      await page
        .locator('[data-david-surface="rich-detail"]')
        .waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
    } else if (target?.componentId) {
      await page
        .locator(".component-dock.is-visible")
        .waitFor({ state: "visible" });
      // dock 可见不代表目标场景就绪（跨组件定位时可能仍是上一组件的 docked
      // 态）：等面包屑实际包含目标组件/节点标签后再断言。
      const expectedCrumbParts = [comp.label];
      if (target.nodeId) expectedCrumbParts.push(node.label);
      await page.waitForFunction(
        ({ selector, parts }) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return parts.every((part) => text.includes(part));
        },
        {
          selector: "[data-testid='david-breadcrumb']",
          parts: expectedCrumbParts,
        },
        { timeout: TIMEOUT },
      );
      const crumbs = await page.getByTestId("david-breadcrumb").textContent();
      assert.ok(crumbs.includes(comp.label), `${entry.id} 面包屑含组件标签`);
      if (target.nodeId) {
        assert.ok(crumbs.includes(node.label), `${entry.id} 面包屑含节点标签`);
      } else {
        assert.equal(
          await page.locator(".david-breadcrumb-item").count(),
          2,
          `${entry.id} 根层反馈面包屑只有总览+组件`,
        );
      }
    } else {
      await page
        .locator(".david-overview-surface.is-active")
        .waitFor({ state: "visible" });
      assert.equal(
        await page.locator(".component-dock.is-visible").count(),
        0,
        `${entry.id} 无组件目标回总览`,
      );
      if (entry.scope.targetId?.startsWith("overview:")) {
        await page.waitForFunction(
          (selector) =>
            document
              .querySelector(selector)
              ?.classList.contains("is-pulse-highlight") === true,
          `[data-review-target="${entry.scope.targetId}"]`,
          { timeout: TIMEOUT },
        );
      }
    }
    assert.equal(
      await railRow(entry.id).locator(".comment-rail-missed").count(),
      0,
      `${entry.id} 定位成功不误报失效`,
    );
  }

  assert.deepEqual(errors, [], "no page or console errors");
} finally {
  await browser.close();
  await feedbackService.close();
}
