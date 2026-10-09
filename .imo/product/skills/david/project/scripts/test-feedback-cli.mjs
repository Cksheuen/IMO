#!/usr/bin/env node
/**
 * david-feedback-cli.mjs 聚焦回归测试（真实服务，naive 子进程黑盒）。
 *
 * 覆盖 SKILL.md 验证清单里「agent 侧 david:feedback -- add/get/reply/status/decision
 * 均 verified:true（写后回读）」，以及 HARD-GATE 26 的 reply 语义：
 * - reply 默认 author="agent"、确定性 agent-<hash> id、跨调用幂等（版本不推进）
 * - --author user 覆盖为随机 id；--id 自定义 id；同 id 异内容 → 409 exit 3
 * - 冲突退出码 3、服务不可达退出码 4、serve 幂等 alreadyRunning
 * - add 同 id（内容因 createdAt 不同）→ 409 exit 3（拒绝静默覆盖）
 * - status / decision 写后回读 verified、since/commit 增量水位
 *
 * 全程 mkdtemp + 随机空闲端口 + SIGTERM 收尾，绝不污染真实 ~/.imo 或默认 5180。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(HERE, "david-feedback-cli.mjs");
const tmpRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "david-feedback-cli-test-"),
);

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const port = await freePort();
const env = {
  ...process.env,
  IMO_GLOBAL_ROOT: tmpRoot,
  DAVID_FEEDBACK_PORT: String(port),
};

const daemon = spawn(
  process.execPath,
  [path.join(HERE, "serve-feedback.mjs")],
  {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let daemonStderr = "";
daemon.stderr.on("data", (chunk) => {
  daemonStderr += chunk.toString();
});

const cleanup = () => {
  if (!daemon.killed) daemon.kill("SIGTERM");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
};
process.on("exit", cleanup);

const waitReady = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没监听，继续等 */
    }
    if (daemon.exitCode !== null) {
      throw new Error(
        `daemon 提前退出（code ${daemon.exitCode}）:\n${daemonStderr}`,
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`daemon 启动超时:\n${daemonStderr}`);
};

/** 运行 CLI 子进程，返回 { status, stdout: parsed JSON | null, stderr }。 */
const runCli = (args, cliEnv = env) => {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    env: cliEnv,
    encoding: "utf8",
  });
  const stdout = parseCliStdout(result.stdout);
  return { status: result.status, stdout, stderr: result.stderr };
};

/** CLI 对所有写命令强制输出合法 JSON；非 JSON（应为空 stdout）原样透出便于诊断。 */
const parseCliStdout = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparsed: raw };
  }
};

const failures = [];
const check = (name, condition, extra = "") => {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL - ${name}${extra ? `\n        ${extra}` : ""}`);
  }
};

await waitReady();

// ── list / health ────────────────────────────────────────────────────────────
const listed = runCli(["list"]);
check("list 返回 index schema（exit 0）", listed.status === 0);
check(
  "list 输出为 JSON 且有 items",
  listed.stdout && Array.isArray(listed.stdout.items),
  JSON.stringify(listed.stderr),
);

// ── add：verified 写后回读 ───────────────────────────────────────────────────
const added = runCli([
  "add",
  "demo-cli",
  "--category",
  "visual",
  "--suggestion",
  "按钮对比度不足",
  "--id",
  "e1",
]);
check("add exit 0", added.status === 0);
check(
  "add verified true + entryId=e1",
  added.stdout?.verified === true && added.stdout?.entryId === "e1",
  JSON.stringify(added.stdout) + added.stderr,
);

// add 同 id（不同 createdAt）→ 服务端拒绝覆盖 → 409 → exit 3
const reAdded = runCli([
  "add",
  "demo-cli",
  "--category",
  "visual",
  "--suggestion",
  "按钮对比度不足",
  "--id",
  "e1",
]);
check(
  "add 同 id 异 createdAt → exit 3 冲突（拒绝静默覆盖）",
  reAdded.status === 3,
);
check(
  "add 冲突输出 conflict:true",
  reAdded.stdout?.conflict === true && reAdded.stdout?.status === 409,
  JSON.stringify(reAdded.stdout),
);

// ── reply：HARD-GATE 26 确定性 + 幂等 + author ───────────────────────────────
const reply1 = runCli(["reply", "demo-cli", "e1", "--body", "结论A"]);
check(
  "reply#1 exit 0 + verified",
  reply1.status === 0 && reply1.stdout?.verified === true,
);
check(
  "reply#1 id 确定性 agent-<hash> 前缀",
  typeof reply1.stdout?.replyId === "string" &&
    reply1.stdout.replyId.startsWith("agent-"),
  JSON.stringify(reply1.stdout),
);
const reply1Version = reply1.stdout?.version;

const reply2 = runCli(["reply", "demo-cli", "e1", "--body", "结论A"]);
check(
  "reply#2 同输入幂等 exit 0 + verified",
  reply2.status === 0 && reply2.stdout?.verified === true,
);
check(
  "reply#2 同 id（确定性派生）",
  reply2.stdout?.replyId === reply1.stdout?.replyId,
  `${reply2.stdout?.replyId} vs ${reply1.stdout?.replyId}`,
);
check(
  "reply#2 无内容写 → 版本不变",
  reply2.stdout?.version === reply1Version,
  `#1=${reply1Version} #2=${reply2.stdout?.version}`,
);

const got = runCli(["get", "demo-cli"]);
const agentReplies = got.stdout?.doc?.entries
  ?.find((e) => e.id === "e1")
  ?.replies?.filter((r) => r.body === "结论A");
check(
  "get 回读：agent 回复落库 author=agent（HARD-GATE 26）",
  got.status === 0 &&
    agentReplies?.length === 1 &&
    agentReplies[0].author === "agent",
  JSON.stringify(got.stdout),
);

// ── reply 冲突：同 --id 异内容 → 409 exit 3 ──────────────────────────────────
const repA = runCli(["reply", "demo-cli", "e1", "--body", "AAA", "--id", "r1"]);
check("reply --id r1 首次 exit 0", repA.status === 0);
const repB = runCli(["reply", "demo-cli", "e1", "--body", "BBB", "--id", "r1"]);
check("reply 同 id 异内容 → exit 3 冲突（不覆盖）", repB.status === 3);
check(
  "reply 冲突输出 conflict:true",
  repB.stdout?.conflict === true && repB.stdout?.status === 409,
  JSON.stringify(repB.stdout),
);

// ── reply --author user：随机 id、人工身份 ────────────────────────────────────
const repUser = runCli([
  "reply",
  "demo-cli",
  "e1",
  "--body",
  "人工补充",
  "--author",
  "user",
]);
check(
  "reply --author user exit 0 + verified",
  repUser.status === 0 && repUser.stdout?.verified === true,
);
check(
  "reply --author user 非 agent- 前缀（随机 id）",
  typeof repUser.stdout?.replyId === "string" &&
    !repUser.stdout.replyId.startsWith("agent-"),
  JSON.stringify(repUser.stdout),
);
const gotUser = runCli(["get", "demo-cli"]);
const userReply = gotUser.stdout?.doc?.entries
  ?.find((e) => e.id === "e1")
  ?.replies?.find((r) => r.body === "人工补充");
check(
  "get 回读：user 回复 author 缺省（parse 归一 user，不落 author 字段）",
  gotUser.status === 0 && userReply && userReply.author === undefined,
  JSON.stringify(userReply),
);

// ── status / decision：写后回读 ──────────────────────────────────────────────
const statused = runCli(["status", "demo-cli", "e1", "--value", "resolved"]);
check(
  "status exit 0 + verified true",
  statused.status === 0 &&
    statused.stdout?.verified === true &&
    statused.stdout?.status === "resolved",
  JSON.stringify(statused.stdout),
);

const addedAgent = runCli([
  "add",
  "demo-cli",
  "--category",
  "interaction",
  "--suggestion",
  "建议收敛按钮层级",
  "--id",
  "a1",
]);
check("add agent 提议条目", addedAgent.status === 0);
const decided = runCli(["decision", "demo-cli", "a1", "--value", "accepted"]);
check(
  "decision（agent 提议）exit 0 + verified",
  decided.status === 0 &&
    decided.stdout?.verified === true &&
    decided.stdout?.decision === "accepted",
  JSON.stringify(decided.stdout),
);

// ── since / commit：增量水位 ─────────────────────────────────────────────────
const since1 = runCli(["since", "demo-cli"]);
check(
  "since 未提交前 pending 覆盖全部条目",
  since1.status === 0 &&
    typeof since1.stdout?.pendingCount === "number" &&
    since1.stdout.pendingCount > 0,
  JSON.stringify(since1.stdout),
);
const committed = runCli(["commit", "demo-cli"]);
check(
  "commit 记录快照",
  committed.status === 0 && committed.stdout?.committed === true,
);
const since2 = runCli(["since", "demo-cli"]);
check(
  "since 提交后 pendingCount 0",
  since2.status === 0 && since2.stdout?.pendingCount === 0,
  JSON.stringify(since2.stdout),
);

// ── serve 幂等：已运行实例应 alreadyRunning ─────────────────────────────────
const served = runCli(["serve"]);
check(
  "serve 幂等 alreadyRunning exit 0",
  served.status === 0 && served.stdout?.alreadyRunning === true,
  JSON.stringify(served.stdout) + served.stderr,
);

// ── 服务不可达：退出码 4 ─────────────────────────────────────────────────────
const deadPort = await freePort();
const deadEnv = { ...env, DAVID_FEEDBACK_PORT: String(deadPort) };
const unreachable = runCli(["get", "demo-cli"], deadEnv);
check(
  "服务不可达 → exit 4",
  unreachable.status === 4,
  JSON.stringify(unreachable.stdout) + unreachable.stderr,
);

console.log(
  "\n" + (failures.length === 0 ? "全部通过" : `${failures.length} 项失败`),
);
cleanup();
if (failures.length > 0) {
  process.exit(1);
}
process.exit(0);
