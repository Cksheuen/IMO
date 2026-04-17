# 调研：caveman 作为 vendor skill 的集成方案

> 调研时间：2026-04-17
> 决策状态：已落地
> 上游 commit：`c2ed24b3e5d412cd0c25197b2bc9af587621fd99`
> 相关资产：`skills/vendor/caveman/`、`hooks/caveman-*.py`、`commands/caveman-*.md`、`rules-library/pattern/concise-chinese-output.md`

## 背景

用户希望将 [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)（Claude Code skill，通过"穴居人语言"节省 65-75% 输出 token）接入 `~/.claude/` 共享配置仓库，让其能随 git 同步到其他机器，而不是以本地 plugin 形式存在。

## 核心判断

### 问题 1：plugin 安装 vs vendor skill

| 方案 | 结论 |
|------|------|
| `claude plugin install caveman@caveman` | ❌ 插件落在 `~/.claude/plugins/`，本仓库 `.gitignore` 黑名单，跨机不等价 |
| `npx skills add` | ❌ 同理，不进入仓库同步 |
| **vendor skill** → `skills/vendor/caveman/` | ✅ 对齐 `skills/vendor/impeccable/` 先例，走 `!skills/**` 白名单自动同步 |

**最终选择 vendor skill。**

### 问题 2：opt-in vs auto-activation

| 方案 | 代价 | 用户选择 |
|------|------|---------|
| 纯 opt-in（显式 `/caveman` 触发） | 价值受限 | ❌ |
| 仅子命令 opt-in | 丢失核心压缩 | ❌ |
| 全量 auto-activation + 本地魔改 | 需改 hook / prompt / 豁免机制 | ✅ |

**最终选择全量 auto-activation + 本地魔改**。理由：

- caveman 的核心价值是**持续注入**，命令触发丢失会话级生效
- "简洁"和"中文"不冲突：中文也可以去客套去 hedging
- impeccable 布局可参考（`skills/vendor/<第三方>/`），但运行机制需要自己实现

### 问题 3：如何魔改

对比上游 4 个关键点：

| 点 | 上游 | 本地版 | 理由 |
|----|------|--------|------|
| 协议语言 | terse English + 文言文 | 简洁中文 | 用户交流语言规范要求中文 |
| 废话 pattern | `sure` / `certainly` / `happy to` | `好的` / `我来帮你` / `希望这对你有帮助` | 中英 filler 模式完全不同，不能照搬 |
| 激活路径 | SessionStart hook（Node.js） | UserPromptSubmit hook（Python） | 需要基于当前 prompt 判断 allowlist 豁免，SessionStart 看不到 |
| 配置路径 | `~/.config/caveman/config.json` | `~/.claude/caveman-config.json` | 对齐 `promotion-config.json` 命名约定 |
| CLAUDE.md 覆盖 | 默认覆盖 | 不启用 | 会覆盖用户全局 CLAUDE.md，风险太高 |

### 问题 4：如何豁免长文任务

上游靠"Auto-Clarity"段落规则（模型自己判断何时展开）。本地版改为 **config 驱动的 allowlist**：

- `allowlist_skills` 列表在 `caveman-config.json`
- `hooks/caveman-inject.py` 检测当前 prompt 是否包含 `/skill-name` 或 `<command-name>skill-name</command-name>`
- 命中豁免列表 → 注入"本次允许详细输出"反向提示
- 未命中 → 注入简洁协议

默认豁免：`brainstorm`, `eat`, `orchestrate`, `locate`, `promote-notes`, `dual-review-loop`, `lesson-review`, `metrics-*`, `architecture-health`, `skill-creator`, `pencil-design`, `multi-model-agent`

可通过 `/caveman-mode allowlist add <skill>` 扩展。

### 问题 5：全局开关设计

对齐 `promotion-mode`：

- 配置文件：`~/.claude/caveman-config.json`（机器本地，不入 git）
- 管理脚本：`hooks/caveman-mode.py`（`enable` / `disable` / `status` / `intensity` / `allowlist`）
- 主命令：`commands/caveman-mode.md`
- 别名：`caveman-on` / `caveman-off` / `caveman-status`

## 最终落点

```
~/.claude/
├── skills/vendor/caveman/
│   ├── UPSTREAM.md                       # fork commit + diff 摘要 + 同步上游命令
│   ├── caveman/SKILL.md                  # 中文协议主 skill
│   ├── caveman-commit/SKILL.md           # 中文提示，Conventional Commits 英文输出
│   ├── caveman-review/SKILL.md           # 中文化单行 review
│   └── caveman-compress/SKILL.md         # 中文 memory 文件压缩（不引入 Python CLI）
├── hooks/
│   ├── caveman-mode.py                   # 全局开关管理
│   └── caveman-inject.py                 # UserPromptSubmit 注入
├── commands/
│   ├── caveman-mode.md                   # 主命令
│   ├── caveman-on.md / off.md / status.md  # 别名
├── rules-library/pattern/
│   └── concise-chinese-output.md         # 哲学沉淀（caveman 关闭时仍是基线）
├── notes/research/
│   └── caveman-vendor-integration.md     # 本文
└── caveman-config.json                   # 运行时配置（本地，不入 git）
```

## 未引入的上游内容

- `plugins/caveman/` - 与 vendor 模式冲突
- `hooks/caveman-activate.js` / `caveman-config.js` - 由 Python 版本替代
- `hooks/caveman-statusline.*` - 暂不接入
- `hooks/install.*` / `uninstall.*` - 手动落位
- `CLAUDE.md` / `CLAUDE.original.md` - 不覆盖用户全局
- `.cursor/` / `.windsurf/` / `.clinerules/` - 不维护这些 agent
- `benchmarks/` / `evals/` / `tests/` - 非运行期需要
- `skills/caveman-help/` - 英文帮助，被 `commands/caveman-mode.md` 替代
- 文言文档位 - 与中文用户交流规范冲突

## 上游同步策略

**不保留 upstream-snapshot**（用户选择），原因：

- 仓库更干净
- 差异越来越大时快照反而误导
- 需要时用 `/tmp/caveman-upstream` 做临时 diff 即可

同步流程见 `skills/vendor/caveman/UPSTREAM.md`。

## 默认启动状态

用户选择 **默认 on**（装好即生效）：

- `caveman-config.json` 初始化时 `enabled: true`
- `intensity: lite`（最低档，仅去客套 + hedging，句式不变）
- 首次使用观察 1-2 天，根据体验调整档位

## Codex 侧

- `skills/vendor/caveman/` 通过现有 `hooks/codex-sync/` 同步到 `~/.codex/skills/`（自动）
- **Codex 端不启用 auto-activation**（`.codex/hooks.json` 注入暂缓）
- Codex 可手动调用 `/caveman-commit` 等命令，不改全局行为
- 如后续需要 Codex auto-activation，再另评估 `hooks/codex-sync/` 的兼容性

## 风险与观察

1. **复杂任务输出被压缩风险** → 用 allowlist 豁免，初始清单偏宽
2. **上游更新脱节风险** → 不保留 snapshot，依赖定期手动 diff
3. **与现有 UserPromptSubmit hooks 争抢** → 注入顺序排在 skill-inject / rules-inject 之后
4. **Codex 同步冲突** → 暂不启用 Codex 侧 auto-activation，先跑 CC 单边

## 知识沉淀

| 沉淀目标 | 位置 | 理由 |
|---------|------|------|
| 调研过程与决策 | `notes/research/caveman-vendor-integration.md`（本文） | 单次决策，保留证据链 |
| 哲学 → 规则 | `rules-library/pattern/concise-chinese-output.md` | 跨任务复用，caveman 关闭时仍需 |
| 本地 fork 说明 | `skills/vendor/caveman/UPSTREAM.md` | 下次同步上游时需要 |

## 参考

- 上游：[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)
- Landing：[Caveman | Lithic Token Compression](https://juliusbrussee.github.io/caveman/)
- 研究基础声称："Brevity Constraints Reverse Performance Hierarchies in Language Models", 2026-03
- promotion-mode 参考实现：`hooks/promotion-mode.py`, `commands/promotion-mode.md`
- vendor skill 先例：`skills/vendor/impeccable/`
