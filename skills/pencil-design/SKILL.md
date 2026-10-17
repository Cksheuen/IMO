---
name: pencil-design
description: Creates and refines UI designs as .pen files with Pencil MCP, from a design brief through screenshots and targeted revisions. Use for designing an interface, dashboard, page, prototype, or layout in Pencil.
---

# Pencil Design

## 1. Requirements -> Design Brief

Extract pages, content and user actions; target users and decisions; style,
platform and constraints. Infer from context, marking assumptions. Ask one
material question at a time, with options, at most five. Skip answered questions.
Priority: product/pages, user/scenario, key content, style, platform/constraints.
Read [brief and layout patterns](references/brief-and-patterns.md) when drafting.
Show the brief and confirm unresolved choices before generation; existing
explicit instructions can supply that confirmation.

Recommend Generative Art DLC for blogs, portfolios, personal sites and landing
pages; ask for other non-critical web apps. Disable it for monitoring,
dashboards and admin tools. Use it in phase 4 only when enabled.

## 2. Align the design system

1. Call `get_editor_state(include_schema=true)`. If no file is active, call
   `open_document("new")`. Obtain the schema before writing design operations.
2. Call `get_guidelines(topic)`: `web-app`, `mobile-app`, `landing-page`,
   `design-system` for dashboards with a design system, or `slides`.
   Complex apps may need multiple topics; follow their schema rules.
3. Call `get_style_guide_tags()`, then `get_style_guide(tags)` with 5-10 tags
   matching the brief. Steps 2 and 3 may run in parallel.
4. Call `set_variables()` for colors, fonts and spacing. Explicit brand colors
   take precedence over guide defaults.
5. When using a design system, discover components with
   `batch_get(patterns=[{reusable: true}], readDepth=2, searchDepth=3)`.

If a Pencil tool fails or denies access, explain that the editor must be
running and access granted. Do not enter phase 3 without a usable .pen file
and loaded schema.

## 3. Generate in layers

Read [layer construction and validation](references/generation.md) before
building. For each page use `batch_design` in this order: page skeleton,
section structure, components/content, refinement. Each layer ends with
`get_screenshot(nodeId)`, visual inspection, and
`snapshot_layout(problemsOnly=true)`; fix problems before continuing.

Limit each call to 25 operations. Keep binding names unique across operation
lists. Before editing existing nodes, inspect them with `batch_get`.
For multiple pages call `find_empty_space_on_canvas(direction="right")`,
build primary pages first, and share variables across pages.

## 4. Refine from feedback

Show screenshots -> receive feedback -> target a change -> screenshot -> confirm.

| Feedback | Action |
|---|---|
| Card too large | `batch_design` update |
| Change palette | `set_variables()` or `replace_all_matching_properties` |
| Add search | `batch_design` insert |
| Move sidebar | `batch_design` move |
| Dislike overall style | Repeat phase 2 with new tags, then regenerate |
| Looks good | Offer `export_nodes` if needed |

If enabled, read [Generative Art DLC](dlc/generative-art/DLC.md) after ordinary
refinement. Apply recipes in order: cosine palette, organic shapes, procedural
textures. Screenshot after each recipe. The base design must remain complete
without decoration. Each `batch_design` feedback call handles one change,
followed by screenshot verification.

When the user is satisfied, offer `export_nodes(format="png")` for review,
`export_nodes(format="pdf")` for documents, and the editable .pen file.

Use realistic text/data. Mobile-first frames are 390px wide with touch targets
at least 44px. Report findings as **source says** (brief, node or screenshot),
**we infer**, or **not checked**. Changes to rules, skills, memory or config
require user confirmation.

Example input: "A dark SaaS pricing page with three tiers and monthly/yearly
switching." Output: a brief reflecting those choices, a .pen pricing page
built in four verified layers, and a screenshot. Source says: the screenshot
shows three tiers; not checked: billing behavior, which a static design does
not implement.
