# Caveman Vendor Fork

> 本目录是 [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) 的本地魔改版本。

## 上游基线

- 仓库：`https://github.com/JuliusBrussee/caveman`
- Fork commit：`c2ed24b3e5d412cd0c25197b2bc9af587621fd99`
- Fork 日期：2026-04-17
- License：MIT（已遵守归属）

## 本地改动概述

| 维度 | 上游 | 本地版 |
|------|------|--------|
| 协议语言 | terse English + 文言文 | 简洁中文（英文术语/代码保留） |
| 废话 pattern | 英文 filler（sure/certainly/happy to） | 中文客套（好的/我来帮你/可能需要考虑一下） |
| 激活方式 | SessionStart hook（Node.js） | UserPromptSubmit hook（Python，`hooks/caveman-inject.py`） |
| 配置路径 | `~/.config/caveman/config.json` | `~/.claude/caveman-config.json`（对齐 `promotion-config.json`） |
| 档位 | lite / full / ultra / wenyan-* / commit / review / compress | lite / full / ultra（中文版；wenyan 系不引入） |
| 豁免机制 | Auto-Clarity 段落规则 | config 驱动的 `allowlist_skills`，brainstorm / eat / orchestrate 等显式豁免 |
| CLAUDE.md 压缩 | 上游默认覆盖全局 CLAUDE.md | **不启用**（禁止覆盖用户全局 CLAUDE.md） |
| plugin 安装 | `claude plugin install` | **不走**，走 vendor skill + 本地 hook |

## 未引入的上游内容

- `plugins/caveman/` — plugin marketplace 包，与 vendor 模式冲突
- `hooks/caveman-activate.js` / `caveman-config.js` — 由 `~/.claude/hooks/caveman-inject.py` 替代
- `hooks/caveman-statusline.*` — 暂不接入 status line
- `hooks/install.*` / `uninstall.*` — 手动落位，不需要安装脚本
- `CLAUDE.md` / `CLAUDE.original.md` — 不能覆盖用户全局 CLAUDE.md
- `.cursor/` / `.windsurf/` / `.clinerules/` — 本仓库不维护这些 agent
- `benchmarks/` / `evals/` / `tests/` — 评测套件，非运行期需要
- `skills/caveman-help/` — 上游是英文帮助，由 `commands/caveman-mode.md` 替代
- 文言文档位（wenyan-lite / full / ultra）— 用户交流语言规范要求中文，文言文超出需求

## 引入的上游内容（魔改后）

| 上游路径 | 本地路径 | 改动 |
|---------|---------|------|
| `skills/caveman/SKILL.md` | `skills/vendor/caveman/caveman/SKILL.md` | 完整重写为中文协议 |
| `skills/caveman-commit/SKILL.md` | `skills/vendor/caveman/caveman-commit/SKILL.md` | 提示中文化，Conventional Commits 格式保留英文 |
| `skills/caveman-review/SKILL.md` | `skills/vendor/caveman/caveman-review/SKILL.md` | 提示中文化，单行 review 格式保留 |
| `skills/compress/SKILL.md` | `skills/vendor/caveman/caveman-compress/SKILL.md` | 压缩目标改为中文 `CLAUDE.md` / notes / todos；脚本未引入（避免 Python CLI 依赖） |

## 上游更新跟进

当需要同步上游时：

```bash
# 1. 克隆最新上游到临时目录
mkdir -p /tmp/caveman-upstream && cd /tmp/caveman-upstream
git clone --depth=1 https://github.com/JuliusBrussee/caveman.git .
NEW_COMMIT=$(git rev-parse HEAD)

# 2. 对比本地 SKILL.md 与上游 skills/<name>/SKILL.md
diff /tmp/caveman-upstream/skills/caveman/SKILL.md \
     ~/.claude/skills/vendor/caveman/caveman/SKILL.md

# 3. 评估上游变更是否值得合入本地中文版
#    - 新增规则 → 翻译进中文版
#    - 新增档位 → 评估是否与中文简洁协议冲突
#    - 废话 pattern 更新 → 不直接照搬（英文 pattern 对中文无意义）

# 4. 更新本文件中的 "Fork commit" 与 "Fork 日期"
```

## 相关资产

- 开关脚本：`~/.claude/scripts/caveman-mode.py`
- 注入 hook：`~/.claude/hooks/caveman-inject.py`
- 主命令：`~/.claude/commands/caveman-mode.md`
- 别名：`caveman-on.md` / `caveman-off.md` / `caveman-status.md`
- 运行时配置：`~/.claude/caveman-config.json`（本地状态，不入 git）
- 哲学沉淀：`~/.claude/rules-library/pattern/concise-chinese-output.md`
- 决策记录：`~/.claude/notes/research/caveman-vendor-integration.md`
