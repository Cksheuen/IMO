#!/usr/bin/env node
/**
 * collaboration-cli 端到端 smoke：以真实子进程调用可执行入口，
 * 覆盖「有界上下文 / 提交 patch / 冲突返回 / 多 owner 合并」四条链路。
 * 所有输入输出都在 mkdtemp 临时目录，不写 repo。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptsDir, "..", "..");
const cliPath = path.join(scriptsDir, "collaboration-cli.mjs");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(skillRoot, "examples", "collaboration-canvas-review.review.json"),
    "utf8",
  ),
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

const run = (inputPath, args) =>
  spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });

// 环境：tmp 内放主 spec 与 patches 文件
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "david-cli-smoke-"));
const specPath = path.join(dir, "input.review.json");
fs.writeFileSync(specPath, JSON.stringify(fixture, null, 2));

console.log("== context：agent 有界上下文 ==");
{
  const ctxAOut = path.join(dir, "ctx-a.json");
  const rA = run(specPath, ["context", specPath, "agent-a", "--out", ctxAOut]);
  check("context(agent-a) 退出码 0", rA.status === 0);
  const ctxA = JSON.parse(fs.readFileSync(ctxAOut, "utf8"));
  check(
    "context(agent-a)：自有页 p-screen、组件 publish-form、无对方内容",
    (ctxA.pages ?? []).map((p) => p.id).join() === "p-screen" &&
      (ctxA.components ?? []).map((c) => c.id).join() === "publish-form" &&
      !JSON.stringify(ctxA).includes("state-review") &&
      !JSON.stringify(ctxA).includes("p-canvas"),
  );

  const ctxBOut = path.join(dir, "ctx-b.json");
  const rB = run(specPath, ["context", specPath, "agent-b", "--out", ctxBOut]);
  check("context(agent-b) 退出码 0", rB.status === 0);
  const ctxB = JSON.parse(fs.readFileSync(ctxBOut, "utf8"));
  check(
    "context(agent-b)：自有页 p-canvas、组件 publish-flow-board、无对方内容",
    (ctxB.pages ?? []).map((p) => p.id).join() === "p-canvas" &&
      (ctxB.components ?? []).map((c) => c.id).join() ===
        "publish-flow-board" &&
      !JSON.stringify(ctxB).includes("field-title"),
  );
}

console.log("== patch：自有最小 patch 成功 ==");
{
  const patchedOut = path.join(dir, "patched.json");
  const r = run(specPath, [
    "patch",
    specPath,
    "field-title",
    "label",
    JSON.stringify("标题输入（CLI 改）"),
    "--agent",
    "agent-a",
    "--lease-holder",
    "agent-a",
    "--out",
    patchedOut,
  ]);
  check("patch(own) 退出码 0", r.status === 0);
  const patched = JSON.parse(fs.readFileSync(patchedOut, "utf8"));
  const label = patched.components[0].children?.[0]?.label;
  check(
    "patch(own)：目标叶子更新 + 页面/协作清单保留",
    label === "标题输入（CLI 改）" &&
      (patched.pages ?? []).length === 2 &&
      patched.collaboration?.nodes?.length === 6,
  );
}

console.log("== patch：冲突稳定返回（不落盘、不改输入） ==");
{
  // no-lease：agent-b 非 manifest holder（agent-a），不传 --lease-holder
  const rNoLease = run(specPath, [
    "patch",
    specPath,
    "field-title",
    "label",
    JSON.stringify("b 篡改"),
    "--agent",
    "agent-b",
  ]);
  const env = JSON.parse(rNoLease.stdout);
  check(
    "patch(no-lease) 退出码 1 且 reason=no-lease",
    rNoLease.status === 1 && env.ok === false && env.reason === "no-lease",
  );

  // foreign-owner：agent-a 持约但改 agent-b 的 state-review
  const rForeign = run(specPath, [
    "patch",
    specPath,
    "state-review",
    "label",
    JSON.stringify("a 越权"),
    "--agent",
    "agent-a",
    "--lease-holder",
    "agent-a",
  ]);
  const envF = JSON.parse(rForeign.stdout);
  check(
    "patch(foreign-owner) 退出码 1 且 reason=foreign-owner",
    rForeign.status === 1 &&
      envF.ok === false &&
      envF.reason === "foreign-owner",
  );

  // unknown-ref
  const rUnknown = run(specPath, [
    "patch",
    specPath,
    "ghost-node",
    "label",
    JSON.stringify("x"),
    "--agent",
    "agent-a",
    "--lease-holder",
    "agent-a",
  ]);
  const envU = JSON.parse(rUnknown.stdout);
  check(
    "patch(unknown-ref) 退出码 1 且 reason=unknown-ref（不崩溃）",
    rUnknown.status === 1 && envU.ok === false && envU.reason === "unknown-ref",
  );

  check(
    "冲突后输入 spec 保持原样",
    JSON.stringify(JSON.parse(fs.readFileSync(specPath, "utf8"))) ===
      JSON.stringify(fixture),
  );
}

console.log("== merge：多 owner 顺序合入 / 冲突返回 ==");
{
  // 成功：--lease-acquire agent-a 后提交 agent-a 的自有 patch
  const patchAFile = path.join(dir, "patches-a.json");
  fs.writeFileSync(
    patchAFile,
    JSON.stringify([
      {
        agent: "agent-a",
        ref: "field-title",
        path: "label",
        value: "标题输入（MERGE 改）",
      },
    ]),
  );
  const mergedOut = path.join(dir, "merged.json");
  const rOk = run(specPath, [
    "merge",
    specPath,
    patchAFile,
    "--lease-acquire",
    "agent-a",
    "--out",
    mergedOut,
  ]);
  check("merge(ok) 退出码 0", rOk.status === 0);
  const merged = JSON.parse(fs.readFileSync(mergedOut, "utf8"));
  check(
    "merge(ok)：合并结果落盘且目标更新",
    merged.components[0].children?.[0]?.label === "标题输入（MERGE 改）",
  );

  // 冲突：--lease-acquire agent-c 后仍越 ownership 修改 agent-a 的 field-title
  const patchCFile = path.join(dir, "patches-c.json");
  fs.writeFileSync(
    patchCFile,
    JSON.stringify([
      { agent: "agent-c", ref: "field-title", path: "label", value: "c 越权" },
    ]),
  );
  const conflictOut = path.join(dir, "should-not-exist.json");
  const rConf = run(specPath, [
    "merge",
    specPath,
    patchCFile,
    "--lease-acquire",
    "agent-c",
    "--out",
    conflictOut,
  ]);
  const envC = JSON.parse(rConf.stdout);
  check(
    "merge(冲突) 退出码 1、conflicts[0].reason=foreign-owner、不落盘",
    rConf.status === 1 &&
      envC.ok === false &&
      envC.conflicts?.length === 1 &&
      envC.conflicts[0].reason === "foreign-owner" &&
      !fs.existsSync(conflictOut),
  );
}

console.log("== 用法：缺少子命令退出码 2 ==");
{
  const r = run(specPath, []);
  check("无子命令退出码 2", r.status === 2);
}

if (failures.length > 0) {
  console.error(`\n共 ${failures.length} 项失败:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\ncollaboration-cli smoke 全部通过");
process.exit(0);
