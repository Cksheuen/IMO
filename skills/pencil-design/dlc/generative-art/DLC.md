---
name: generative-art
description: Adds procedural colors, shapes and textures during Pencil design refinement. Use when enabled for a blog, portfolio, personal site or landing page; omit for monitoring, admin and data-analysis tools where decoration impedes reading.
---

# Generative Art DLC

Apply during phase 4 after the base design works. Blogs, personal sites,
portfolios and marketing pages benefit from distinctive visuals. SaaS pricing
and non-critical web apps are optional; monitoring, admin and analytics skip
this extension. The mathematical references below explain the techniques;
visual quality still requires screenshot checks.

## Recipe 1: Cosine palette

Reference: https://iquilezles.org/articles/palettes/

`color(t) = a + b * cos(2*pi*(c*t+d))`, with RGB vectors a, b, c, d.
Smooth variation is not a guarantee of readable contrast.

| Preset | a | b | c | d | Mood / use |
|---|---|---|---|---|---|
| warm-sunset | .5,.5,.5 | .5,.5,.5 | 1,1,1 | 0,.33,.67 | Warm, classic; blogs, food, travel |
| cool-ocean | .5,.5,.5 | .5,.5,.5 | 1,1,1 | .30,.20,.20 | Calm, deep; technical blogs, portfolios |
| vibrant-neon | .5,.5,.5 | .5,.5,.5 | 1,1,.5 | .80,.90,.30 | Energetic; music, games, creative portfolios |
| muted-earth | .5,.5,.5 | .3,.3,.3 | .6,.6,.6 | .05,.15,.25 | Natural; crafts, literature |
| pastel-dream | .8,.8,.8 | .2,.2,.2 | 1,1,1 | 0,.10,.20 | Soft; lifestyle, fashion, weddings |

Steps:
1. Choose the preset closest to the brief's mood; adjust parameters if needed.
2. Sample t at 0, .15, .30, .50, .70, .85, 1 for seven colors.
3. Assign these samples respectively to background, surface, muted, primary,
   accent, secondary, highlight.
4. Check text/background contrast >=4.5:1. Adjust background or text when
   necessary; the palette itself does not ensure accessibility.
5. Apply hex values through `set_variables()`.

Calculate on the agent side, then pass the resulting hex values to the tool:

```javascript
function cosinePalette(t, a, b, c, d) {
  return a.map((v, i) => Math.max(0, Math.min(1,
    v + b[i] * Math.cos(2 * Math.PI * (c[i] * t + d[i])))));
}
function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
```

## Recipe 2: Organic shapes

References: https://iquilezles.org/articles/distfunctions2d/
and https://iquilezles.org/articles/smin/

Signed distance functions (SDFs) describe circles, ellipses, polygons, stars
and hearts. Smooth minimum blends shapes; parameter k sets blend thickness.
Subtracting a radius r rounds an SDF shape.

| Decoration | Construction | Placement |
|---|---|---|
| Blob | Smooth minimum of 2-3 circles | Hero background, section accent |
| Wave divider | Sines at different frequencies | Between sections |
| Organic border | SDF contour | Feature card or CTA |
| Scattered shapes | Distributed small shapes | Empty space |

Steps:
1. Identify decoration areas from the brief: hero, separators, empty space.
2. Choose a shape from the table.
3. Calculate contour points and convert them to SVG path data.
4. Insert path nodes using `batch_design`, with accent/highlight colors from
   recipe 1, following the loaded schema.
5. Set decoration opacity around .1-.3 so content remains dominant.
6. Screenshot and check that decoration does not obscure content or reading flow.

Blob algorithm:
- Generate 2-4 control circles with centers (cx, cy) and radius r.
- Distribute centers within the target area, spacing r*.8 to r*1.5.
- Sample a grid every 2-4px; calculate each circle's SDF at each point.
- Combine distances with smooth_min(k=20-40); distance <=0 is inside.
- Fit Bezier curves through boundary points near distance 0 for the SVG path.

Wave algorithm:
`y(x) = A1*sin(f1*x+p1) + A2*sin(f2*x+p2)`.
Use A1=8-15px, f1=.01-.02; A2=3-6px, f2=.03-.05; random phases.
Sample x every 4px across the canvas; output `M x0,y0 C ...` cubic Beziers.

## Recipe 3: Procedural textures

References: https://iquilezles.org/articles/fbm/,
https://iquilezles.org/articles/warp/,
https://iquilezles.org/articles/voronoise/

Noise layers at different frequencies provide non-repeating texture.
FBM gives cloud/smoke effects for hero backgrounds; domain warp gives liquid
or marble for panels/cards; Voronoi gives cells/cracks for decorative
sections; simple random noise gives a film-grain overlay.

Pencil is static, so bake the effect into supported elements:
- A, gradient overlays (simplest): 2-4 translucent linear/radial gradients,
  different angles/colors, blended by opacity. Approximate cloud/warp effects.
- B, SVG patterns: calculate sampled dots/lines and insert SVG paths. Useful
  for Voronoi/geometric effects; needs more `batch_design` operations.
- C, external generation: generate PNG/SVG with a script and import through
  the image operation in `batch_design`. Flexible but more complex.

Steps for strategy A:
1. Identify texture frames, usually hero or large empty areas.
2. Choose background/surface base colors from recipe 1.
3. Create 2-4 full-size child frames inside the target frame:
   - Layer 1: radial accent (.08 opacity) to transparent, center upper-right.
   - Layer 2: linear secondary (.05) to transparent, 135 degrees.
   - Layer 3: radial highlight (.06) to transparent, center lower-left.
   - Optional layer 4: noise texture color at .02-.03 opacity.
4. Screenshot and adjust until the texture is subtle and content stays readable.

| Parameter | Minimum | Suggested | Maximum | Beyond range |
|---|---|---|---|---|
| Gradient layers | 2 | 3 | 4 | More can clutter and slow rendering |
| Layer opacity | .02 | .05-.08 | .15 | Too conspicuous |
| Combined opacity | .05 | .10-.20 | .30 | Can reduce readability |
| Gradient radius | 30% | 50-70% | 100% | Too concentrated or too diffuse |

## Combinations and checks

Minimal blog: recipe 1. Creative portfolio: 1+2+3. Product landing page:
1+3. Technical blog: 1+2 (wave). Resume page: 1+2 (blob).

Example input: "Give this portfolio a subtle ocean feel."
Output: cool-ocean tokens, a translucent hero blob and light gradients;
screenshot after each recipe. Label findings **source says** (screenshot/node),
**we infer**, or **not checked**. Confirm before changing rules, skills, memory
or config.

Check no decoration covers text, text contrast stays >=4.5:1, opacity stays
within the suggested range, and removing decoration leaves a complete design.

Further reading when needed: palette parameters at
https://iquilezles.org/articles/palettes/; additional shapes at
https://iquilezles.org/articles/distfunctions2d/; blending at
https://iquilezles.org/articles/smin/; detailed textures at the recipe 3
links; smoother transitions at https://iquilezles.org/articles/smoothsteps/.
