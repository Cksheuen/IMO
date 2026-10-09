#!/usr/bin/env node
/**
 * 多页面 / 画板交互状态机（pageInteraction.ts）纯函数测试。
 * 不依赖构建产物、不触碰 DOM：
 * - resolveDetailKind 默认严格向后兼容（auto→highlight，显式 drilldown/highlight 优先）
 * - canvas 只在节点声明或 magnifyOnComplex 阈值达标时出现
 * - prev/next 边界无 wrap；返回沿 history 栈回退一层
 * - 键盘映射（ArrowLeft/Right/Escape）与状态数据校验
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

const mod = await import(
  pathToFileURL(path.join(projectRoot, "src/lib/pageInteraction.ts")).href
);
const {
  resolveDetailKind,
  createPageViewState,
  nextPage,
  prevPage,
  enterDetail,
  leaveDetail,
  back,
  pageTransition,
  validatePageViewState,
  DETAIL_KINDS,
} = mod;

const node = (over = {}) => ({
  interaction: "auto",
  ...over,
});

// ── resolveDetailKind：向后兼容 + 复杂度/canvas ─────────────────────────────
check(
  "auto 缺省 → highlight（与旧交互一致）",
  resolveDetailKind(node()) === "highlight",
);
check(
  "显式 drilldown 保持 drilldown",
  resolveDetailKind(node({ interaction: "drilldown" })) === "drilldown",
);
check(
  "显式 highlight 保持 highlight",
  resolveDetailKind(node({ interaction: "highlight" })) === "highlight",
);
check(
  "声明 canvas → canvas",
  resolveDetailKind(node({ canvas: true })) === "canvas",
);
check(
  "canvas 优先级高于 auto 但低于显式 drilldown",
  resolveDetailKind(node({ canvas: true, interaction: "drilldown" })) ===
    "drilldown",
);
check(
  "默认（无 magnifyOnComplex）复杂子树仍 highlight，不改变旧行为",
  resolveDetailKind(
    node({
      children: [
        node(),
        node({ children: [node(), node({ children: [node()] })] }),
      ],
    }),
  ) === "highlight",
);
check(
  "magnifyOnComplex 深度达标 → canvas（等比放大）",
  resolveDetailKind(
    node({
      children: [
        node({
          children: [node({ children: [node({ children: [node()] })] })],
        }),
      ],
    }),
    { magnifyOnComplex: true, complexDepth: 4 },
  ) === "canvas",
);
check(
  "magnifyOnComplex 深度不足仍 highlight",
  resolveDetailKind(node({ children: [node({ children: [node()] })] }), {
    magnifyOnComplex: true,
    complexDepth: 4,
  }) === "highlight",
);

// ── create / nav 边界 ───────────────────────────────────────────────────────
const state3 = createPageViewState(3);
check(
  "初始态 pageIndex 0 / detail null",
  state3.pageIndex === 0 && state3.detail === null,
);
check("pageCount 0 或非法 → 归 0", createPageViewState(0).pageIndex === 0);
check(
  "initialPageIndex 越界 → clamp",
  createPageViewState(3, 99).pageIndex === 2,
);

{
  const next = nextPage(state3, 3);
  check(
    "nextPage → pageIndex 1 且 detail 清空",
    next?.pageIndex === 1 && next?.detail === null,
  );
  const last = createPageViewState(3, 2);
  check("末页 nextPage → no-op（无 wrap）", nextPage(last, 3) === undefined);
  check(
    "单页 nextPage → no-op",
    nextPage(createPageViewState(1), 1) === undefined,
  );
  check("首页 prevPage → no-op", prevPage(state3, 3) === undefined);
  const prev = prevPage(createPageViewState(3, 1), 3);
  check("prevPage → pageIndex 0", prev?.pageIndex === 0);
}

// ── enter/leave/back 返回语义 ────────────────────────────────────────────────
{
  const entered = enterDetail(state3, "canvas", "c1", 0);
  check("enterDetail depth 归一 ≥1 的整数", entered.detail?.depth === 1);
  check("enterDetail 压入 history", entered.history.length === 1);
  const entered2 = enterDetail(entered, "highlight", "n1", 2);
  check("二次 enter 栈继续增长", entered2.history.length === 2);
  const left = leaveDetail(entered2);
  check(
    "leaveDetail 回退一层到上一次入口",
    left.detail?.ref === "c1" && left.history.length === 1,
  );
  const rootBack = back(left);
  check(
    "back 回到 pageIndex 0 / detail null",
    rootBack.detail === null && rootBack.pageIndex === 0,
  );
  check(
    "leaveDetail 在 detail=null 时保持原态",
    leaveDetail(state3) === state3,
  );
  check(
    "enterDetail 空 ref 保持原态",
    enterDetail(state3, "canvas", "  ") === state3,
  );
}

// ── 键盘映射 ─────────────────────────────────────────────────────────────────
{
  const next = pageTransition(state3, "ArrowRight", 3);
  check(
    "ArrowRight → 下一页 handled",
    next.handled && next.state.pageIndex === 1,
  );
  const atEdge = pageTransition(createPageViewState(1), "ArrowRight", 1);
  check("单页 ArrowRight 边界 → handled=false", atEdge.handled === false);
  const prev = pageTransition(createPageViewState(3, 1), "ArrowLeft", 3);
  check(
    "ArrowLeft → 上一页 handled",
    prev.handled && prev.state.pageIndex === 0,
  );
  const entered = enterDetail(state3, "drilldown", "n1");
  const esc = pageTransition(entered, "Escape", 3);
  check(
    "Escape 详情中 → 返回上层 handled",
    esc.handled && esc.state.detail === null,
  );
  const escRoot = pageTransition(state3, "Escape", 3);
  check("Escape 根层 → handled=false", escRoot.handled === false);
  const unknown = pageTransition(state3, "ArrowUp", 3);
  check("未知键 → handled=false", unknown.handled === false);
}

// ── 状态数据校验 ─────────────────────────────────────────────────────────────
{
  const valid = createPageViewState(2, 1);
  check("合法状态通过", validatePageViewState(valid, 2) === true);
  check(
    "非法 pageIndex（越界）拒绝",
    validatePageViewState({ ...valid, pageIndex: 5 }, 2) === false,
  );
  check(
    "非法 pageIndex（小数）拒绝",
    validatePageViewState({ ...valid, pageIndex: 0.5 }, 2) === false,
  );
  check(
    "非法 detail.kind 拒绝",
    validatePageViewState(
      { ...valid, detail: { kind: "zoom", ref: "a", depth: 1 } },
      2,
    ) === false,
  );
  check(
    "非法 detail.ref 空串拒绝",
    validatePageViewState(
      { ...valid, detail: { kind: "canvas", ref: "", depth: 1 } },
      2,
    ) === false,
  );
  check(
    "非法 detail.depth=0 拒绝",
    validatePageViewState(
      { ...valid, detail: { kind: "canvas", ref: "a", depth: 0 } },
      2,
    ) === false,
  );
  check(
    "非法 history 行拒绝",
    validatePageViewState(
      { ...valid, history: [{ pageIndex: -1, detail: null }] },
      2,
    ) === false,
  );
  check(
    "详情报文合法通过",
    validatePageViewState(enterDetail(valid, "canvas", "a", 2), 2) === true,
  );
}

check("DETAIL_KINDS 覆盖三种形态", DETAIL_KINDS.length === 3);

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");
