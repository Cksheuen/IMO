#!/usr/bin/env node
/**
 * render-review 端到端 smoke + 多 agent 协作协议验证（HARD-GATE 30）。
 *
 * 数据源：examples/collaboration-canvas-review.review.json —— 唯一同时覆盖
 * collaboration 清单、component `source` 契约、`canvas` 页/节点的真实示例。
 *
 * PART A · render-review E2E：用真实模板（project/dist/template.html）把示例渲染
 * 成 HTML，断言产物结构、锚点注入、data-review-data 数据与渲染统计。
 * PART B · 协作协议：对示例数据跑 ownership / patch-only / 上下文裁剪 /
 * 冲突 + lease 合并四项协议断言（project/scripts/collaborationProtocol.mjs）。
 * PART C · 裁剪上下文独立渲染：对裁剪后的 agent 上下文再跑一次 render-review，
 * 证明「只带相关上下文的 agent」拿到的 spec 仍能独立渲染。
 *
 * 不写 repo：渲染产物落 mkdtemp 临时目录。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  acquireLease,
  clone,
  mergeOwnerPatches,
  ownerOf,
  parseManifest,
  patchOwned,
  trimContextFor,
  validateOwnershipRefs,
  verifyLease,
} from "./collaborationProtocol.mjs";

const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const projectRoot = path.join(skillRoot, "project");
const renderScript = path.join(projectRoot, "scripts", "render-review.mjs");
const fixturePath = path.join(
  skillRoot,
  "examples",
  "collaboration-canvas-review.review.json",
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

const renderAndValidate = (specPath) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "david-render-smoke-"));
  const outHtml = path.join(outDir, "render.review.html");
  const result = spawnSync(
    process.execPath,
    [renderScript, specPath, outHtml],
    { encoding: "utf8" },
  );
  const rendered = fs.existsSync(outHtml);
  const html = rendered ? fs.readFileSync(outHtml, "utf8") : "";
  return { result, rendered, html };
};

const extractReviewData = (html) => {
  const m = html.match(
    /<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/,
  );
  return m ? JSON.parse(m[1]) : null;
};

// ── 数据装载 ────────────────────────────────────────────────────────────────
const spec = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const { parseReviewSpec } = await import(
  pathToFileURL(path.join(projectRoot, "src/lib/reviewSpec.ts")).href
);
let parsedReview;
try {
  parsedReview = parseReviewSpec(spec);
  check("fixture 通过 parseReviewSpec（schema 校验）", true);
} catch (e) {
  check("fixture 通过 parseReviewSpec（schema 校验）", false);
  console.error(e);
  process.exit(1);
}

const base = clone(parsedReview.data);

// ════════════════════════════════════════════════════════════════════════════
console.log("== PART A · render-review 端到端 smoke ==");
{
  const { result, rendered, html } = renderAndValidate(fixturePath);
  check("render-review.mjs 退出码 0", result.status === 0);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  const stats = JSON.parse(result.stdout);
  check("渲染统计 components==2", stats.components === 2);
  check("渲染统计 pages==2", stats.pages === 2);
  check(
    "字段 target/field 绑定 > 0",
    stats.fieldBindings >= 1 && stats.targetBindings >= 1,
  );
  check(
    "mapping-id 注入 ≥ 2（节点锚点拿到 hover 契约）",
    stats.mappingIdInjections >= 2,
  );
  check("产物 HTML 生成", rendered);
  if (rendered) {
    check("正文含 p-screen 页面锚点", html.includes('data-page-id="p-screen"'));
    check(
      "正文注入 hover mapping 契约",
      html.includes('data-review-mapping-id="publish-form:m1"'),
    );
    check("正文含转义后的评审标题", html.includes("创作者发布流重构"));
    const data = extractReviewData(html);
    check("data-review-data 可解析", data !== null);
    if (data) {
      const pages = data.pages ?? [];
      check("data-review-data 含 2 页", pages.length === 2);
      check(
        "canvas 页 kind=canvas 保留",
        pages.some((p) => p.id === "p-canvas" && p.kind === "canvas"),
      );
      check(
        "component.source 契约进产物（component/css-art）",
        data.components?.[0]?.source?.kind === "component" &&
          data.components?.[1]?.source?.kind === "css-art",
      );
      check(
        "canvas 节点 canvas=true 进产物",
        data.components?.[1]?.children?.[0]?.canvas === true,
      );
      // 决策：collaboration 是「起草期」元数据，运行时页面不消费，不入产物。
      check(
        "collaboration 清单不入渲染页面（起草期元数据）",
        data.collaboration === undefined && spec.collaboration !== undefined,
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log("== PART B · 多 agent 协作协议验证（HARD-GATE 30）==");

// 1) ownership ───────────────────────────────────────────────────────────────
{
  const { pages, nodes } = parseManifest(base);
  check(
    "ownership: p-screen→agent-a / p-canvas→agent-b",
    ownerOf(base, "p-screen") === "agent-a" &&
      ownerOf(base, "p-canvas") === "agent-b",
  );
  check(
    "ownership: agent-a 节点集（表单/标题/表格）",
    ownerOf(base, "publish-form") === "agent-a" &&
      ownerOf(base, "field-title") === "agent-a" &&
      ownerOf(base, "table-upload") === "agent-a",
  );
  check(
    "ownership: agent-b 节点集（画板/草稿/审核）",
    ownerOf(base, "publish-flow-board") === "agent-b" &&
      ownerOf(base, "state-draft") === "agent-b" &&
      ownerOf(base, "state-review") === "agent-b",
  );
  check(
    "ownership: 未声明节点按「无主」（表单填充/保存失败）",
    ownerOf(base, "draft-form-fill") === null &&
      ownerOf(base, "draft-save-fail") === null,
  );
  const refs = validateOwnershipRefs(base);
  check(
    "ownership: 清单不悬空（pageId/node ref 均命中真实元素）",
    refs.ok && refs.dangling.length === 0,
  );
  check(
    "ownership: 清单声明密度（2 page + 6 node）",
    pages.size === 2 && nodes.size === 6,
  );
}

// 2) patch-only ──────────────────────────────────────────────────────────────
{
  const patch = {
    ref: "field-title",
    path: ["label"],
    value: "标题输入（改造）",
  };
  const res = patchOwned(base, "agent-a", "agent-a", patch);
  check("patch-only: 自有节点最小 patch 成功", res.status === "ok");
  check(
    "patch-only: 邻居 owner（agent-b）作用域未被触碰",
    res.status === "ok" && res.patchOnly.allForeignKept,
  );
  check(
    "patch-only: 锚点清单不变",
    res.status === "ok" && res.patchOnly.anchorsKept,
  );
  let afterLabel = null;
  try {
    const reparsed = parseReviewSpec(res.spec);
    const loc = reparsed.data.components
      .flatMap((c) => c.children ?? [])
      .find((n) => n.id === "field-title");
    afterLabel = loc?.label;
    check("patch-only: patch 后 parseReviewSpec 通过", true);
  } catch (e) {
    check("patch-only: patch 后 parseReviewSpec 通过", false);
    console.error(e.message);
  }
  check(
    "patch-only: 目标叶子被改（field-title.label）",
    afterLabel === "标题输入（改造）",
  );

  const foreign = patchOwned(base, "agent-b", "agent-b", {
    ref: "field-title",
    path: ["label"],
    value: "agent-b 篡改",
  });
  check(
    "patch-only: 非 owner 改他人节点被拒（foreign-owner）",
    foreign.status === "conflict" && foreign.reason === "foreign-owner",
  );
  check(
    "patch-only: 拒绝时对方编辑原样保留",
    JSON.stringify(foreign.spec) === JSON.stringify(base),
  );

  const rewrite = patchOwned(base, "agent-a", "agent-a", {
    ref: "p-screen",
    path: ["pageHtml"],
    value: "<div>整页重写，锚点全丢</div>",
  });
  check(
    "patch-only: 整页重写被拒（锚点缺失）",
    rewrite.status === "rejected-not-patch-only",
  );
}

// 3) 上下文裁剪 ──────────────────────────────────────────────────────────────
{
  const triA = trimContextFor(base, "agent-a");
  check(
    "裁剪: agent-a 只带自有页面",
    (triA.pages ?? []).map((p) => p.id).join() === "p-screen",
  );
  check(
    "裁剪: agent-a 组件子树只剩 publish-form",
    (triA.components ?? []).map((c) => c.id).join() === "publish-form",
  );
  const triAChildIds = (triA.components?.[0]?.children ?? [])
    .map((n) => n.id)
    .sort()
    .join();
  check(
    "裁剪: agent-a 保留自有节点，裁剪掉对方节点",
    triAChildIds === ["field-title", "table-upload"].sort().join() &&
      !JSON.stringify(triA).includes("state-review"),
  );
  try {
    parseReviewSpec(triA);
    check("裁剪: agent-a 上下文可独立 parseReviewSpec", true);
  } catch (e) {
    check("裁剪: agent-a 上下文可独立 parseReviewSpec", false);
    console.error(e.message);
  }

  const triB = trimContextFor(base, "agent-b");
  check(
    "裁剪: agent-b 只带自有页面",
    (triB.pages ?? []).map((p) => p.id).join() === "p-canvas",
  );
  check(
    "裁剪: agent-b 组件子树只剩发布状态机",
    (triB.components ?? []).map((c) => c.id).join() === "publish-flow-board",
  );
  check(
    "裁剪: 自有节点完整子树保留（含无主子节点）",
    (triB.components?.[0]?.children ?? [])
      .map((n) => n.id)
      .sort()
      .join() === ["state-draft", "state-review"].sort().join() &&
      triB.components?.[0]?.children?.[0]?.children?.length === 2,
  );
  try {
    parseReviewSpec(triB);
    check("裁剪: agent-b 上下文可独立 parseReviewSpec", true);
  } catch (e) {
    check("裁剪: agent-b 上下文可独立 parseReviewSpec", false);
    console.error(e.message);
  }

  // M2：跨页 ownership——owned 节点锚点在非自有页时，裁剪必须保留锚点所在页。
  const cross = clone(base);
  // 把 state-review（锚点在 p-canvas，页归 agent-b）移交给 agent-a，
  // 形成「节点归 agent-a、所在页归 agent-b」的跨页 ownership。
  cross.collaboration = {
    ...cross.collaboration,
    nodes: cross.collaboration.nodes.map((n) =>
      n.ref === "state-review" ? { ...n, owner: "agent-a" } : n,
    ),
  };
  const triCross = trimContextFor(cross, "agent-a");
  const crossPageIds = (triCross.pages ?? []).map((p) => p.id).sort();
  check(
    "裁剪(M2): 跨页 ownership 时保留锚点所在页（p-screen + p-canvas）",
    crossPageIds.join() === ["p-canvas", "p-screen"].sort().join(),
  );
  let crossOk = false;
  try {
    parseReviewSpec(triCross);
    crossOk = true;
  } catch (e) {
    console.error(e.message);
  }
  check("裁剪(M2): 跨页 ownership 裁剪结果仍可 parseReviewSpec", crossOk);
}

// 4) 冲突 + lease 合并协议 ───────────────────────────────────────────────────
{
  const patchA = {
    agent: "agent-a",
    ref: "field-title",
    path: ["label"],
    value: "标题输入（A 改）",
  };
  const patchB = {
    agent: "agent-b",
    ref: "state-review",
    path: ["label"],
    value: "审核态（挂接审核队列）",
  };

  // M1：lease 从 manifest 生效——patchOwned 缺省 holder 取自 collaboration.lease.holder。
  const fromManifest = patchOwned(base, "agent-b", null, {
    ref: "state-review",
    path: ["label"],
    value: "非 holder 提交",
  });
  check(
    "lease(M1): 缺省从 manifest 取 holder，非 holder 提交 own 节点也被拒",
    fromManifest.status === "conflict" && fromManifest.reason === "no-lease",
  );

  // 多 owner 合入：逐段 acquireLease 交接，只有当前 holder 能提交。
  const leasedA = acquireLease(base, "agent-a");
  const step1 = mergeOwnerPatches(leasedA, [patchA]);
  check(
    "合并: holder(agent-a) 提交自有 patch 成功",
    step1.applied.length === 1 && step1.conflicts.length === 0,
  );
  const blocked = mergeOwnerPatches(step1.spec, [patchB]);
  check(
    "合并: 非 holder(agent-b) 在 agent-a 租约下提交被拒（no-lease）",
    blocked.conflicts.length === 1 &&
      blocked.conflicts[0].reason === "no-lease" &&
      blocked.applied.length === 0,
  );
  const handoff = acquireLease(step1.spec, "agent-b");
  const step2 = mergeOwnerPatches(handoff, [patchB]);
  check(
    "合并: 租约交接(acquireLease→agent-b)后提交成功",
    step2.applied.length === 1 && step2.conflicts.length === 0,
  );
  const mergedText = JSON.stringify(step2.spec);
  check(
    "合并: 双方编辑都被保留（无覆盖）",
    mergedText.includes("标题输入（A 改）") &&
      mergedText.includes("审核态（挂接审核队列）"),
  );
  let mergedOk = false;
  try {
    parseReviewSpec(step2.spec);
    mergedOk = true;
  } catch (e) {
    console.error(e.message);
  }
  check("合并: 合并结果 parseReviewSpec 通过", mergedOk);

  // 冲突：非 owner 篡改，即使持有租约仍被 ownership 拒绝（agent-c 先 acquire 持约）。
  const wrongOwner = mergeOwnerPatches(acquireLease(base, "agent-c"), [
    {
      agent: "agent-c",
      ref: "field-title",
      path: ["label"],
      value: "agent-c 覆盖",
    },
  ]);
  check(
    "冲突: 非 owner 篡改被拒（foreign-owner），不静默合并",
    wrongOwner.conflicts.length === 1 &&
      wrongOwner.conflicts[0].reason === "foreign-owner" &&
      wrongOwner.applied.length === 0,
  );
  check(
    "冲突: 冲突后保留对方编辑（agent-a 原 label 未丢）",
    JSON.stringify(wrongOwner.spec).includes("标题输入") &&
      !JSON.stringify(wrongOwner.spec).includes("agent-c 覆盖"),
  );

  // M3：未知 ref 稳定拒绝，不抛异常。
  let unknownCrash = false;
  let unknownRes;
  try {
    unknownRes = mergeOwnerPatches(acquireLease(base, "agent-a"), [
      { agent: "agent-a", ref: "nope-not-exist", path: ["label"], value: "x" },
    ]);
  } catch {
    unknownCrash = true;
  }
  check(
    "M3: 未知 ref 合入不崩溃，稳定返回 unknown-ref 冲突",
    !unknownCrash &&
      unknownRes.conflicts.length === 1 &&
      unknownRes.conflicts[0].reason === "unknown-ref" &&
      unknownRes.applied.length === 0,
  );

  const noLease = patchOwned(base, "agent-c", "agent-a", {
    ref: "draft-form-fill",
    path: ["label"],
    value: "无租约写无主节点",
  });
  check(
    "lease: 非持有人写无主节点被拒（no-lease）",
    noLease.status === "conflict" && noLease.reason === "no-lease",
  );

  const holdClaim = patchOwned(base, "agent-a", "agent-a", {
    ref: "draft-form-fill",
    path: ["label"],
    value: "表单填充（A 取得 ownership）",
  });
  check(
    "lease: 持有人按「先取得 ownership」改写无主节点",
    holdClaim.status === "ok" && holdClaim.ownershipRecorded === true,
  );
  check(
    "lease: 无主节点登记进 collaboration.nodes",
    (holdClaim.spec.collaboration?.nodes ?? []).some(
      (n) => n.ref === "draft-form-fill" && n.owner === "agent-a",
    ),
  );

  check(
    "lease: 合法租约（holder 为声明 owner、心跳 ISO）",
    verifyLease(base).ok,
  );
  const badLeaseEmpty = {
    ...clone(base),
    collaboration: {
      ...base.collaboration,
      lease: { holder: "", heartbeatAt: "bad" },
    },
  };
  const badLeaseGhost = {
    ...clone(base),
    collaboration: {
      ...base.collaboration,
      lease: { holder: "ghost", heartbeatAt: "2026-09-08T03:00:00Z" },
    },
  };
  check(
    "lease: 非法租约（空 holder / 坏心跳 / holder 非 owner）拒绝",
    !verifyLease(badLeaseEmpty).ok && !verifyLease(badLeaseGhost).ok,
  );
}

// ════════════════════════════════════════════════════════════════════════════
console.log("== PART C · 裁剪后的 agent 上下文独立渲染（E2E）==");
{
  const triA = trimContextFor(base, "agent-a");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "david-trim-render-"));
  const tmp = path.join(tmpDir, "trim-a.review.json");
  fs.writeFileSync(tmp, JSON.stringify(triA, null, 2));
  const { result, rendered } = renderAndValidate(tmp);
  check("裁剪上下文 render-review 退出码 0", result.status === 0);
  check("裁剪上下文可独立渲染出 HTML", rendered);
  if (result.status !== 0) console.error(result.stderr || result.stdout);
}

if (failures.length > 0) {
  console.error(`\n共 ${failures.length} 项失败:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nrender-review E2E + 协作协议验证全部通过");
process.exit(0);
