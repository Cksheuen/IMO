#!/usr/bin/env node
/**
 * change block（方案改动块）独立测试（纯 node，不依赖构建产物）。
 * - validateChangeBlock：合法块通过；add 带 before 拒绝；modify 缺侧拒绝；
 *   rationale 缺失/超长拒绝；code/text 二选一；未知字段拒绝；remove 规则
 * - parseReviewSpec：MappingRow.changeBlock 与 trd.techPoints[].changeBlock
 *   非法时拒绝、合法时通过（旧 spec 不受影响由 test-david-model.mjs 覆盖）
 * - examples/change-blocks.example.review.json 经 scripts/render-review.mjs
 *   渲染校验通过（输出到 os.tmpdir，绝不写 repo）
 * 模块加载走 node 的 TS type-stripping（reviewSpec.ts 对 changeModel.ts 使用
 * 显式 .ts 扩展导入）。
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const canonicalRoot = path.resolve(projectRoot, "..");
const renderScript = path.join(canonicalRoot, "scripts", "render-review.mjs");
const exampleSpec = path.join(
  canonicalRoot,
  "examples",
  "change-blocks.example.review.json",
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

const changeModelUrl = pathToFileURL(
  path.join(projectRoot, "src/lib/changeModel.ts"),
).href;
const reviewSpecUrl = pathToFileURL(
  path.join(projectRoot, "src/lib/reviewSpec.ts"),
).href;

const { validateChangeBlock, MAX_CHANGE_RATIONALE_LENGTH } = await import(
  changeModelUrl
);
const { parseReviewSpec } = await import(reviewSpecUrl);

// Deep clone without structuredClone (not in this package's eslint globals).
const clone = (value) => JSON.parse(JSON.stringify(value));

console.log("== validateChangeBlock 一致性规则 ==");

const validAdd = {
  kind: "add",
  rationale: "旧版没有优惠金额展示，客诉集中；新增优惠行提升转化。",
  after: { lang: "TSX", code: "<DiscountLine text={t} />" },
  impact: "仅只读展示",
};
const validModify = {
  kind: "modify",
  rationale: "埋点改为通用事件 + 参数，避免事件名线性增长。",
  before: { code: 'track("old")' },
  after: { code: 'track("new", { type })' },
};
const validRemove = {
  kind: "remove",
  rationale: "置灰 + 分组已表达过期态，角标属于重复标记。",
  before: { text: "<span class=tag>已过期</span>" },
};

check("合法 add 块通过", validateChangeBlock(validAdd).length === 0);
check("合法 modify 块通过", validateChangeBlock(validModify).length === 0);
const validMigration = { ...validModify, kind: "migrate" };
check(
  "迁移块需要来源与本地实现",
  validateChangeBlock(validMigration).length === 0,
);
check(
  "迁移缺来源被拒绝",
  validateChangeBlock({ ...validMigration, before: undefined }).length > 0,
);
check(
  "迁移缺本地实现被拒绝",
  validateChangeBlock({ ...validMigration, after: undefined }).length > 0,
);

check("合法 remove 块通过", validateChangeBlock(validRemove).length === 0);

const addWithBefore = {
  ...validAdd,
  before: { code: "old" },
};
const addErrors = validateChangeBlock(addWithBefore);
check(
  "add 带 before 被拒绝",
  addErrors.some((m) => m.includes("add") && m.includes("before")),
);

const addWithoutAfter = {
  kind: "add",
  rationale: "x",
};
check(
  "add 缺 after 被拒绝",
  validateChangeBlock(addWithoutAfter).some((m) => m.includes("after")),
);

const modifyMissingBefore = {
  kind: "modify",
  rationale: "x",
  after: { code: "new" },
};
check(
  "modify 缺 before 被拒绝",
  validateChangeBlock(modifyMissingBefore).some((m) => m.includes("before")),
);

const modifyMissingAfter = {
  kind: "modify",
  rationale: "x",
  before: { code: "old" },
};
check(
  "modify 缺 after 被拒绝",
  validateChangeBlock(modifyMissingAfter).some((m) => m.includes("after")),
);

const removeWithAfter = {
  ...validRemove,
  after: { code: "new" },
};
check(
  "remove 带 after 被拒绝",
  validateChangeBlock(removeWithAfter).some(
    (m) => m.includes("remove") && m.includes("after"),
  ),
);

const removeWithoutBefore = {
  kind: "remove",
  rationale: "x",
};
check(
  "remove 缺 before 被拒绝",
  validateChangeBlock(removeWithoutBefore).some((m) => m.includes("before")),
);

check(
  "非法 kind 被拒绝",
  validateChangeBlock({ kind: "fix", rationale: "x", after: { code: "a" } })
    .length > 0,
);

check(
  "缺失 rationale 被拒绝",
  validateChangeBlock({ kind: "add", after: { code: "a" } }).some((m) =>
    m.includes("rationale"),
  ),
);

check(
  "空白 rationale 被拒绝",
  validateChangeBlock({ kind: "add", rationale: "   ", after: { code: "a" } })
    .length > 0,
);

const overlong = {
  kind: "add",
  rationale: "x".repeat(MAX_CHANGE_RATIONALE_LENGTH + 1),
  after: { code: "a" },
};
const overlongErrors = validateChangeBlock(overlong);
check(
  `超长 rationale（>${MAX_CHANGE_RATIONALE_LENGTH}）被拒绝`,
  overlongErrors.some((m) => m.includes("rationale") && m.includes("800")),
);

check(
  "rationale 恰好 800 字符通过",
  validateChangeBlock({
    kind: "add",
    rationale: "x".repeat(MAX_CHANGE_RATIONALE_LENGTH),
    after: { code: "a" },
  }).length === 0,
);

check(
  "side 同时给 code 与 text 被拒绝",
  validateChangeBlock({
    kind: "add",
    rationale: "x",
    after: { code: "a", text: "b" },
  }).some((m) => m.includes("二选一")),
);

check(
  "side code/text 都不给被拒绝",
  validateChangeBlock({ kind: "add", rationale: "x", after: { lang: "TS" } })
    .length > 0,
);

check(
  "side 空白 code 被拒绝",
  validateChangeBlock({
    kind: "add",
    rationale: "x",
    after: { code: "  " },
  }).length > 0,
);

check(
  "未知顶层字段被拒绝",
  validateChangeBlock({
    kind: "add",
    rationale: "x",
    after: { code: "a" },
    reason: "typo",
  }).some((m) => m.includes("reason")),
);

check(
  "非对象块被拒绝",
  validateChangeBlock(null).length > 0 && validateChangeBlock("add").length > 0,
);

check(
  "impact 非字符串被拒绝",
  validateChangeBlock({
    kind: "add",
    rationale: "x",
    after: { code: "a" },
    impact: 123,
  }).some((m) => m.includes("impact")),
);

console.log("== parseReviewSpec 接入 ==");

const baseSpec = () => ({
  slug: "change-block-test",
  title: "Change block",
  subtitle: "改动块校验",
  pageHtml: '<div data-component-id="c1" data-review-node-id="n1">node</div>',
  components: [
    {
      id: "c1",
      label: "C1",
      mapping: [
        {
          id: "m1",
          requirement: "r",
          change: "c",
          api: { summary: "a" },
        },
      ],
      children: [{ id: "n1", label: "N1" }],
    },
  ],
});

const specWithValidBlock = () => {
  const spec = baseSpec();
  spec.components[0].mapping[0].changeBlock = clone(validModify);
  return spec;
};

let parsedWithBlock = false;
try {
  parseReviewSpec(specWithValidBlock());
  parsedWithBlock = true;
} catch (error) {
  console.error(String(error));
}
check("合法 MappingRow.changeBlock 通过 parseReviewSpec", parsedWithBlock);

const specWithBadBlock = () => {
  const spec = baseSpec();
  spec.components[0].mapping[0].changeBlock = clone(addWithBefore);
  return spec;
};

let rejectedBadRowBlock = false;
try {
  parseReviewSpec(specWithBadBlock());
} catch (error) {
  rejectedBadRowBlock =
    error instanceof Error && error.message.includes("changeBlock");
}
check(
  "非法 MappingRow.changeBlock 被 parseReviewSpec 拒绝",
  rejectedBadRowBlock,
);

const specWithTechPointBlock = () => {
  const spec = baseSpec();
  spec.components[0].mapping[0].trd = {
    technical: {
      techPoints: [
        {
          title: "TP1",
          changeBlock: clone(validAdd),
        },
      ],
    },
  };
  return spec;
};

let parsedTechPoint = false;
try {
  parseReviewSpec(specWithTechPointBlock());
  parsedTechPoint = true;
} catch (error) {
  console.error(String(error));
}
check(
  "合法 trd.technical.techPoints[].changeBlock 通过 parseReviewSpec",
  parsedTechPoint,
);

const specWithBadTechPointBlock = () => {
  const spec = baseSpec();
  spec.components[0].mapping[0].trd = {
    technical: {
      techPoints: [{ title: "TP1", changeBlock: clone(addWithBefore) }],
    },
  };
  return spec;
};

let rejectedBadTechPoint = false;
try {
  parseReviewSpec(specWithBadTechPointBlock());
} catch (error) {
  rejectedBadTechPoint =
    error instanceof Error && error.message.includes("trd.technical");
}
check(
  "非法 techPoints[].changeBlock 被 parseReviewSpec 拒绝",
  rejectedBadTechPoint,
);

console.log("== 示例 spec 渲染校验 ==");

check("示例 spec 文件存在", fs.existsSync(exampleSpec));

const tmpOutput = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "david-change-block-")),
  "change-blocks.html",
);
const render = spawnSync(
  process.execPath,
  [renderScript, exampleSpec, tmpOutput],
  { cwd: canonicalRoot, encoding: "utf8" },
);
check("render-review.mjs 退出码为 0", render.status === 0);
if (render.status !== 0) {
  console.error(render.stdout);
  console.error(render.stderr);
}
check("渲染产物已写入临时目录", fs.existsSync(tmpOutput));
if (fs.existsSync(tmpOutput)) {
  const html = fs.readFileSync(tmpOutput, "utf8");
  check(
    "产物内嵌 review 数据 JSON",
    html.includes('id="review-data"') && html.includes("changeBlock"),
  );
  // 产物写到 /tmp，不能落在 skill 目录内。
  assert.ok(
    !tmpOutput.startsWith(canonicalRoot),
    "render output must stay outside the skill directory",
  );
}

// 旧 spec（无 changeBlock）不被新校验影响：最小合法 spec 可解析。
let legacyParsed = false;
try {
  parseReviewSpec(baseSpec());
  legacyParsed = true;
} catch (error) {
  console.error(String(error));
}
check("无 changeBlock 的旧 spec 解析不受影响", legacyParsed);

// Every invalid fixture must agree across pure model, parser and both renderers,
// at both row and nested techPoint call sites.
const parityDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "david-change-parity-"),
);
const invalidBlocks = [
  { ...validAdd, after: { code: "  \n\t" } },
  { ...validAdd, after: { text: "  " } },
  { ...validAdd, after: { code: "ok", lang: "  " } },
  { ...validAdd, impact: "  " },
  { ...validAdd, impact: null },
  { ...validAdd, after: { code: "ok", text: "also" } },
  { ...validModify, before: undefined },
  { ...validAdd, before: { text: "forbidden" } },
  { ...validAdd, rationale: " " },
  { ...validAdd, rationale: "x".repeat(801) },
  { ...validAdd, unknown: true },
];
try {
  for (const [index, block] of [
    validAdd,
    validModify,
    validRemove,
    validMigration,
    ...invalidBlocks,
  ].entries()) {
    const expected = index < 4;
    assert.equal(validateChangeBlock(block).length === 0, expected);
    for (const nested of [false, true]) {
      const spec = baseSpec();
      const row = spec.components[0].mapping[0];
      if (nested)
        row.trd = {
          technical: { techPoints: [{ title: "point", changeBlock: block }] },
        };
      else row.changeBlock = block;
      let accepted = true;
      try {
        parseReviewSpec(spec);
      } catch {
        accepted = false;
      }
      assert.equal(
        accepted,
        expected,
        `parser fixture ${index}, nested=${nested}`,
      );
      const input = path.join(parityDir, "case.json");
      fs.writeFileSync(input, JSON.stringify(spec));
      for (const root of [projectRoot, canonicalRoot]) {
        const run = spawnSync(
          process.execPath,
          [
            path.join(root, "scripts/render-review.mjs"),
            input,
            path.join(parityDir, "case.html"),
          ],
          { encoding: "utf8" },
        );
        assert.equal(
          run.status === 0,
          expected,
          `renderer ${root} fixture ${index}, nested=${nested}: ${run.stderr}`,
        );
      }
    }
  }
  check("changeModel / parseReviewSpec / 两份 renderer 非法输入对账一致", true);
} finally {
  fs.rmSync(parityDir, { recursive: true, force: true });
}

console.log("");
if (failures.length > 0) {
  console.error(`change block 测试失败 ${failures.length} 项：`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log("全部通过");
