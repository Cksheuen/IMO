# CC ↔ Codex 同步链路架构

> 来源：T6 落地后发现 `shared-knowledge/AGENTS.md` 是 compile 产物，原手写的同步说明会被自动重生覆盖 | 吸收时间：2026-04-20

## 核心问题

`shared-knowledge/AGENTS.md` 由 `hooks/codex-sync/compile-rules.py` 从 `CLAUDE.md` + `rules/` + `rules-library/` + `notes/lessons/` 自动编译生成，任何手编内容在下次 sync 时被全量重写擦掉。

如果把同步链路的设计事实直接写进 `AGENTS.md`，等价于编辑 build 出来的 `dist/index.html`：commit 上去也守不住。

## 核心原则

**source-of-truth 写规则，AGENTS.md 永远是产物。**

任何需要同步给 Codex CLI 的 CC↔Codex 协议事实，必须落到 5 个输入源之一（`CLAUDE.md` P0 段 / `rules/core/` / `rules-library/core/` / `rules/pattern/` / `rules-library/pattern/` / `notes/lessons/` active），由 compile-rules.py 自动收录。

## 触发条件

当出现以下任一情况时，必须应用本规范：

- 修改或新增 CC↔Codex 同步行为
- 修改或新增 `~/.codex/AGENTS.md` 的可见内容
- 想给 Codex CLI 增加一条共享治理事实
- 发现 `shared-knowledge/AGENTS.md` 出现非自动生成的手写段落

## 架构

链路双挂的具体落点：

- `Stop` hook 挂 `hooks/codex-sync/on-session-stop.sh`
- `on-session-stop.sh` 是 fallback：30 秒窗口内若 `PostToolUse(Edit|Write)` 已触发过 sync，则直接跳过
- 若 30 秒内没有 recent post-edit sync，且 `rules/`、`rules-library/`、`notes/lessons/` 仍有变更，则后台触发一次同步
- `SessionEnd` hook 挂 `hooks/codex-sync/sync-to-codex.sh`
- 这条链路走强制路径，用于会话结束兜底收口；不做 debounce
- `sync-to-codex.sh` 调 `compile-rules.py`，全量重写 `shared-knowledge/AGENTS.md`
- `~/.codex/AGENTS.md` 是软链 → `~/.claude/shared-knowledge/AGENTS.md`

`shared-knowledge/sync-manifest.json` 的 `commands_divergence_policy` 字段声明：

- CC / Codex commands 不要求完全对齐
- 合法分化包含：Codex 侧因不支持 skills，允许以 proxy commands 镜像 skill
- 合法分化包含：CC 侧 `caveman-*`、`promotion-mode`、`lesson-review`、`task-audit` 等专属命令不镜像到 Codex

## 执行规范

发现需要让 Codex 看到一条新事实时，按以下顺序处理：

1. 判断该事实属于哪一档：协议级走 P0（写 `CLAUDE.md`）；元规范走 P1（写 `rules-library/core/`）；模式约束走 P2（写 `rules-library/pattern/`）；历史教训走 P3（写 `notes/lessons/` 并标 `status: active`）。
2. 写入对应 source-of-truth 文件，使用 `compile-rules.py` 识别的段落标题（`核心原则`、`核心问题`、`触发条件`、`决策框架`、`执行规范`、`反模式`、`架构` 等）。
3. 跑一次 `bash hooks/codex-sync/sync-to-codex.sh` 验证 `shared-knowledge/AGENTS.md` 已包含新内容。
4. 提交 source-of-truth 文件 + 自动重生的 `shared-knowledge/AGENTS.md` + `shared-knowledge/sync-manifest.json` 三者。

## 反模式

| 反模式 | 后果 | 正确做法 |
|--------|------|----------|
| 直接编辑 `shared-knowledge/AGENTS.md` | 下次任意 hook 触发 sync 时被擦 | 写到 5 个输入源之一 |
| 把 CC↔Codex 协议事实只写进 `hooks/README.md` | compile-rules.py 不读 README，Codex 看不到 | 同时写到 `rules-library/core/` |
| 担心覆盖就把 AGENTS.md 移出 git | 失去跨机同步基线 | AGENTS.md 留 git，作为产物快照 |
| 跨任务复用结论沉在 task | task 是事实记录，不是 source-of-truth | 复用结论写 rules / rules-library / notes |
