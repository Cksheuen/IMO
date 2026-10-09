import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startViteServer } from "./browser-test-server.mjs";
import { startBrowserFeedbackService } from "./browser-feedback-service.mjs";
import { fixture } from "./review-fixes-fixture.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const service = await startBrowserFeedbackService();
const vite = await startViteServer(project);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(15000);
await service.attach(page);
const spec = fixture({ title: "Reading state" });
spec.pages[0].kind = "screen";
const root = spec.components[0];
root.mapping[0].title = "Parent feature";
root.mapping[0].requirement =
  "A substantial product requirement for reading and scrolling. ".repeat(55);
const childRow = (id) => ({
  id,
  title: id,
  requirement: `Requirement ${id}`,
  change: `Change ${id}`,
  api: {
    fields: [{ name: "contract", type: "string", target: "contract" }],
    contractIds: ["contract-1"],
  },
});
root.mapping.push(childRow("leaf-one"), childRow("leaf-two"), childRow("peer"));
root.children = [
  {
    id: "node-a",
    label: "Parent node",
    mappingIds: ["row-a"],
    children: [
      { id: "leaf-one-node", label: "Leaf one", mappingIds: ["leaf-one"] },
      { id: "leaf-two-node", label: "Leaf two", mappingIds: ["leaf-two"] },
    ],
  },
  {
    id: "peer-node",
    label: "Peer node",
    mappingIds: ["peer"],
    // This tests returning from an actual detail, not a redundant leaf layer.
    deepDive: { logic: ["Independent peer detail for reading-state recovery"] },
  },
];
spec.pages[0].pageHtml = spec.pages[0].pageHtml.replace(
  "<h2",
  '<span data-review-node-id="leaf-one-node">One</span><span data-review-node-id="leaf-two-node">Two</span><span data-review-node-id="peer-node">Peer</span><h2',
);
const feedback = {
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug: spec.slug,
  mode: "integrated",
  updatedAt: "2026-09-11T00:00:00Z",
  entries: [
    {
      id: "pending",
      category: "visual",
      suggestion: "Pending latest handling",
      createdAt: "2026-09-11T01:00:00Z",
      replies: [
        {
          id: "agent-new",
          author: "agent",
          body: "New result",
          createdAt: "2000-01-01T00:00:00Z",
        },
      ],
    },
    {
      id: "commented",
      category: "visual",
      suggestion: "User already commented",
      createdAt: "2026-09-11T02:00:00Z",
      replies: [
        {
          id: "agent-old",
          author: "agent",
          body: "Old result",
          createdAt: "2099-01-01T00:00:00Z",
        },
        {
          id: "user-new",
          body: "My current feedback",
          createdAt: "2000-01-01T00:00:00Z",
        },
      ],
    },
    {
      id: "resolved",
      category: "visual",
      suggestion: "Confirmed",
      status: "resolved",
      createdAt: "2026-09-11T03:00:00Z",
    },
  ],
};
service.seed(spec.slug, feedback);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const row = (id) => page.locator(`.inspector [data-trd-row="${id}"]`);
try {
  await page.goto(vite.baseUrl);
  await page
    .locator("label.import-control")
    .filter({ hasText: "导入 review" })
    .locator("input")
    .setInputFiles({
      name: "review.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  await page.locator("h1.title", { hasText: spec.title }).waitFor();
  await page.getByTestId("overview-component-a").click();
  await row("row-a").waitFor();
  assert.equal(await row("row-a").getAttribute("data-row-expanded"), "true");
  assert.equal(await row("peer").getAttribute("data-row-expanded"), "false");
  await row("peer").locator(".trd-row-toggle").click();
  assert.equal(await row("peer").getAttribute("data-row-expanded"), "true");
  const scrollBefore = await page
    .locator(".inspector-shell")
    .evaluate((el) => el.scrollTop);
  assert.ok(scrollBefore > 100);
  await row("peer").locator(".trd-feature-title").click();
  await page
    .getByTestId("david-breadcrumb")
    .locator("button")
    .filter({ hasText: "Peer node" })
    .waitFor();
  await page
    .getByTestId("david-breadcrumb")
    .locator("button")
    .filter({ hasText: "Component a" })
    .click();
  await page.waitForFunction(
    (expected) =>
      Math.abs(
        document.querySelector(".inspector-shell").scrollTop - expected,
      ) < 2,
    scrollBefore,
  );
  assert.equal(await row("peer").getAttribute("data-row-expanded"), "true");
  assert.equal(await row("row-a").getAttribute("data-row-expanded"), "true");
  await row("row-a").locator(".trd-feature-title").click();
  await page
    .getByTestId("david-breadcrumb")
    .locator("button")
    .filter({ hasText: "Parent node" })
    .waitFor();
  assert.equal(
    await row("leaf-one").getAttribute("data-row-expanded"),
    "false",
  );
  await row("leaf-one").locator(".trd-feature-title").click();
  assert.equal(await row("leaf-one").getAttribute("data-row-expanded"), "true");
  await row("leaf-one")
    .locator(".dv-contract-card > details > summary")
    .click();
  assert.ok(
    await row("leaf-one")
      .locator('.trd-cell-api [data-contract-field="contract"]')
      .isVisible(),
  );
  assert.equal(
    await page
      .getByTestId("david-breadcrumb")
      .locator("button")
      .filter({ hasText: "Leaf one" })
      .count(),
    0,
  );
  const parentScroll = await page
    .locator(".inspector-shell")
    .evaluate((el) => el.scrollTop);
  await page
    .getByTestId("david-breadcrumb")
    .locator("button")
    .filter({ hasText: "Component a" })
    .click();
  await row("row-a").locator(".trd-feature-title").click();
  await page.waitForFunction(
    (expected) =>
      Math.abs(
        document.querySelector(".inspector-shell").scrollTop - expected,
      ) < 2,
    parentScroll,
  );
  assert.equal(await row("leaf-one").getAttribute("data-row-expanded"), "true");

  await page
    .locator('[data-feedback-id="pending"] [data-review-status="pending"]')
    .waitFor();
  assert.equal(
    await page
      .locator(
        '[data-feedback-id="commented"] [data-review-status="commented"]',
      )
      .innerText(),
    "本轮已评论",
  );
  const appendReply = async (reply) => {
    const response = await fetch(
      `${service.baseUrl}/feedback/${spec.slug}/entries/commented/replies`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reply }),
      },
    );
    assert.equal(response.status, 200);
  };
  await page
    .locator('[data-feedback-id="commented"] .comment-rail-nav')
    .click();
  await page
    .locator('[data-feedback-id="commented"] textarea[aria-label="回复反馈"]')
    .fill("Unsubmitted draft survives polling");
  const readingBeforeRefresh = await page
    .locator(".inspector-shell")
    .evaluate((el) => el.scrollTop);
  const breadcrumbBeforeRefresh = await page
    .getByTestId("david-breadcrumb")
    .innerText();
  await appendReply({
    id: "agent-next",
    author: "agent",
    body: "Another result",
    createdAt: "1999-01-01T00:00:00Z",
  });
  await page
    .locator('[data-feedback-id="commented"] [data-review-status="pending"]')
    .waitFor();
  await appendReply({
    id: "user-next",
    body: "Reviewed the latest result",
    createdAt: "1998-01-01T00:00:00Z",
  });
  await page
    .locator('[data-feedback-id="commented"] [data-review-status="commented"]')
    .waitFor();
  assert.equal(
    await page
      .locator('[data-feedback-id="commented"] textarea[aria-label="回复反馈"]')
      .inputValue(),
    "Unsubmitted draft survives polling",
  );
  assert.equal(
    await page.getByTestId("david-breadcrumb").innerText(),
    breadcrumbBeforeRefresh,
  );
  assert.ok(
    Math.abs(
      (await page.locator(".inspector-shell").evaluate((el) => el.scrollTop)) -
        readingBeforeRefresh,
    ) < 2,
  );
  assert.equal(await row("leaf-one").getAttribute("data-row-expanded"), "true");
  await page.getByRole("button", { name: "待我复评", exact: true }).click();
  assert.equal(
    await page.locator('.comment-rail-row[data-feedback-id="pending"]').count(),
    1,
  );
  assert.equal(
    await page
      .locator('.comment-rail-row[data-feedback-id="commented"]')
      .count(),
    0,
  );
  await page.getByRole("button", { name: "待我复评", exact: true }).click();
  await page.getByRole("button", { name: "已解决", exact: true }).click();
  assert.equal(
    await page
      .locator('[data-feedback-id="resolved"] [data-review-status="confirmed"]')
      .innerText(),
    "已确认",
  );
  assert.deepEqual(errors, []);
  console.log(
    "[reading-state] first-only expansion, inline leaf contracts, per-level scroll/expansion restoration, append-order review labels and pending filter passed",
  );
} catch (error) {
  console.error(
    JSON.stringify(
      await page.evaluate(() => ({
        breadcrumb: document.querySelector('[data-testid="david-breadcrumb"]')
          ?.textContent,
        rows: [...document.querySelectorAll(".inspector [data-trd-row]")].map(
          (el) => ({
            id: el.getAttribute("data-trd-row"),
            expanded: el.getAttribute("data-row-expanded"),
          }),
        ),
        scroll: document.querySelector(".inspector-shell")?.scrollTop,
      })),
    ),
  );
  throw error;
} finally {
  await browser.close();
  await service.close();
  await vite.close();
}
