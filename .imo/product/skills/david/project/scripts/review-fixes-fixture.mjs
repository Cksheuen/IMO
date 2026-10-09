const componentHtml = (
  id,
  height,
) => `<section class="rf-box" data-component-id="${id}" style="width:560px;height:${height}px">
  <h2 class="rf-root-title">Root ${id}</h2>
  <div data-review-node-id="node-${id}">
    <label><input type="checkbox" data-review-interaction-source="check-${id}" data-test-control="check-${id}"> checkbox ${id}</label>
    <details data-test-control="details-${id}"><summary data-review-interaction-source="details-${id}">Evidence ${id}</summary><p>Expanded evidence ${id}</p></details>
    <input data-test-control="text-${id}" value="original" aria-label="Text ${id}">
    <select data-test-control="select-${id}" aria-label="Select ${id}"><option value="one">One</option><option value="two">Two</option></select>
    <a href="#native-${id}" data-review-interaction-source="link-${id}">Native link ${id}</a>
    <form target="native-submit" action="/native-submit" method="get"><input name="q" value="submitted"><button type="submit" data-review-interaction-source="submit-${id}">Submit ${id}</button></form>
    <span data-api-field="legacy" data-review-target="legacy-${id}">Legacy field ${id}</span>
    <span data-api-field="contract">Contract field ${id}</span>
    <span data-api-field="other">Other field ${id}</span>
  </div>
</section>`;

export function fixture({
  height = 430,
  graph = false,
  title = "Review regression",
  status = "confirmed",
} = {}) {
  return {
    slug: "review-regression",
    title,
    subtitle: "Native actions, canvas geometry and contract imports",
    pages: [
      {
        id: "page",
        label: "Page",
        kind: "canvas",
        pageHtml: `<style>.rf-box{box-sizing:border-box;padding:20px;background:#eef3fa;border:1px solid #bbc; font:14px/1.5 sans-serif;color:#123}.rf-box input,.rf-box select,.rf-box button{font:inherit}.rf-box span{display:block;margin:8px 0}.rf-box details{margin:12px 0}.rf-board{display:flex;flex-direction:column;gap:20px}.rf-root-title{margin:0 0 12px}</style><div class="rf-board">${componentHtml("a", height)}${componentHtml("b", height)}</div><iframe name="native-submit" hidden></iframe>`,
        interactions: ["a", "b"].flatMap((id) =>
          ["check", "details", "link", "submit"].map((control) => ({
            source: `${control}-${id}`,
            trigger: "click",
            action: "highlight",
            targetNodeId: `node-${id}`,
          })),
        ),
        ...(graph
          ? {
              graph: {
                nodes: [
                  { id: "node-a", label: "Graph A" },
                  { id: "node-b", label: "Graph B" },
                ],
                edges: [{ from: "node-a", to: "node-b", kind: "data" }],
              },
            }
          : {}),
      },
    ],
    apiContracts: [
      {
        id: "contract-1",
        status,
        title: `${title} contract`,
        response: [
          { name: "contract", type: "string" },
          { name: "other", type: "string" },
        ],
      },
    ],
    components: ["a", "b"].map((id) => ({
      id,
      label: `Component ${id}`,
      mapping: [
        {
          id: `row-${id}`,
          requirement: `Requirement ${id}`,
          change: `Change ${id}`,
          api: {
            summary: "Contract and legacy fields",
            contractIds: ["contract-1"],
            fields: [
              {
                name: "legacy",
                target: `legacy-${id}`,
                meaning: "Legacy selection",
              },
            ],
          },
          trd: {
            technical: {
              summary: "Technical summary",
              code: "const result = true;",
              techPoints: [
                { title: "Details", detail: "Implementation evidence" },
              ],
            },
          },
        },
      ],
      children: [
        { id: `node-${id}`, label: `Node ${id}`, interaction: "highlight" },
      ],
    })),
  };
}
