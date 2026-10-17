# Design Brief and layout patterns

Capture the product surface (pages, components, data, actions), usage context
(who, when, which decision), and constraints/taste (style, colors, platform,
accessibility). A monitoring request may suggest a dense desktop layout;
record inferred theme choices as assumptions, not user requirements.

```yaml
design_brief:
  product_type: web-app # or mobile-app, landing-page
  pages:
    - name: Dashboard
      key_content: [live metrics, alerts, topology]
      priority: primary
    - name: Alert details
      key_content: [metric chart, timeline, related events]
      priority: secondary
  target_user: Operations engineer investigating production alerts
  style:
    mood: dark, minimal, data-dense
    reference: shadcn/ui
  platform: desktop-first
  constraints:
    - WCAG AA contrast
    - Existing brand blue '#2563EB'
  assumptions_made:
    - Dark theme inferred from monitoring context
```

Confirm the brief's unresolved choices before continuing.

Starting layouts, adjusted to the brief:

- Dashboard: 200-240px side navigation; top search/user menu; 2-4 metric
  columns; charts; data table or activity feed.
- Landing page: hero/title/CTA; social proof/logos; three-column features;
  testimonials; pricing; footer links.
- CRUD app: top navigation/breadcrumbs; searchable/filterable list/table;
  detail panel/page; create/edit form in a modal or page.
- Mobile app: bottom tabs; cards; pull-to-refresh list design; bottom action
  sheet; status-bar safe areas.
