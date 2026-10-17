# Layer construction and validation

For each page, use `batch_design` in this order:

1. Page skeleton: one call, about 5-10 operations. Create the root frame
   (desktop 1440x900; mobile 390x844), header/navigation, sidebar, content,
   footer, background and base spacing.
2. Section structure: one or two calls, about 10-15 operations each. Add
   section containers, titles, dividers and grid/flow layouts.
3. Components and content: two to four calls, about 15-20 operations each.
   Add cards, charts, tables, forms, realistic text, icons and images.
   Use design-system components as `{type: "ref", ref: "ComponentName"}`
   where available, using the actual component reference from inspection.
4. Refinement: one or two calls. Adjust spacing, alignment and colors;
   add shadows, borders and interaction states supported by the schema.

After EVERY layer:

1. Call `get_screenshot(nodeId)` on the page frame.
2. Inspect overlap/alignment, missing brief content, and color/spacing/type
   consistency.
3. Call `snapshot_layout(problemsOnly=true)` for clipping and overflow.
4. Fix issues before starting the next layer.

Keep calls at most 25 operations, names unique across operation lists, and
read existing structure with `batch_get` before edits. For multiple pages,
use `find_empty_space_on_canvas(direction="right")`, generate primary pages
first, and reuse shared variables.
