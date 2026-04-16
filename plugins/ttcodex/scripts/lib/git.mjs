import fs from "node:fs";
import path from "node:path";

import { isProbablyText } from "./fs.mjs";
import { runCommand, runCommandChecked } from "./process.mjs";

const MAX_UNTRACKED_BYTES = 24 * 1024;

function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}

function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", args, { cwd, ...options });
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/origin/", "");
    }
  }

  const candidates = ["main", "master", "trunk"];
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) {
      return candidate;
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error("Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.");
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

export function getWorkingTreeState(cwd) {
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const unstaged = gitChecked(cwd, ["diff", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim().split("\n").filter(Boolean);

  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);

  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const state = getWorkingTreeState(cwd);
  const supportedScopes = new Set(["auto", "working-tree", "branch"]);

  if (baseRef) {
    return {
      mode: "branch",
      label: `branch diff against ${baseRef}`,
      baseRef,
      explicit: true
    };
  }

  if (requestedScope === "working-tree") {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true
    };
  }

  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }

  if (requestedScope === "branch") {
    const detectedBase = detectDefaultBranch(cwd);
    return {
      mode: "branch",
      label: `branch diff against ${detectedBase}`,
      baseRef: detectedBase,
      explicit: true
    };
  }

  if (state.isDirty) {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false
    };
  }

  const detectedBase = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${detectedBase}`,
    baseRef: detectedBase,
    explicit: false
  };
}

function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}

function formatSkippedUntrackedFile(relativePath, reason) {
  return `### ${relativePath}\n(skipped: ${reason})`;
}

function resolveUntrackedFileStat(absolutePath) {
  try {
    const entryStat = fs.lstatSync(absolutePath);
    if (entryStat.isDirectory()) {
      return { skipReason: "directory" };
    }

    if (entryStat.isSymbolicLink()) {
      try {
        const targetStat = fs.statSync(absolutePath);
        if (targetStat.isDirectory()) {
          return { skipReason: "symlink to directory" };
        }
        return { stat: targetStat };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return { skipReason: "broken symlink" };
        }
        throw error;
      }
    }

    return { stat: entryStat };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { skipReason: "path disappeared before review context collection" };
    }
    throw error;
  }
}

function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  const { stat, skipReason } = resolveUntrackedFileStat(absolutePath);
  if (skipReason) {
    return formatSkippedUntrackedFile(relativePath, skipReason);
  }

  if (stat.size > MAX_UNTRACKED_BYTES) {
    return formatSkippedUntrackedFile(relativePath, `${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit`);
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return formatSkippedUntrackedFile(relativePath, "path disappeared before content could be read");
    }
    if (error?.code === "EISDIR") {
      return formatSkippedUntrackedFile(relativePath, "directory");
    }
    throw error;
  }

  if (!isProbablyText(buffer)) {
    return formatSkippedUntrackedFile(relativePath, "binary file");
  }

  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}

function collectWorkingTreeContext(cwd, state) {
  const status = gitChecked(cwd, ["status", "--short"]).stdout.trim();
  const stagedDiff = gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
  const unstagedDiff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
  const untrackedBody = state.untracked.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");

  const parts = [
    formatSection("Git Status", status),
    formatSection("Staged Diff", stagedDiff),
    formatSection("Unstaged Diff", unstagedDiff),
    formatSection("Untracked Files", untrackedBody)
  ];

  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join("\n")
  };
}

function collectBranchContext(cwd, baseRef) {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  const commitRange = `${mergeBase}..HEAD`;
  const currentBranch = getCurrentBranch(cwd);
  const logOutput = gitChecked(cwd, ["log", "--oneline", "--decorate", commitRange]).stdout.trim();
  const diffStat = gitChecked(cwd, ["diff", "--stat", commitRange]).stdout.trim();
  const diff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff", commitRange]).stdout;

  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${mergeBase}.`,
    content: [
      formatSection("Commit Log", logOutput),
      formatSection("Diff Stat", diffStat),
      formatSection("Branch Diff", diff)
    ].join("\n")
  };
}

export function collectReviewContext(cwd, target) {
  const repoRoot = getRepoRoot(cwd);
  const state = getWorkingTreeState(cwd);
  const currentBranch = getCurrentBranch(cwd);
  let details;

  if (target.mode === "working-tree") {
    details = collectWorkingTreeContext(repoRoot, state);
  } else {
    details = collectBranchContext(repoRoot, target.baseRef);
  }

  return {
    cwd: repoRoot,
    repoRoot,
    branch: currentBranch,
    target,
    ...details
  };
}
