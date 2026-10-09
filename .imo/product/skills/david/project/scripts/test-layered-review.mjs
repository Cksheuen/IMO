import assert from "node:assert/strict";
import { createServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const vite = await createServer({ server: { middlewareMode: true } });
try {
  const { resolveLayerMapping, resolveOverview } = await vite.ssrLoadModule(
    "/src/lib/reviewTree.ts",
  );
  const { OverviewDetails } = await vite.ssrLoadModule(
    "/src/components/details/OverviewDetails.tsx",
  );
  const { renderBullets } = await vite.ssrLoadModule(
    "/src/lib/richContent/trd.tsx",
  );
  const { hasOverviewApiSummary, getDisclosureSummary } =
    await vite.ssrLoadModule("/src/lib/disclosureContent.ts");
  const row = (id) => ({
    id,
    requirement: `Requirement ${id}`,
    change: `Change ${id}`,
    api: { fields: [{ name: "secret_detail", type: "string" }] },
  });
  const root = {
    id: "page-ui",
    label: "Page",
    mapping: [row("parent"), row("leaf"), row("grandchild"), row("peer")],
    children: [
      {
        id: "parent-node",
        label: "Parent",
        mappingIds: ["parent"],
        children: [
          {
            id: "leaf-node",
            label: "Leaf",
            mappingIds: ["leaf"],
            children: [
              {
                id: "grandchild-node",
                label: "Grandchild",
                mappingIds: ["grandchild"],
              },
            ],
          },
        ],
      },
      { id: "peer-node", label: "Peer", mappingIds: ["peer"] },
    ],
  };
  const ids = (rows) => rows.map((r) => r.id);
  assert.deepEqual(ids(resolveLayerMapping(root)), ["parent", "peer"]);
  assert.deepEqual(ids(resolveLayerMapping(root, root.children[0])), [
    "parent",
    "leaf",
  ]);
  assert.deepEqual(
    ids(resolveLayerMapping(root, root.children[0].children[0])),
    ["leaf", "grandchild"],
  );
  assert.deepEqual(
    ids(resolveLayerMapping({ ...root, children: undefined })),
    ids(root.mapping),
  );
  const legacy = {
    ...root,
    children: [{ ...root.children[0], mappingIds: ["parent", "leaf"] }],
  };
  assert.ok(ids(resolveLayerMapping(legacy)).includes("leaf"));
  const review = { title: "Layers", subtitle: "Review", components: [root] };
  assert.deepEqual(ids(resolveOverview(review).mapping), [
    "page-ui:parent",
    "page-ui:peer",
  ]);
  const explicit = [row("custom")];
  assert.equal(
    resolveOverview({ ...review, overview: { mapping: explicit } }).mapping,
    explicit,
  );
  assert.equal(hasOverviewApiSummary(root.mapping[0]), false);
  assert.equal(getDisclosureSummary(root.mapping[0], "api", "overview"), "");
  const render = () =>
    renderToStaticMarkup(
      createElement(OverviewDetails, { review, onComponentSelect() {} }),
    );
  const hidden = render();
  assert.ok(!hidden.includes("secret_detail"));
  assert.ok(!hidden.includes("API 摘要"));
  assert.ok(!hidden.includes("Requirement grandchild"));
  root.mapping[0].overviewSummary = { api: "Two proposed fields" };
  const visible = render();
  assert.ok(visible.includes("API 摘要"));
  assert.ok(visible.includes("Two proposed fields"));
  assert.ok(!visible.includes("secret_detail"));
  const bullets = renderToStaticMarkup(
    renderBullets([{ text: "Step", sub: ["Detail"] }], true),
  );
  assert.match(bullets, /^<ol/);
  assert.match(bullets, /<ol class="trd-sub-list">/);
  console.log(
    "[layered-review] recursive ownership, flat/custom compatibility, explicit shallow API summaries and nested numbered lists passed",
  );
} finally {
  await vite.close();
}
