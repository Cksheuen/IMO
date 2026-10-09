#!/usr/bin/env node
/**
 * collaboration-cli —— HARD-GATE 30 协作协议的可执行文件合并入口。
 *
 * 消费 collaborationProtocol 的纯函数（trimContextFor / patchOwned /
 * mergeOwnerPatches），让只带相关上下文的 agent 能以「文件」为工作单元：
 *
 *   context  —— 获取有界上下文：对某个 agent 裁剪 spec（自有页 + 自有节点子树 +
 *               锚点所在页），输出可独立解析/渲染的 review spec。
 *   patch    —— 提交一条最小 patch（ownership + lease 门控），冲突稳定返回、不落盘。
 *   merge    —— 多 owner patch 顺序合入（当前 collaboration.lease.holder 才可提交），
 *               冲突返回、保留对方编辑、不静默合并。
 *
 * 规则（与 SKILL「多 agent 协作同一 HTML（HARD-GATE 30）」一致）：
 * - 写修改需持有当前租约：默认从 manifest collaboration.lease.holder 读取，
 *   --lease-holder 可显式指定；未声明租约（旧 spec）退化为仅 ownership 门控。
 * - 冲突不写盘：patch/merge 失败时不生成输出文件，输入 spec 保持原样。
 * - 本 CLI 只读写命令行给定的文件，不触碰运行时源码；与 david-lease.py
 *   （canonical skill 源码租约，HARD-GATE 27）是两个不同的租约层。
 *
 * 用法：
 *   node collaboration-cli.mjs context <spec.json> <agent> [--out <file>]
 *   node collaboration-cli.mjs patch <spec.json> <ref> <path> <value-json> \
 *       [--agent <agent>] [--lease-holder <agent>] [--out <file>]
 *   node collaboration-cli.mjs merge <spec.json> <patches.json> \
 *       [--lease-acquire <agent>] [--out <file>]
 *
 * path 用点号（"label" / "mapping.0.change"；数字段转数组下标）；value-json 与
 * patches.json 里每个 patch 的 value 均为 JSON 字面量（字符串需带引号）。
 *
 * 退出码：0 成功；1 数据层冲突/拒绝（stdout 给出 { ok:false, status, reason }）；
 *         2 用法或 IO 错误。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  acquireLease,
  mergeOwnerPatches,
  parseManifest,
  patchOwned,
  trimContextFor,
} from "./collaborationProtocol.mjs";

const USAGE = `collaboration-cli <command> [args...]

commands:
  join <spec.json> <agent> [--session <session>] [--out <file>]
      输出 agent 可直接消费的协作上下文 envelope（含 ownership、约束与裁剪 spec）。
  context <spec.json> <agent> [--out <file>]
      agent 的有界上下文（trimContextFor）：自有页 + 自有节点子树 + 锚点所在页。
  patch <spec.json> <ref> <path> <value-json> [--agent <agent>]
        [--lease-holder <agent>] [--out <file>]
      patchOwned：对 ref（page/node id）按 path 做最小 patch；owner+lease 双门控。
      冲突/被拒稳定返回 exit 1，且不写 --out。
  merge <spec.json> <patches.json> [--lease-acquire <agent>] [--out <file>]
      mergeOwnerPatches：顺序合入 patches.json 里的 [ {agent,ref,path,value}, ... ]。
      当前 collaboration.lease.holder 才可提交；多 owner 用 --lease-acquire 交接。
      有冲突时 exit 1 且不写 --out。
`;

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, value) => {
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
};
const emit = (envelope, code) => {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(code);
};
const fail = (message) => {
  process.stderr.write(`collaboration-cli: ${message}\n\n${USAGE}`);
  process.exit(2);
};

/** 点号路径 -> 键数组；数字段转数组下标。 */
const parsePath = (raw) =>
  String(raw)
    .split(".")
    .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));

const normalizePatch = (p) => ({
  agent: p.agent,
  ref: p.ref,
  path: Array.isArray(p.path) ? p.path : parsePath(p.path),
  value: p.value,
});

// ── 参数解析：抽走带值旗标，剩余为位置参数 ─────────────────────────────────
const argv = process.argv.slice(2);
const take = (flag) => {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value === undefined || value.startsWith("--") ? undefined : value;
};
const optOut = take("--out");
const optAgent = take("--agent");
const optLeaseHolder = take("--lease-holder");
const optLeaseAcquire = take("--lease-acquire");
const optSession = take("--session");

const [command, ...rest] = argv;
if (!command) fail("缺少子命令");

const isOk = (res) => res.status === "ok";

if (command === "context") {
  const [specPath, agentName] = rest;
  if (!specPath || !agentName) fail("context 需要 <spec.json> <agent>");
  const tx = trimContextFor(readJson(specPath), agentName);
  if (optOut) {
    writeJson(optOut, tx);
    emit(
      {
        ok: true,
        kind: "context",
        agent: agentName,
        pages: (tx.pages ?? []).map((p) => p.id),
        components: (tx.components ?? []).map((c) => c.id),
        out: optOut,
      },
      0,
    );
  }
  process.stdout.write(`${JSON.stringify(tx, null, 2)}\n`);
  process.stderr.write(
    `[context] ${agentName}: pages=${(tx.pages ?? [])
      .map((p) => p.id)
      .join()} components=${(tx.components ?? []).map((c) => c.id).join()}\n`,
  );
  process.exit(0);
}

if (command === "join") {
  const [specPath, agentName] = rest;
  if (!specPath || !agentName) fail("join 需要 <spec.json> <agent>");
  const spec = readJson(specPath);
  const context = trimContextFor(spec, agentName);
  const manifest = parseManifest(spec);
  const ownedPages = [...manifest.pages.entries()]
    .filter(([, owner]) => owner === agentName)
    .map(([id]) => id);
  const ownedNodes = [...manifest.nodes.entries()]
    .filter(([, owner]) => owner === agentName)
    .map(([id]) => id);
  const envelope = {
    schema: "david-collaboration-context/v1",
    agent: agentName,
    ...(optSession ? { session: optSession } : {}),
    patchOnly: spec.collaboration?.patchOnly !== false,
    lease: spec.collaboration?.lease ?? null,
    ownership: { pages: ownedPages, nodes: ownedNodes },
    rules: [
      "只修改 ownership 中声明的 page/node",
      "只提交最小 patch，不重写整页，不删除锚点",
      "冲突时重读 spec，保留对方修改后重试",
      "patch 后必须重新 parseReviewSpec 并渲染验证",
    ],
    context,
  };
  if (optOut) {
    writeJson(optOut, envelope);
    emit(
      {
        ok: true,
        kind: "join",
        agent: agentName,
        ownership: envelope.ownership,
        out: optOut,
      },
      0,
    );
  }
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(0);
}

if (command === "patch") {
  const [specPath, ref, pathStr, valueJson] = rest;
  if (!specPath || !ref || !pathStr || valueJson === undefined)
    fail("patch 需要 <spec.json> <ref> <path> <value-json>");
  if (!optAgent) fail("patch 需要 --agent <agent>");
  let value;
  try {
    value = JSON.parse(valueJson);
  } catch {
    fail(`value 不是合法 JSON 字面量: ${valueJson}`);
  }
  const spec = readJson(specPath);
  const res = patchOwned(
    spec,
    optAgent,
    optLeaseHolder === undefined ? null : optLeaseHolder,
    { ref, path: parsePath(pathStr), value },
  );
  if (isOk(res)) {
    if (optOut) {
      writeJson(optOut, res.spec);
      emit(
        {
          ok: true,
          kind: "patch",
          status: "ok",
          ref,
          ownershipRecorded: res.ownershipRecorded,
          out: optOut,
        },
        0,
      );
    }
    process.stdout.write(`${JSON.stringify(res.spec, null, 2)}\n`);
    process.stderr.write(
      `[patch] ok ${ref} (ownershipRecorded=${res.ownershipRecorded})\n`,
    );
    process.exit(0);
  }
  emit(
    { ok: false, kind: "patch", status: res.status, reason: res.reason, ref },
    1,
  );
}

if (command === "merge") {
  const [specPath, patchesPath] = rest;
  if (!specPath || !patchesPath) fail("merge 需要 <spec.json> <patches.json>");
  const spec = readJson(specPath);
  const patches = readJson(patchesPath).map(normalizePatch);
  const base =
    optLeaseAcquire !== undefined ? acquireLease(spec, optLeaseAcquire) : spec;
  const res = mergeOwnerPatches(base, patches);
  if (res.conflicts.length > 0) {
    // 冲突不落盘：输入 spec 保持原样，冲突返回由调用方重读 + patch 重试。
    emit(
      {
        ok: false,
        kind: "merge",
        applied: res.applied,
        conflicts: res.conflicts,
      },
      1,
    );
  }
  if (optOut) {
    writeJson(optOut, res.spec);
    emit({ ok: true, kind: "merge", applied: res.applied, out: optOut }, 0);
  }
  process.stdout.write(`${JSON.stringify(res.spec, null, 2)}\n`);
  process.stderr.write(`[merge] ok applied=${res.applied.length}\n`);
  process.exit(0);
}

fail(`未知子命令: ${command}`);
