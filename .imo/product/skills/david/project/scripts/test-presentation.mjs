#!/usr/bin/env node
import { createSsrTestServer } from "./ssr-test-server.mjs";
/**
 * 展示层回归（反馈 1/2/4/7/9）：
 * - 无变化 API 隐藏（api.changed=false）而有变化字段仍可高亮
 * - 元数据不重复（列内容不含行级 meta；dialog header 不重复摘要/口径）
 * - 长路径省略显示、hover/focus 读全、点击复制（CompactRef）
 * - 多证据/多路径默认折叠、展开后完整可读
 * - 已有 rich 内容不丢；旧 JSON（无新字段）兼容
 * - reviewBrief.changeType / api.changed 类型校验
 *
 * SSR 部分用 vite ssrLoadModule + renderToStaticMarkup；
 * 浏览器部分（BASE_URL 指定）做真实展示行为断言：配置 BASE_URL 即必须
 * 执行，依赖缺失 / 启动失败 / 断言失败一律非零并保留原因；未配置时
 * 显式 SSR-only 跳过。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createSsrTestServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log("ok - " + name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL - " + name + ": " + error.message);
  }
};
const checkAsync = async (name, fn) => {
  try {
    await fn();
    console.log("ok - " + name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL - " + name + ": " + error.message);
  }
};

try {
  const rich = await server.ssrLoadModule("/src/lib/richContent/index.ts");
  const { DisclosureCell } = await server.ssrLoadModule(
    "/src/components/details/DisclosureCell.tsx",
  );
  const { ComponentDetails } = await server.ssrLoadModule(
    "/src/components/details/ComponentDetails.tsx",
  );
  const { CompactRef } = await server.ssrLoadModule(
    "/src/components/CompactRef.tsx",
  );
  const { parseReviewSpec } = await server.ssrLoadModule(
    "/src/lib/reviewSpec.ts",
  );

  const field = (name) => ({
    name,
    type: "string",
    meaning: name + " meaning",
  });
  const plainRow = {
    id: "r1",
    requirement: "FULL_REQUIREMENT",
    change: "FULL_CHANGE",
    api: { summary: "FULL_API" },
  };

  // ---- 反馈 4：无变化 API 隐藏，判据唯一 ----
  check("rowApiChanged：显式 false 隐藏，缺省/true 展示", () => {
    assert.equal(
      rich.rowApiChanged({ ...plainRow, api: { changed: false } }),
      false,
    );
    assert.equal(rich.rowApiChanged({ ...plainRow, api: {} }), true);
    assert.equal(
      rich.rowApiChanged({ ...plainRow, api: { changed: true } }),
      true,
    );
  });

  const renderCell = (row, column, level = "component") =>
    renderToStaticMarkup(
      createElement(DisclosureCell, { row, column, level, componentId: "c1" }),
    );

  const renderCheckedCell = (row, column, level = "component") => {
    const spec = {
      slug: "fixture",
      title: "Fixture",
      subtitle: "Fixture",
      pageHtml: '<section data-component-id="c1"></section>',
      components: [
        {
          id: "c1",
          label: "Fixture",
          mapping: [row],
        },
      ],
    };
    const payload = parseReviewSpec(spec);
    const parsedRow = payload.data.components[0].mapping[0];
    return renderCell(parsedRow, column, level);
  };

  // Evidence-only change details should still render additional content.
  {
    const row = {
      ...plainRow,
      codePaths: ["src/foo.ts", "src/bar.ts"],
    };
    const requirementHtml = renderCell(row, "requirement");
    assert(
      !requirementHtml.includes('class="disclosure-open"'),
      "codePaths-only row must not create a requirement disclosure entry",
    );
    const changeHtml = renderCell(row, "change");
    assert(
      changeHtml.includes('class="disclosure-open"'),
      "codePaths-only row must create a change disclosure entry",
    );
  }

  {
    const row = {
      ...plainRow,
      trd: {
        productDesign: {
          points: [{ text: plainRow.requirement }],
        },
      },
    };
    const html = renderCheckedCell(row, "requirement");
    assert(
      !html.includes('class="disclosure-open"'),
      "productDesign points equal to displayed requirement must not create an entry",
    );
    assert.equal(
      html.split(plainRow.requirement).length - 1,
      1,
      "inline points must not duplicate the same summary",
    );
  }

  {
    const row = {
      ...plainRow,
      trd: {
        productDesign: {
          points: [{ text: plainRow.requirement }],
          positioning: "Distinct positioning text",
        },
      },
    };
    const html = renderCheckedCell(row, "requirement");
    assert(
      !html.includes('class="disclosure-open"') &&
        html.includes("Distinct positioning text"),
      "short distinct positioning must stay directly readable without a detail entry",
    );
  }

  {
    const row = {
      ...plainRow,
      trd: {
        technical: {
          pseudoCode: "const answer = 42;",
        },
      },
    };
    const html = renderCheckedCell(row, "change");
    assert(
      html.includes('class="disclosure-open"'),
      "standalone technical pseudoCode must create a change entry",
    );
  }

  {
    const row = {
      ...plainRow,
      overviewSummary: { requirement: "short" },
      requirement: "long original",
    };
    const html = renderCheckedCell(row, "requirement", "overview");
    assert(
      !html.includes('class="disclosure-open"') &&
        html.includes("long original"),
      "short full requirement is directly reachable at overview level",
    );
  }

  check("api.changed=false：API 单元格不渲染（无入口无文案）", () => {
    const html = renderCell({ ...plainRow, api: { changed: false } }, "api");
    assert.equal(html, "");
  });

  await checkAsync(
    "mergeFeedbackDocuments：合并回复/新意见，冲突拒绝且不改当前文档",
    async () => {
      const { mergeFeedbackDocuments } = await server.ssrLoadModule(
        "/src/lib/davidFeedback.ts",
      );
      const now = "2026-01-01T00:00:00.000Z";
      const baseEntry = {
        id: "entry-1",
        category: "content",
        suggestion: "Original suggestion",
        createdAt: now,
      };
      const current = {
        schema: "david-feedback/v1",
        schemaVersion: 1,
        slug: "feature-a",
        updatedAt: now,
        mode: "integrated",
        entries: [baseEntry],
      };
      const concurrentEntry = {
        id: "entry-2",
        category: "content",
        suggestion: "Concurrent local suggestion",
        createdAt: now,
      };
      const localReply = {
        id: "reply-local",
        body: "Local reply",
        createdAt: now,
      };
      const currentWithLocalChanges = {
        ...current,
        entries: [
          {
            ...baseEntry,
            replies: [localReply],
          },
          concurrentEntry,
        ],
      };
      const incomingReply = {
        id: "reply-incoming",
        body: "Incoming reply",
        createdAt: now,
      };
      const incoming = {
        ...current,
        updatedAt: "2026-01-02T00:00:00.000Z",
        entries: [
          {
            ...baseEntry,
            replies: [incomingReply],
          },
        ],
      };
      const incomingSnapshot = globalThis.structuredClone(incoming);
      const currentSnapshot = globalThis.structuredClone(
        currentWithLocalChanges,
      );

      const merged = mergeFeedbackDocuments(currentWithLocalChanges, incoming);
      assert.deepEqual(
        merged.entries.map((entry) => entry.id),
        ["entry-1", "entry-2"],
      );
      assert.deepEqual(
        merged.entries[0].replies.map((reply) => reply.id),
        ["reply-local", "reply-incoming"],
      );
      assert.deepEqual(currentWithLocalChanges, currentSnapshot);
      assert.deepEqual(incoming, incomingSnapshot);

      const replayed = mergeFeedbackDocuments(merged, incoming);
      assert.deepEqual(
        replayed.entries[0].replies.map((reply) => reply.id),
        ["reply-local", "reply-incoming"],
      );

      const conflictingSuggestion = globalThis.structuredClone(incoming);
      conflictingSuggestion.entries[0].suggestion = "Conflicting suggestion";
      assert.throws(() =>
        mergeFeedbackDocuments(currentWithLocalChanges, conflictingSuggestion),
      );
      assert.deepEqual(currentWithLocalChanges, currentSnapshot);

      const conflictingReply = globalThis.structuredClone(incoming);
      conflictingReply.entries[0].replies[0] = {
        ...incomingReply,
        id: "reply-local",
        body: "Conflicting reply body",
      };
      assert.throws(() =>
        mergeFeedbackDocuments(currentWithLocalChanges, conflictingReply),
      );
      assert.deepEqual(currentWithLocalChanges, currentSnapshot);

      const differentSlug = globalThis.structuredClone(incoming);
      differentSlug.slug = "feature-b";
      assert.throws(() =>
        mergeFeedbackDocuments(currentWithLocalChanges, differentSlug),
      );
    },
  );

  check("api.changed 缺省：API 契约与字段高亮保留", () => {
    const row = {
      ...plainRow,
      trd: {
        apiChange: {
          items: [
            {
              title: "Contract",
              code: "+ 1: string short_selling_points;",
              codeLabel: "Thrift",
              fields: [field("item.field")],
            },
          ],
        },
      },
    };
    const html = renderCell(row, "api");
    assert.ok(html.includes("查看接口"));
    assert.ok(html.includes("1 个改动条目"));
    // 契约代码块与变更高亮在 scoped detail 主体内（不在单元格摘要层）
    const detail = renderToStaticMarkup(rich.renderOverviewCell(row, "api"));
    assert.ok(detail.includes("is-highlight"));
    assert.ok(detail.includes("item.field meaning"));
  });

  check("ComponentDetails：全部行无 API → 两列模式", () => {
    const component = {
      id: "c1",
      label: "C1",
      mapping: [
        { ...plainRow, id: "a", api: { changed: false } },
        { ...plainRow, id: "b", api: { changed: false } },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(ComponentDetails, {
        component,
        index: 0,
        total: 1,
        onFieldClick: () => undefined,
        onClose: () => undefined,
        onSwitch: () => undefined,
      }),
    );
    assert.ok(html.includes("trd-table--two-col"));
    assert.ok(!html.includes("API 改动"));
    assert.ok(!html.includes("查看接口"));
  });

  check("ComponentDetails：mixed 行 → 无 API 行的改动列跨两列", () => {
    const component = {
      id: "c1",
      label: "C1",
      mapping: [
        { ...plainRow, id: "no-api", api: { changed: false } },
        {
          ...plainRow,
          id: "with-api",
          trd: { apiChange: { items: [{ code: "+ 1: x" }] } },
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(ComponentDetails, {
        component,
        index: 0,
        total: 1,
        onFieldClick: () => undefined,
        onClose: () => undefined,
        onSwitch: () => undefined,
      }),
    );
    assert.ok(!html.includes("trd-table--two-col"));
    assert.ok(html.includes("trd-cell--wide"));
    assert.ok(html.includes("API 改动"));
  });

  // ---- 反馈 2：改动性质标签，与状态分离且只一次 ----
  check("changeType 渲染为独立标签且与 status 分离", () => {
    const row = {
      ...plainRow,
      reviewBrief: { changeType: "重构", status: "已验证" },
    };
    const chips = renderToStaticMarkup(rich.renderBriefChips(row.reviewBrief));
    assert.ok(chips.includes("重构"));
    assert.ok(chips.includes("已验证"));
    assert.ok(chips.includes("trd-bchip-change-type"));
    assert.equal(chips.split("重构").length - 1, 1);
  });

  check("根组件的单行叶子内联接口列，独立详情与显式下钻仍保留入口", () => {
    const row = {
      id: "leaf-row",
      requirement: "叶子需求",
      change: "叶子实现",
      api: {
        fields: [
          { name: "leaf_visible_field", type: "string", meaning: "字段" },
        ],
      },
    };
    const child = { id: "leaf", label: "叶子", mappingIds: [row.id] };
    const render = (extra = {}) =>
      renderToStaticMarkup(
        createElement(ComponentDetails, {
          component: {
            id: "inline-root",
            label: "根组件",
            mapping: [row],
            children: [{ ...child, ...extra }],
          },
          index: 0,
          total: 1,
          onFieldClick() {},
          onClose() {},
          onSwitch() {},
        }),
      );
    assert.ok(render().includes("trd-cell-api"));
    assert.ok(
      !render({ deepDive: { logic: ["独立增量"] } }).includes(
        "leaf_visible_field",
      ),
    );
    assert.ok(!render({ interaction: "drilldown" }).includes("trd-cell-api"));
    assert.ok(!render({ canvas: true }).includes("trd-cell-api"));
  });

  check("ComponentDetails 行 header：chips 只出现一次（不进每列）", () => {
    const component = {
      id: "c1",
      label: "C1",
      mapping: [
        { ...plainRow, reviewBrief: { changeType: "重构", status: "已验证" } },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(ComponentDetails, {
        component,
        index: 0,
        total: 1,
        onFieldClick: () => undefined,
        onClose: () => undefined,
        onSwitch: () => undefined,
      }),
    );
    assert.equal(html.split("trd-brief-chips").length - 1, 1);
    assert.equal(html.split(">重构<").length - 1, 1);
    assert.ok(!html.includes("disclosure-chip"));
  });

  // ---- 反馈 1：分层去重 ----
  check("列内容不含行级 meta；renderRowExtras 含且仅一次", () => {
    const row = {
      ...plainRow,
      codePaths: ["src/example.ts"],
      reviewBrief: { changeType: "重构", status: "已验证" },
      cross: { note: "CROSS_NOTE", flow: ["CROSS_FLOW"] },
    };
    for (const column of ["requirement", "change", "api"]) {
      const html = renderToStaticMarkup(rich.renderOverviewCell(row, column));
      assert.ok(!html.includes("CROSS_NOTE"), column + " 不应含 cross.note");
      assert.ok(!html.includes("src/example.ts"), column + " 不应含 codePaths");
      assert.ok(!html.includes("trd-brief-chips"), column + " 不应含 chips");
    }
    const extras = renderToStaticMarkup(rich.renderRowExtras(row));
    assert.ok(extras.includes("CROSS_NOTE"));
    assert.ok(extras.includes("src/example.ts"));
    assert.equal(extras.split("CROSS_NOTE").length - 1, 1);
  });

  check(
    "DisclosureCell：component 级不再渲染 chips/cross.note/文件列表",
    () => {
      const row = {
        ...plainRow,
        reviewBrief: { status: "已验证", visibleChange: "可见变化" },
        cross: { note: "CROSS_NOTE", files: ["src/a.ts", "src/b.ts"] },
      };
      const html = renderCell(row, "requirement", "component");
      assert.ok(!html.includes("disclosure-chip"));
      assert.ok(!html.includes("CROSS_NOTE"));
      assert.ok(!html.includes("依赖文件"));
    },
  );

  // ---- 反馈 9：紧凑引用 ----
  check("CompactRef：省略显示 + title 全文 + 点击复制语义", () => {
    const longPath = "src/very/deep/nested/component/ReallyLongFileName.tsx";
    const html = renderToStaticMarkup(
      createElement(CompactRef, { value: longPath }),
    );
    assert.ok(html.includes('title="' + longPath + '"'));
    assert.ok(html.includes("compact-ref"));
    assert.ok(html.includes('role="button"'));
    assert.ok(html.includes('tabindex="0"'));
    assert.ok(html.includes("复制完整引用"));
  });

  // ---- 反馈 7：多证据/多路径折叠 ----
  check("codePaths ≤2 内联；>2 默认折叠且展开后完整可读", () => {
    const inline = renderToStaticMarkup(rich.renderCodePaths(["a.ts", "b.ts"]));
    assert.ok(!inline.includes("<details"));
    assert.ok(inline.includes("a.ts"));
    const collapsed = renderToStaticMarkup(
      rich.renderCodePaths(["a.ts", "b.ts", "c.ts", "d.ts"]),
    );
    assert.ok(collapsed.includes("<details"));
    assert.ok(collapsed.includes("4 个路径"));
    for (const p of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      assert.ok(collapsed.includes(p), "折叠体仍含完整路径: " + p);
    }
  });

  check("deepDive codePaths >4 折叠；伪代码不被误折叠", () => {
    const dd = renderToStaticMarkup(
      rich.renderDeepDive({
        codePaths: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
        logic: ["L1"],
      }),
    );
    assert.ok(dd.includes("<details"));
    assert.ok(dd.includes("e.ts"));
    const withPseudo = renderToStaticMarkup(
      rich.renderOverviewCell(
        {
          ...plainRow,
          trd: { technical: { pseudoCode: "+ const x = 1;", codeLabel: "TS" } },
        },
        "change",
      ),
    );
    assert.ok(withPseudo.includes("trd-codeblk"));
    assert.ok(!withPseudo.includes("<details"));
  });

  // ---- 富数据不丢 + 旧 JSON 兼容 ----
  check("已有 rich 内容不丢：trd 结构完整渲染", () => {
    const row = {
      ...plainRow,
      trd: {
        productDesign: {
          positioning: "POS_LINE",
          sections: [
            { title: "S1", items: [{ label: "L", text: "ITEM_TEXT" }] },
          ],
        },
        technical: {
          modules: [{ id: "M1", name: "Mod", change: "new" }],
          techPoints: [{ title: "TP1", moduleId: "M1", bullets: ["B1"] }],
        },
        apiChange: {
          head: "HEAD_API",
          items: [{ beId: "BE-F1-001", code: "+ 1: x" }],
        },
      },
    };
    const req = renderToStaticMarkup(
      rich.renderOverviewCell(row, "requirement"),
    );
    const chg = renderToStaticMarkup(rich.renderOverviewCell(row, "change"));
    const api = renderToStaticMarkup(rich.renderOverviewCell(row, "api"));
    for (const marker of ["POS_LINE", "S1", "ITEM_TEXT"])
      assert.ok(req.includes(marker));
    for (const marker of ["M1", "Mod", "TP1", "B1"])
      assert.ok(chg.includes(marker));
    for (const marker of ["HEAD_API", "BE-F1-001"])
      assert.ok(api.includes(marker));
  });

  check("旧 JSON 兼容：sample 无新字段仍可解析渲染", () => {
    const sample = JSON.parse(
      readFileSync(
        new URL(
          "../src/samples/video-conversion-shooting-guide.review.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const payload = parseReviewSpec(sample);
    assert.ok(payload.data.components.length > 0);
    const row = payload.data.components[0].mapping[0];
    const html = renderToStaticMarkup(rich.renderOverviewCell(row, "change"));
    assert.ok(html.length > 0);
  });

  // ---- 类型校验 ----
  check("校验拒绝非法 changeType / api.changed", () => {
    const base = {
      title: "t",
      subtitle: "s",
      pages: [{ id: "default", label: "p", pageHtml: "<div></div>" }],
      components: [
        {
          id: "c1",
          label: "C1",
          mapping: [{ id: "r1", requirement: "q", change: "c", api: {} }],
        },
      ],
    };
    assert.throws(
      () =>
        parseReviewSpec({
          ...base,
          components: [
            {
              ...base.components[0],
              mapping: [
                {
                  ...base.components[0].mapping[0],
                  reviewBrief: { changeType: 123 },
                },
              ],
            },
          ],
        }),
      /changeType/,
    );
    assert.throws(
      () =>
        parseReviewSpec({
          ...base,
          components: [
            {
              ...base.components[0],
              mapping: [
                {
                  ...base.components[0].mapping[0],
                  api: { changed: "false" },
                },
              ],
            },
          ],
        }),
      /api.changed/,
    );
  });
} finally {
  await server.close();
}

// ---- 浏览器回归（BASE_URL 指定；配置即必须执行，失败非零） ----
const BASE_URL = process.env.BASE_URL;

/**
 * 浏览器选择按项目既有约定：系统 Chrome 优先（channel=chrome），
 * 再 chromium、CHROME_BIN，最后 bundled。
 */
async function launchBrowser() {
  const { chromium } = await import("playwright");
  const candidates = [
    { channel: "chrome" },
    { channel: "chromium" },
    ...(process.env.CHROME_BIN
      ? [{ executablePath: process.env.CHROME_BIN }]
      : []),
    {},
  ];
  let lastError;
  for (const options of candidates) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("chromium launch failed");
}

if (!BASE_URL) {
  console.log("SSR-only：未设置 BASE_URL，跳过浏览器回归（显式跳过，非失败）");
} else {
  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 8000,
    });
    const fixture = {
      slug: "presentation-regression",
      title: "展示回归",
      subtitle: "sub",
      pages: [
        {
          id: "default",
          label: "页面",
          pageHtml:
            '<div data-component-id="c1" data-review-target="c1"><div data-review-node-id="n1">N1</div></div>',
        },
      ],
      components: [
        {
          id: "c1",
          label: "组件一",
          kindLabel: "改动点",
          mapping: [
            {
              id: "no-api",
              title: "无接口改动行",
              requirement: "需求A",
              change: "改动A",
              api: { changed: false },
              reviewBrief: { changeType: "重构", status: "已验证" },
              codePaths: [
                "src/a.ts",
                "src/b.ts",
                "src/c.ts",
                "src/d.ts",
                "/workspace/" +
                  "unbroken".repeat(45) +
                  "/SomeDeepComponent.tsx",
              ],
              trd: {
                productDesign: { summary: "需求A摘要" },
                technical: {
                  summary: "改动A摘要",
                  techPoints: [{ title: "TP" }],
                },
              },
            },
            {
              id: "with-api",
              title: "有接口改动行",
              requirement: "需求B",
              change: "改动B",
              api: { summary: "API B" },
              trd: {
                apiChange: {
                  items: [
                    {
                      beId: "BE-F2-001",
                      code: "+ 1: string field_b;",
                      codeLabel: "Thrift",
                    },
                  ],
                },
              },
            },
          ],
          evidence: ["e1", "e2", "e3"],
        },
      ],
    };
    await page
      .locator("label.import-control")
      .filter({ hasText: "导入 review" })
      .locator("input[type=file]")
      .setInputFiles({
        name: "fixture.review.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
    await page
      .locator("h1.title")
      .filter({ hasText: "展示回归" })
      .waitFor({ state: "visible" });

    await checkAsync(
      "浏览器：总览 mixed 行保留 API 列，无 API 行单元格为空",
      async () => {
        const apiHeader = page.locator("th", { hasText: "API 摘要" });
        assert.ok((await apiHeader.count()) >= 1);
        const openApiButtons = page.locator("button.disclosure-open", {
          hasText: "查看接口",
        });
        assert.equal(await openApiButtons.count(), 1);
      },
    );

    // 组件详情入口固定来自 Overview/TRD 列表；画板根组件点击只保留展示。
    await page.locator('[data-component-id="c1"]').first().click();
    assert.equal(await page.locator(".component-details").count(), 0);
    await page.locator('[data-testid="overview-component-c1"]').first().click();
    await page.locator(".component-details").waitFor({ state: "visible" });

    const LONG_PATH =
      "/workspace/" + "unbroken".repeat(45) + "/SomeDeepComponent.tsx";
    const componentDetails = page.locator(".component-details");
    const codePathDetails = componentDetails.locator(
      "details.trd-code-paths-details",
    );

    await checkAsync("浏览器：长路径省略显示且 title 含全文", async () => {
      const ref = componentDetails.locator(".compact-ref", {
        hasText: "SomeDeepComponent",
      });
      assert.ok((await ref.count()) >= 1);
      const title = await ref.first().getAttribute("title");
      assert.ok(title.includes(LONG_PATH));
    });

    // 复制测试需要引用可见：先在当前可见组件详情内展开 codePaths 折叠区，
    // 测完恢复折叠，保证后续“默认折叠”断言成立。
    await codePathDetails.first().locator("summary").click();
    await componentDetails
      .getByRole("button", { name: `复制完整引用：${LONG_PATH}` })
      .first()
      .waitFor({ state: "visible" });
    await checkAsync(
      "浏览器：长引用获得键盘焦点后换行且不超出容器",
      async () => {
        const ref = componentDetails
          .getByRole("button", { name: `复制完整引用：${LONG_PATH}` })
          .first();
        await ref.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        const dimensions = await ref.evaluate((el) => ({
          focusVisible: el.matches(":focus-visible"),
          width: el.clientWidth,
          scrollWidth: el.scrollWidth,
          right: el.getBoundingClientRect().right,
          parentRight: el.parentElement.getBoundingClientRect().right,
        }));
        assert.ok(dimensions.focusVisible);
        assert.ok(dimensions.scrollWidth <= dimensions.width + 1);
        assert.ok(dimensions.right <= dimensions.parentRight + 1);
      },
    );
    try {
      await checkAsync(
        "浏览器：CompactRef 真实复制成功才显示已复制",
        async () => {
          const ref = componentDetails
            .getByRole("button", { name: `复制完整引用：${LONG_PATH}` })
            .first();
          await ref.click();
          await page
            .locator(".toast", { hasText: "已复制完整值" })
            .waitFor({ state: "visible", timeout: 3000 });
          const clipboard = await page.evaluate(() =>
            navigator.clipboard.readText(),
          );
          assert.equal(clipboard, LONG_PATH);
          assert.equal(await ref.textContent(), LONG_PATH);
          assert.equal(await ref.getAttribute("title"), LONG_PATH);
        },
      );

      await checkAsync(
        "浏览器：CompactRef 写入失败不伪成功，保留全文并提示",
        async () => {
          await page.evaluate(() => {
            navigator.clipboard.writeText = () =>
              Promise.reject(new Error("denied"));
          });
          const ref = componentDetails
            .getByRole("button", { name: `复制完整引用：${LONG_PATH}` })
            .first();
          await ref.click();
          await page
            .locator(".toast", { hasText: "复制失败，请手动选择复制" })
            .waitFor({ state: "visible", timeout: 3000 });
          const text = await ref.textContent();
          assert.equal(text, LONG_PATH, "失败时保留完整引用");
          assert.equal(await ref.getAttribute("title"), LONG_PATH);
        },
      );
    } finally {
      const open = await codePathDetails.first().evaluate((el) => el.open);
      if (open) await codePathDetails.first().locator("summary").click();
    }

    await checkAsync("浏览器：多路径默认折叠，展开后完整可读", async () => {
      const details = componentDetails.locator(
        "details.trd-code-paths-details",
      );
      assert.ok((await details.count()) >= 1);
      assert.equal(await details.first().evaluate((el) => el.open), false);
      await details.first().locator("summary").click();
      assert.ok(
        (await details.first().locator("text=SomeDeepComponent").count()) >= 1,
      );
      await details.first().locator("summary").click();
    });

    await checkAsync("浏览器：changeType 标签在行 header 只一次", async () => {
      assert.equal(
        await page
          .locator(".trd-bchip-change-type", { hasText: "重构" })
          .count(),
        1,
      );
    });

    await checkAsync("浏览器：证据默认折叠", async () => {
      const evidence = page.locator("details.evidence");
      assert.ok((await evidence.count()) >= 1);
      assert.equal(await evidence.first().evaluate((el) => el.open), false);
    });
  } catch (error) {
    failures.push("浏览器回归: " + error.message);
    console.error("FAIL - 浏览器回归: " + error.message);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log("test-presentation passed");
