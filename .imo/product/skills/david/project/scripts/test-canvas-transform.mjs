#!/usr/bin/env node
/**
 * 画板 pan/zoom 纯几何测试（src/lib/canvasGeometry.ts）。
 * 不依赖构建产物、不触碰 DOM：
 * - screenToCanvasPoint / canvasToScreenPoint 正反算互逆
 * - clampScale 钳制 0.25–3，NaN 回退 1
 * - zoomAtPoint 以光标为锚点缩放：锚点下的逻辑点不动；到达边界时 transform 不变
 * - fitTransform contain/width 模式与 padding/maxScale
 * - panBy 只平移不改 scale
 * - 点击/拖拽阈值 5px（边界恰好 5px 算点击）
 * - dock 多层复合：screenToContentPoint / zoomAtClientWithLayer / panWorldDelta
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const failures = [];
const check = (name, condition) => {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL - ${name}`);
  }
};

const approx = (actual, expected, eps = 1e-9) =>
  Number.isFinite(actual) && Math.abs(actual - expected) <= eps;

const mod = await import(
  pathToFileURL(path.join(projectRoot, "src/lib/canvasGeometry.ts")).href
);
const {
  screenToCanvasPoint,
  canvasToScreenPoint,
  clampScale,
  clamp,
  zoomAtPoint,
  fitTransform,
  panBy,
  exceedsClickThreshold,
  isClickGesture,
  canvasTransformCss,
  screenToContentPoint,
  zoomAtClientWithLayer,
  panWorldDelta,
  IDENTITY_CANVAS_TRANSFORM,
  MIN_CANVAS_SCALE,
  MAX_CANVAS_SCALE,
  CANVAS_CLICK_THRESHOLD_PX,
  CANVAS_FIT_PADDING,
} = mod;

// ── 常量契约 ────────────────────────────────────────────────────────────────
check("缩放下限为 0.25", MIN_CANVAS_SCALE === 0.25);
check("缩放上限为 3", MAX_CANVAS_SCALE === 3);
check("点击阈值为 5px", CANVAS_CLICK_THRESHOLD_PX === 5);
check("fit padding 常量存在且为 24", CANVAS_FIT_PADDING === 24);

// ── clamp / clampScale ──────────────────────────────────────────────────────
check("clamp 区间内不变", clamp(1.5, 0, 3) === 1.5);
check("clamp 低于下限", clamp(-1, 0, 3) === 0);
check("clamp 高于上限", clamp(9, 0, 3) === 3);
check("clampScale 区间内不变", clampScale(1.25) === 1.25);
check("clampScale 下限钳制", clampScale(0.01) === 0.25);
check("clampScale 上限钳制", clampScale(10) === 3);
check("clampScale NaN 回退 1", clampScale(Number.NaN) === 1);
check(
  "clampScale Infinity 非有限值同样回退 1（无效输入的安全缺省）",
  clampScale(Number.POSITIVE_INFINITY) === 1 &&
    clampScale(Number.NEGATIVE_INFINITY) === 1,
);
check("clampScale 支持自定义区间", clampScale(4, 0.5, 2) === 2);

// ── 坐标正反算互逆 ──────────────────────────────────────────────────────────
const t1 = { scale: 1.5, offsetX: 120, offsetY: -40 };
const screen = { x: 420, y: 260 };
const content = screenToCanvasPoint(screen, t1);
check(
  "screenToCanvasPoint 按 screen = content*scale + offset 反算",
  approx(content.x, (420 - 120) / 1.5) && approx(content.y, (260 + 40) / 1.5),
);
const back = canvasToScreenPoint(content, t1);
check(
  "canvasToScreenPoint 与 screenToCanvasPoint 互逆",
  approx(back.x, screen.x) && approx(back.y, screen.y),
);
const origin = canvasToScreenPoint({ x: 0, y: 0 }, t1);
check("逻辑原点映射到 offset", approx(origin.x, 120) && approx(origin.y, -40));
const identityRound = screenToCanvasPoint(
  canvasToScreenPoint({ x: 33.5, y: -7.25 }, IDENTITY_CANVAS_TRANSFORM),
  IDENTITY_CANVAS_TRANSFORM,
);
check(
  "identity transform 正反算为自身",
  approx(identityRound.x, 33.5) && approx(identityRound.y, -7.25),
);

// ── panBy ───────────────────────────────────────────────────────────────────
const panned = panBy(t1, 15, -30);
check(
  "panBy 只平移 offset",
  panned.scale === 1.5 && panned.offsetX === 135 && panned.offsetY === -70,
);
check(
  "panBy 不修改输入对象",
  t1.offsetX === 120 && t1.offsetY === -40 && t1.scale === 1.5,
);
const zeroPan = panBy(IDENTITY_CANVAS_TRANSFORM, 0, 0);
check(
  "panBy(0,0) 保持 identity",
  zeroPan.scale === 1 && zeroPan.offsetX === 0 && zeroPan.offsetY === 0,
);

// ── zoomAtPoint：光标锚点缩放 ───────────────────────────────────────────────
const t2 = { scale: 1, offsetX: 0, offsetY: 0 };
const anchor = { x: 200, y: 100 };
const before = screenToCanvasPoint(anchor, t2);
const zoomed = zoomAtPoint(t2, anchor, 2);
const after = screenToCanvasPoint(anchor, zoomed);
check(
  "放大 2 倍后锚点下的逻辑点不变",
  approx(zoomed.scale, 2) &&
    approx(after.x, before.x) &&
    approx(after.y, before.y),
);
check(
  "放大 2 倍锚点 offset 为 anchor - content*scale",
  approx(zoomed.offsetX, 200 - 200 * 2) &&
    approx(zoomed.offsetY, 100 - 100 * 2),
);
const shrunk = zoomAtPoint(
  { scale: 2, offsetX: -200, offsetY: -100 },
  anchor,
  0.5,
);
const shrunkContent = screenToCanvasPoint(anchor, shrunk);
check(
  "缩小时锚点逻辑点仍不动",
  approx(shrunk.scale, 1) &&
    approx(shrunkContent.x, before.x) &&
    approx(shrunkContent.y, before.y),
);
const nonCenterAnchor = { x: 37, y: 91 };
const z2 = zoomAtPoint(t2, nonCenterAnchor, 1.25);
const c2 = screenToCanvasPoint(nonCenterAnchor, z2);
const c2b = screenToCanvasPoint(nonCenterAnchor, t2);
check(
  "非中心锚点缩放保持光标下内容固定",
  approx(c2.x, c2b.x) && approx(c2.y, c2b.y),
);
check(
  "非法 factor（0 / NaN / 负数）返回原 transform",
  zoomAtPoint(t2, anchor, 0) === t2 &&
    zoomAtPoint(t2, anchor, Number.NaN) === t2 &&
    zoomAtPoint(t2, anchor, -1) === t2,
);
const atMax = { scale: MAX_CANVAS_SCALE, offsetX: 30, offsetY: 60 };
check(
  "已在上限再放大返回同一对象（无锚点漂移）",
  zoomAtPoint(atMax, anchor, 1.5) === atMax,
);
const atMin = { scale: MIN_CANVAS_SCALE, offsetX: 30, offsetY: 60 };
check("已在下限再缩小返回同一对象", zoomAtPoint(atMin, anchor, 0.5) === atMin);
const overZoom = zoomAtPoint(t2, anchor, 100);
check("超大 factor 钳到上限 3", approx(overZoom.scale, 3));
const overAnchorContent = screenToCanvasPoint(anchor, overZoom);
check(
  "钳到上限时锚点逻辑点仍不动",
  approx(overAnchorContent.x, before.x) &&
    approx(overAnchorContent.y, before.y),
);

// ── 点击/拖拽阈值判定 ───────────────────────────────────────────────────────
check("位移 0 视为点击", isClickGesture(0, 0) && !exceedsClickThreshold(0, 0));
check(
  "位移恰好 5px（阈值边界）视为点击",
  isClickGesture(5, 0) && !exceedsClickThreshold(5, 0),
);
check(
  "对角位移 sqrt(3^2+4^2)=5 恰好阈值视为点击",
  isClickGesture(3, 4) && !exceedsClickThreshold(3, 4),
);
check(
  "位移 5.01px 进入拖拽（点击须被抑制）",
  !isClickGesture(5.01, 0) && exceedsClickThreshold(5.01, 0),
);
check(
  "对角位移 4/4（≈5.66）进入拖拽",
  !isClickGesture(4, 4) && exceedsClickThreshold(4, 4),
);
check(
  "负方向位移按距离判定",
  !isClickGesture(-6, 0) && exceedsClickThreshold(-6, 0),
);

// ── fitTransform ────────────────────────────────────────────────────────────
const viewport = { width: 1000, height: 800 };
const fitContain = fitTransform({ width: 500, height: 400 }, viewport, {
  maxScale: 1,
});
check(
  "contain 小内容不放大（maxScale=1），居中",
  approx(fitContain.scale, 1) &&
    approx(fitContain.offsetX, 250) &&
    approx(fitContain.offsetY, 200),
);
const fitWide = fitTransform({ width: 2000, height: 500 }, viewport, {
  maxScale: 1,
});
check(
  "contain 宽内容按宽度等比缩小并垂直居中",
  approx(fitWide.scale, 0.5) &&
    approx(fitWide.offsetX, 0) &&
    approx(fitWide.offsetY, 275),
);
const fitTall = fitTransform({ width: 500, height: 2000 }, viewport, {
  maxScale: 1,
});
check(
  "contain 高内容按高度等比缩小并水平居中",
  approx(fitTall.scale, 0.4) &&
    approx(fitTall.offsetX, 400) &&
    approx(fitTall.offsetY, 0),
);
const fitPad = fitTransform({ width: 2000, height: 500 }, viewport, {
  maxScale: 1,
  padding: 100,
});
check("contain 尊重 padding（可用宽 800）", approx(fitPad.scale, 0.4));
const fitWidth = fitTransform({ width: 2000, height: 4000 }, viewport, {
  mode: "width",
  maxScale: 1,
});
check(
  "width 模式只匹配宽度（0.5），高内容不被压扁",
  approx(fitWidth.scale, 0.5) && approx(fitWidth.offsetX, 0),
);
const fitDegenerate = fitTransform({ width: 0, height: 0 }, viewport);
check(
  "零尺寸内容回退 identity",
  fitDegenerate.scale === 1 &&
    fitDegenerate.offsetX === 0 &&
    fitDegenerate.offsetY === 0,
);

// ── canvasTransformCss ──────────────────────────────────────────────────────
check(
  "CSS transform 字符串格式",
  canvasTransformCss({ scale: 1.5, offsetX: 10, offsetY: -20 }) ===
    "translate(10px, -20px) scale(1.5)",
);

// ── dock 多层复合 ─────────────────────────────────────────────────────────
// transform 模型：dock 盒带 outerScale；user transform；innerScale=1。
const layerOuter = {
  outerScale: 0.8,
  innerScale: 1,
  scrollLeft: 0,
  scrollTop: 0,
};
const dockRect = { left: 40, top: 60 };
const ut = { scale: 1.25, offsetX: 100, offsetY: 50 };
const clientPt = { x: 540, y: 310 };
// screen(relative) = -scroll + outer*(offset + scale*inner*content)
// relative = 500, 250; content = (500 - 0.8*100)/(0.8*1.25) = 420/1 = 420
const lp = screenToContentPoint(clientPt, dockRect, ut, layerOuter);
check(
  "screenToContentPoint 穿过 outer FLIP 层反算",
  approx(lp.x, 420) && approx(lp.y, (250 - 0.8 * 50) / (0.8 * 1.25)),
);
// viewport 模型：outer=1, inner=0.62, scroll=(20,10)
const layerViewport = {
  outerScale: 1,
  innerScale: 0.62,
  scrollLeft: 20,
  scrollTop: 10,
};
const uv = { scale: 1, offsetX: 0, offsetY: 0 };
const vp = screenToContentPoint(
  { x: 100, y: 100 },
  { left: 0, top: 0 },
  uv,
  layerViewport,
);
// (100 + 20)/(1*1*0.62)
check(
  "screenToContentPoint viewport 模型计入 innerScale 与 scroll",
  approx(vp.x, 120 / 0.62) && approx(vp.y, 110 / 0.62),
);
// All scales and native scroll composed at once; scrolling occurs inside the
// outer transform, so both forward projection and inverse scale the scroll.
const combinedLayer = {
  outerScale: 0.8,
  innerScale: 0.62,
  scrollLeft: 31,
  scrollTop: 67,
};
const naturalPoint = { x: 213, y: 145 };
const combinedClient = {
  x:
    dockRect.left + 0.8 * (-31 + ut.offsetX + ut.scale * 0.62 * naturalPoint.x),
  y: dockRect.top + 0.8 * (-67 + ut.offsetY + ut.scale * 0.62 * naturalPoint.y),
};
const inverseCombined = screenToContentPoint(
  combinedClient,
  dockRect,
  ut,
  combinedLayer,
);
check(
  "outer/inner/user/scroll 完整复合反算",
  approx(inverseCombined.x, naturalPoint.x) &&
    approx(inverseCombined.y, naturalPoint.y),
);
const zoomCombined = zoomAtClientWithLayer(
  ut,
  combinedClient,
  dockRect,
  combinedLayer,
  1.3,
);
const inverseZoomed = screenToContentPoint(
  combinedClient,
  dockRect,
  zoomCombined,
  combinedLayer,
);
check(
  "完整复合模型缩放锚点不漂移",
  approx(inverseZoomed.x, naturalPoint.x) &&
    approx(inverseZoomed.y, naturalPoint.y),
);

const nextZoom = zoomAtClientWithLayer(ut, clientPt, dockRect, layerOuter, 2);
check("dock 锚点缩放在 0.25–3 内（1.25*2=2.5）", approx(nextZoom.scale, 2.5));
const fixedContent = screenToContentPoint(
  clientPt,
  dockRect,
  nextZoom,
  layerOuter,
);
check(
  "dock 锚点缩放后光标下逻辑点不动",
  approx(fixedContent.x, lp.x) && approx(fixedContent.y, lp.y),
);
const zoomInvalid = zoomAtClientWithLayer(
  ut,
  clientPt,
  dockRect,
  layerOuter,
  0,
);
check("dock 非法缩放 factor 返回原对象", zoomInvalid === ut);
const zoomCapped = zoomAtClientWithLayer(
  { scale: 2, offsetX: 0, offsetY: 0 },
  clientPt,
  dockRect,
  layerOuter,
  3,
);
check("dock 缩放置顶 3（2*3=6 钳制）", approx(zoomCapped.scale, 3));
const cappedContent = screenToContentPoint(
  clientPt,
  dockRect,
  zoomCapped,
  layerOuter,
);
const beforeCap = screenToContentPoint(
  clientPt,
  dockRect,
  { scale: 2, offsetX: 0, offsetY: 0 },
  layerOuter,
);
check(
  "dock 钳制边界锚点逻辑点仍不动",
  approx(cappedContent.x, beforeCap.x) && approx(cappedContent.y, beforeCap.y),
);
const worldDelta = panWorldDelta(80, -40, { outerScale: 0.8 });
check(
  "panWorldDelta 按 outer 层换算世界位移",
  approx(worldDelta.x, 100) && approx(worldDelta.y, -50),
);
const worldDeltaDefault = panWorldDelta(30, 30);
check(
  "panWorldDelta 缺省 outer=1",
  approx(worldDeltaDefault.x, 30) && approx(worldDeltaDefault.y, 30),
);
// 缺省 layer 时复合函数等价单层
const simpleContent = screenToContentPoint(
  { x: 300, y: 200 },
  { left: 0, top: 0 },
  { scale: 2, offsetX: 100, offsetY: 0 },
);
check(
  "screenToContentPoint 无 layer 时等价 screenToCanvasPoint",
  approx(simpleContent.x, 100) && approx(simpleContent.y, 100),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");
