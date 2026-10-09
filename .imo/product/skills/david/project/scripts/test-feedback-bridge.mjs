#!/usr/bin/env node
/**
 * David feedback 桥接 CLI（david-feedback.mjs）纯 Node 测试，无浏览器。
 * - pull：tmpdir 造 `<slug>-feedback.json` 与 `<slug>-feedback (1).json`，
 *   取 mtime 最新；支持剥掉 JSON 前说明行
 * - stale：文件 mtime 早于传入 snapshot 时间 → 显式 stale 警告
 * - diff：已处理且无新意见的 open 条目不出现；同 id 新用户回复出现
 * - reply：同输入两次产出相同确定性 id；delta 的 entry base 与源逐字一致；merge 不抛错
 * - verify：缺失 agent 回复时非零退出
 * 全程 mkdtemp + finally rmSync，绝不写 repo。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(projectRoot, "scripts", "david-feedback.mjs");

const failures = [];
const check = (name, condition) => {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL - ${name}`);
  }
};

const sha256Hex = (input) =>
  crypto.createHash("sha256").update(input).digest("hex");

const runCli = (args, cwd) =>
  spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", cwd });

const entry = (id, extra = {}) => ({
  id,
  category: "visual",
  suggestion: `建议 ${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const doc = (slug, entries, updatedAt = "2026-09-02T00:00:00.000Z") => ({
  schema: "david-feedback/v1",
  schemaVersion: 1,
  slug,
  updatedAt,
  mode: "integrated",
  entries,
});

const userReply = (id, body, createdAt = "2026-09-02T00:00:00.000Z") => ({
  id,
  body,
  createdAt,
});
const agentReply = (id, body, createdAt = "2026-09-02T00:00:00.000Z") => ({
  id,
  body,
  createdAt,
  author: "agent",
});

const idsOf = (items) => new Set(items.map((item) => item.id));

const testPull = (workdir) => {
  console.log(
    "== pull --from downloads 取 mtime 最新（覆盖 Chrome (1) 去重命名）==",
  );
  const dl = path.join(workdir, "Downloads");
  fs.mkdirSync(dl);
  const slug = "proj-alpha";

  const older = doc(slug, [entry("e1")], "2026-09-01T00:00:00.000Z");
  const newer = doc(
    slug,
    [entry("e1"), entry("e2")],
    "2026-09-02T12:00:00.000Z",
  );
  const f1 = path.join(dl, `${slug}-feedback.json`);
  const f2 = path.join(dl, `${slug}-feedback (1).json`);
  // f1 带头部说明行，验证 preamble 剥离逻辑
  fs.writeFileSync(
    f1,
    `以下是 ${slug} 的评审反馈 JSON：\n${JSON.stringify(older)}`,
  );
  fs.writeFileSync(f2, JSON.stringify(newer));
  // 显式设置 mtime，保证顺序确定
  fs.utimesSync(
    f1,
    new Date("2026-09-01T10:00:00Z"),
    new Date("2026-09-01T10:00:00Z"),
  );
  fs.utimesSync(
    f2,
    new Date("2026-09-03T10:00:00Z"),
    new Date("2026-09-03T10:00:00Z"),
  );

  const pulled = runCli(
    ["pull", "--slug", slug, "--from", "downloads", "--dir", dl],
    workdir,
  );
  check("pull 成功且退出码 0", pulled.status === 0);
  if (pulled.status !== 0) {
    console.error(pulled.stderr);
    return;
  }
  const output = JSON.parse(pulled.stdout);
  check("pull 选中 mtime 最新文件", output.path === f2);
  check(
    "pull path/sha256/slug 出处信息齐全",
    output.path && output.sha256.length === 64 && output.slug === slug,
  );
  check(
    "pull 计数正确",
    output.entries === 2 &&
      output.replies === 0 &&
      output.updatedAt === newer.updatedAt,
  );
  check(
    "pull doc 通过 parseFeedback 严格校验",
    Array.isArray(output.doc.entries),
  );
};

const testPullStale = (workdir) => {
  console.log("== pull stale：文件 mtime 早于 snapshot 时间 → 显式警告 ==");
  const dl = path.join(workdir, "Downloads-stale");
  fs.mkdirSync(dl);
  const slug = "proj-stale";
  const staleDoc = doc(slug, [entry("e1")], "2026-09-01T00:00:00.000Z");
  const file = path.join(dl, `${slug}-feedback.json`);
  fs.writeFileSync(file, JSON.stringify(staleDoc));
  fs.utimesSync(
    file,
    new Date("2026-08-30T00:00:00Z"),
    new Date("2026-08-30T00:00:00Z"),
  );

  const snapshotPath = path.join(workdir, "pull-snapshot.json");
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify({ updatedAt: "2026-09-05T00:00:00.000Z" }),
  );

  const pulled = runCli(
    [
      "pull",
      "--slug",
      slug,
      "--from",
      "downloads",
      "--dir",
      dl,
      "--snapshot",
      snapshotPath,
    ],
    workdir,
  );
  check(
    "stale：退出码 0 且输出 stale=true",
    pulled.status === 0 && JSON.parse(pulled.stdout).stale === true,
  );
  check("stale：stderr 有显式 STALE 警告", /WARN STALE/.test(pulled.stderr));

  // 反向：非 stale 时不标记
  const freshDoc = doc(slug, [entry("e1")], "2026-09-06T00:00:00.000Z");
  fs.writeFileSync(file, JSON.stringify(freshDoc));
  fs.utimesSync(
    file,
    new Date("2026-09-07T00:00:00Z"),
    new Date("2026-09-07T00:00:00Z"),
  );
  const fresh = runCli(
    [
      "pull",
      "--slug",
      slug,
      "--from",
      "downloads",
      "--dir",
      dl,
      "--snapshot",
      snapshotPath,
    ],
    workdir,
  );
  check(
    "非 stale：不标记 stale",
    fresh.status === 0 && JSON.parse(fresh.stdout).stale === undefined,
  );
};

const testDiff = (workdir) => {
  console.log("== diff 增量口径 ==");
  const base = doc(
    "proj-diff",
    [
      // 已处理：有 agent 结论，头尾不变 → 不输出
      {
        ...entry("handled-open", { status: "open" }),
        replies: [
          userReply("u1", "看看"),
          agentReply("g1", "已处理", "2026-09-01T09:00:00.000Z"),
        ],
      },
      // 永远 open、有用户意见但无 agent 结论；前后无变化 → 不输出（避免反复处理）
      {
        ...entry("noop", { status: "open" }),
        replies: [userReply("u0", "第一条")],
      },
      // suggestion 将变更
      { ...entry("changed", { suggestion: "旧建议" }) },
      // 无 agent 结论的条目，即将新增用户回复
      { ...entry("orphan"), replies: [userReply("u2", "第一条")] },
      // 有 agent 结论的条目，即将新增用户回复
      {
        ...entry("new-user-reply"),
        replies: [
          userReply("u-old", "老意见"),
          agentReply("g9", "已回复", "2026-09-02T09:00:00.000Z"),
        ],
      },
    ],
    "2026-09-01T00:00:00.000Z",
  );
  const head = doc(
    "proj-diff",
    [
      {
        ...entry("handled-open", { status: "open" }),
        replies: [
          userReply("u1", "看看"),
          agentReply("g1", "已处理", "2026-09-01T09:00:00.000Z"),
        ],
      },
      {
        ...entry("noop", { status: "open" }),
        replies: [userReply("u0", "第一条")],
      },
      { ...entry("changed", { suggestion: "新建议" }) },
      {
        ...entry("orphan"),
        replies: [
          userReply("u2", "第一条"),
          userReply("u3", "补充", "2026-09-02T08:00:00.000Z"),
        ],
      },
      {
        ...entry("new-user-reply"),
        replies: [
          userReply("u-old", "老意见"),
          agentReply("g9", "已回复", "2026-09-02T09:00:00.000Z"),
          userReply("u9b", "被回复后追问", "2026-09-03T08:00:00.000Z"),
        ],
      },
      {
        ...entry("new-entry"),
        replies: [userReply("u9", "全新反馈", "2026-09-03T09:00:00.000Z")],
      },
    ],
    "2026-09-03T00:00:00.000Z",
  );
  const basePath = path.join(workdir, "diff-base.json");
  const headPath = path.join(workdir, "diff-head.json");
  fs.writeFileSync(basePath, JSON.stringify(base));
  fs.writeFileSync(headPath, JSON.stringify(head));

  const result = runCli(
    ["diff", "--base", basePath, "--head", headPath],
    workdir,
  );
  check("diff 退出码 0", result.status === 0);
  if (result.status !== 0) {
    console.error(result.stderr);
    return;
  }
  const output = JSON.parse(result.stdout);
  check("diff 新增 entry 出现", idsOf(output.newEntries).has("new-entry"));
  check(
    "diff suggestion 变更出现",
    output.suggestionChanged.some(
      (item) =>
        item.id === "changed" &&
        item.base === "旧建议" &&
        item.head === "新建议",
    ),
  );
  check(
    "diff 同 id 新用户回复出现",
    idsOf(output.newUserReplies).has("orphan") &&
      idsOf(output.newUserReplies).has("new-user-reply"),
  );
  check(
    "diff 无 agent 结论的新意见进 needsAgentConclusion",
    output.needsAgentConclusion.includes("orphan"),
  );
  check(
    "diff 有 agent 结论的新意见不进 needsAgentConclusion",
    !output.needsAgentConclusion.includes("new-user-reply"),
  );
  check(
    "diff 已处理且无新意见的 open 条目不输出",
    !idsOf(output.newEntries).has("handled-open") &&
      !idsOf(output.suggestionChanged).has("handled-open") &&
      !idsOf(output.newUserReplies).has("handled-open") &&
      !output.needsAgentConclusion.includes("handled-open"),
  );
  check(
    "diff 无新意见的 open 条目不输出",
    !idsOf(output.newUserReplies).has("noop") &&
      !output.needsAgentConclusion.includes("noop"),
  );
};

const testReply = (workdir) => {
  console.log("== reply 确定性 id / delta base 逐字一致 / merge 自检 ==");
  const slug = "proj-reply";
  const srcDoc = doc(slug, [
    {
      ...entry("e1", { status: "open" }),
      scope: { pageId: "p1", nodePath: ["c1", "n1"], targetId: "t1" },
    },
  ]);
  const docPath = path.join(workdir, "reply-current.json");
  fs.writeFileSync(docPath, JSON.stringify(srcDoc));

  const body = "结论A";
  const expectedId = `agent-${sha256Hex(`e1\n${body}`).slice(0, 16)}`;
  const res1 = runCli(
    ["reply", "--doc", docPath, "--entry", "e1", "--body", body],
    workdir,
  );
  check("reply 成功且 merge 自检通过（退出码 0）", res1.status === 0);
  if (res1.status !== 0) {
    console.error(res1.stderr);
    return;
  }
  const outPath = path.join(workdir, `${slug}-feedback.agent.json`);
  check("reply 产出 agent delta 文件", fs.existsSync(outPath));
  const delta1 = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const deltaEntry = delta1.entries[0];
  const srcEntry = srcDoc.entries[0];

  check("reply 确定性 id", deltaEntry.replies[0].id === expectedId);
  check("reply author=agent", deltaEntry.replies[0].author === "agent");
  check(
    "reply entry base 逐字一致（suggestion/category/createdAt/status/scope）",
    deltaEntry.suggestion === srcEntry.suggestion &&
      deltaEntry.category === srcEntry.category &&
      deltaEntry.createdAt === srcEntry.createdAt &&
      deltaEntry.status === srcEntry.status &&
      JSON.stringify(deltaEntry.scope) === JSON.stringify(srcEntry.scope),
  );

  const res2 = runCli(
    ["reply", "--doc", docPath, "--entry", "e1", "--body", body],
    workdir,
  );
  check("reply 重放同输入 → 同 id", res2.status === 0);
  const delta2 = JSON.parse(fs.readFileSync(outPath, "utf8"));
  check(
    "reply 两次产出 id 一致",
    delta2.entries[0].replies[0].id === delta1.entries[0].replies[0].id,
  );

  // 已应用后重跑：doc 已含该 agent 回复，仍幂等（replayed，不重复发帖）
  const appliedDoc = doc(slug, [
    {
      ...entry("e1", { status: "open" }),
      scope: { pageId: "p1", nodePath: ["c1", "n1"], targetId: "t1" },
      replies: [agentReply(expectedId, body)],
    },
  ]);
  const appliedPath = path.join(workdir, "reply-applied.json");
  fs.writeFileSync(appliedPath, JSON.stringify(appliedDoc));
  const res3 = runCli(
    ["reply", "--doc", appliedPath, "--entry", "e1", "--body", body],
    workdir,
  );
  check("reply 已存在同 id → replayed 幂等", res3.status === 0);
  const parsed3 = JSON.parse(res3.stdout);
  check(
    "reply replayed 标记",
    Array.isArray(parsed3.replayed) && parsed3.replayed.includes("e1"),
  );
  const delta3 = JSON.parse(fs.readFileSync(outPath, "utf8"));
  check("reply 已应用重跑不重复发帖", delta3.entries[0].replies.length === 1);

  // 多组 --entry/--body
  const res4 = runCli(
    [
      "reply",
      "--doc",
      docPath,
      "--entry",
      "e1",
      "--body",
      "结论一",
      "--entry",
      "e1",
      "--body",
      "结论二",
    ],
    workdir,
  );
  check("reply 多组 entry/body 成功", res4.status === 0);
  const delta4 = JSON.parse(fs.readFileSync(outPath, "utf8"));
  check("reply 多组产出两条回复", delta4.entries[0].replies.length === 2);
  check(
    "reply 多组 id 各自确定",
    delta4.entries[0].replies.some(
      (r) => r.id === `agent-${sha256Hex("e1\n结论一").slice(0, 16)}`,
    ) &&
      delta4.entries[0].replies.some(
        (r) => r.id === `agent-${sha256Hex("e1\n结论二").slice(0, 16)}`,
      ),
  );
};

const testReplyCrossCallIdempotent = async (workdir) => {
  console.log("== reply 跨调用重放幂等（确定性 createdAt）==");
  const mod = await import(
    pathToFileURL(path.join(projectRoot, "src", "lib", "davidFeedback.ts")).href
  );
  const slug = "proj-replay";
  const srcDoc = doc(slug, [
    {
      ...entry("e1", { status: "open" }),
      scope: { pageId: "p1", nodePath: ["c1", "n1"], targetId: "t1" },
    },
  ]);
  const docPath = path.join(workdir, "replay-current.json");
  fs.writeFileSync(docPath, JSON.stringify(srcDoc));

  const body = "结论X";
  const cliArgs = ["reply", "--doc", docPath, "--entry", "e1", "--body", body];
  const outPath = path.join(workdir, `${slug}-feedback.agent.json`);

  // 第一次：原始 doc A → delta1（新增 agent 回复）
  const res1 = runCli(cliArgs, workdir);
  check("跨调用幂等：第一次 reply 成功且自检通过", res1.status === 0);
  if (res1.status !== 0) {
    console.error(res1.stderr);
    return;
  }
  const delta1 = JSON.parse(fs.readFileSync(outPath, "utf8"));
  check(
    "跨调用幂等：delta1 含 1 条 agent 回复",
    delta1.entries[0].replies.length === 1,
  );

  // mergeFeedbackDocuments(A, delta1) → merged
  let merged;
  try {
    merged = mod.mergeFeedbackDocuments(srcDoc, delta1);
  } catch (error) {
    check("跨调用幂等：第一次 merge 不抛错", false);
    console.error("  ", error.message);
    return;
  }
  check(
    "跨调用幂等：第一次 merge 成功且 replies=1",
    merged.entries[0].replies.length === 1,
  );

  // 第二次：仍用原始 doc A（非 merged）→ delta2，同样的 e1 + "结论X"
  const res2 = runCli(cliArgs, workdir);
  check("跨调用幂等：第二次 reply 成功且自检通过", res2.status === 0);
  if (res2.status !== 0) {
    console.error(res2.stderr);
    return;
  }
  const delta2 = JSON.parse(fs.readFileSync(outPath, "utf8"));

  // delta1 与 delta2 的 reply 对象逐字段完全相同
  const reply1 = delta1.entries[0].replies[0];
  const reply2 = delta2.entries[0].replies[0];
  check(
    "跨调用幂等：两次 reply 逐字段相同（id/body/createdAt/author）",
    reply1.id === reply2.id &&
      reply1.body === reply2.body &&
      reply1.createdAt === reply2.createdAt &&
      reply1.author === reply2.author &&
      JSON.stringify(reply1) === JSON.stringify(reply2),
  );
  check(
    "跨调用幂等：createdAt 为合法 ISO 时间",
    !Number.isNaN(Date.parse(reply1.createdAt)),
  );

  // mergeFeedbackDocuments(merged, delta2) → 必须成功且 replies 仍为 1
  let merged2;
  try {
    merged2 = mod.mergeFeedbackDocuments(merged, delta2);
  } catch (error) {
    check("跨调用幂等：重放合并不抛错", false);
    console.error("  ", error.message);
    return;
  }
  check(
    "跨调用幂等：重放合并成功且 replies 仍为 1（幂等）",
    merged2.entries[0].replies.length === 1,
  );
};

const testReplyGuard = (workdir) => {
  console.log("== reply 写入安全守卫（拒绝写进 skill 目录）==");
  const slug = "proj-guard";
  const srcDoc = doc(slug, [entry("e1")]);
  const docPath = path.join(workdir, "guard-current.json");
  fs.writeFileSync(docPath, JSON.stringify(srcDoc));
  const guardTarget = path.join(workdir, `${slug}-feedback.agent.json`);

  // cwd 指向 projectRoot（skill 目录内），应拒绝写入
  const res = runCli(
    ["reply", "--doc", docPath, "--entry", "e1", "--body", "结论"],
    projectRoot,
  );
  check("reply 写进 skill 目录被拒绝（退出码非 0）", res.status !== 0);
  check("reply 拒绝信息明确", /拒绝写入 skill 目录/.test(res.stderr));
  check(
    "reply 被拒绝时不落文件",
    !fs.existsSync(guardTarget) || guardTarget.startsWith(workdir),
  );
};

const testVerify = (workdir) => {
  console.log("== verify 缺失 agent 回复时非零退出 ==");
  const slug = "proj-verify";
  const missingA = doc(slug, [
    {
      ...entry("e1"),
      replies: [
        userReply("u1", "用户意见"),
        agentReply("g1", "结论", "2026-09-02T09:00:00.000Z"),
      ],
    },
  ]);
  const missingAgainst = doc(slug, [
    { ...entry("e1"), replies: [userReply("u1", "用户意见")] },
  ]);
  const aPath = path.join(workdir, "verify-a.json");
  const bPath = path.join(workdir, "verify-b.json");
  fs.writeFileSync(aPath, JSON.stringify(missingA));
  fs.writeFileSync(bPath, JSON.stringify(missingAgainst));

  const rej = runCli(["verify", "--doc", aPath, "--against", bPath], workdir);
  check("verify 缺失 agent 回复 → 非零退出", rej.status !== 0);
  check("verify 缺失信息包含回复 id", /g1/.test(rej.stderr));

  const okAgainst = doc(slug, [
    {
      ...entry("e1"),
      replies: [agentReply("g1", "结论", "2026-09-02T09:00:00.000Z")],
    },
  ]);
  const okPath = path.join(workdir, "verify-ok.json");
  fs.writeFileSync(okPath, JSON.stringify(okAgainst));
  const ok = runCli(["verify", "--doc", aPath, "--against", okPath], workdir);
  check("verify 全部 agent 回复存在且内容一致 → 退出码 0", ok.status === 0);
  check("verify ok 输出 checked=1", JSON.parse(ok.stdout).checked === 1);

  const changedAgainst = doc(slug, [
    {
      ...entry("e1"),
      replies: [agentReply("g1", "不同结论", "2026-09-02T09:00:00.000Z")],
    },
  ]);
  const changedPath = path.join(workdir, "verify-changed.json");
  fs.writeFileSync(changedPath, JSON.stringify(changedAgainst));
  const changed = runCli(
    ["verify", "--doc", aPath, "--against", changedPath],
    workdir,
  );
  check("verify agent 回复内容不一致 → 非零退出", changed.status !== 0);
};

const main = async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "david-fb-"));
  try {
    testPull(workdir);
    testPullStale(workdir);
    testDiff(workdir);
    testReply(workdir);
    testReplyGuard(workdir);
    testVerify(workdir);
    await testReplyCrossCallIdempotent(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} 项失败`);
    process.exit(1);
  }
  console.log("\n全部通过");
};

await main();
