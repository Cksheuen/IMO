# Agent 文件操作效率规范

> 来源：重构场景下 Read/Write/Edit vs 命令行工具的 token 消耗分析 + 业界调研（Aider/Codex/Cursor 编辑格式对比） | 吸收时间：2026-04-15

## 核心问题

Agent 在重构、拆分、移动文件时，默认使用 Read + Edit/Write 工作流，导致文件内容在上下文中被反复传输。对于纯结构操作（移动、重命名、块级提取/删除），命令行工具可以将操作阶段的 token 消耗从数千降到数十。

## 核心原则

**理解用 Read，精确修改用 Edit，搬迁和块操作用脚本。**

- Agent 至少需要 Read 一次来理解内容和操作意图
- 少量精确修改（< 10 行）交给 Edit 工具（CC/Codex 已优化的核心能力）
- 整文件搬迁和块级提取/删除交给操作脚本（Edit 不覆盖的场景）

## 行号可靠性警告

> **业界共识：LLM 对行号的处理不可靠。**
>
> - Aider 设计原则明确指出"避免脆弱的行号指定符"
> - OpenAI apply_patch 格式显式声明"不使用行号，上下文足以唯一定位"
> - Claude Code Read 工具的行号前缀会导致 agent 误判行宽（已知 bug #36654）
> - 多段操作时行号必然漂移，除非从末尾向前操作
>
> **因此，操作脚本采用内容锚定（grep 模式匹配）定位，行号仅作辅助验证。**

## 触发条件

当满足以下任一条件时，必须应用本规范：

- 文件重构：拆分、合并、提取模块
- 文件搬迁：移动、重命名、目录重组
- 批量操作：多文件同类修改
- 大文件编辑：文件超过 200 行的增删操作

## 工具选择矩阵

| 操作类型 | 推荐工具 | Token 消耗 | 备注 |
|----------|---------|-----------|------|
| 整文件移动/重命名 | `safe-move.sh` | ~30 | 带安全校验的 mv |
| 整文件复制 | `cp` | ~25 | 简单场景直接用 |
| 目录重组 | `mkdir -p` + `safe-move.sh` | ~60 | 批量可用循环 |
| 从大文件提取代码块到新文件 | `extract-block.sh` | ~60 | 内容锚定，非行号 |
| 删除文件中的代码块 | `remove-block.sh` | ~60 | 内容锚定，非行号 |
| 少量精确修改（< 10 行） | Edit 工具 | old + new | CC/Codex 已优化，不重复造轮 |
| 新建小文件（< 50 行） | Write 工具 | 文件内容 | 内容量小，Write 直接 |
| 内容理解/审查 | Read 工具 | 文件全文 | 不可避免，但只需一次 |

## 决策框架

```
需要修改文件？
    │
    ├─ 内容不变，只移动/重命名
    │   → safe-move.sh（~30 tokens，带安全校验）
    │
    ├─ 需要理解内容后操作
    │   │
    │   ├─ Step 1: Read 理解内容（不可避免）
    │   │
    │   └─ Step 2: 选择操作方式
    │           │
    │           ├─ 改动 < 10 行且需精确匹配
    │           │   → Edit 工具（CC/Codex 核心能力）
    │           │
    │           ├─ 整个函数/类/块提取到新文件
    │           │   → extract-block.sh（内容锚定）
    │           │
    │           ├─ 整个函数/类/块从文件中删除
    │           │   → remove-block.sh（内容锚定）
    │           │
    │           └─ 大部分保留，少量删除（保留比 > 70%）
    │               → Edit 删除少量段落
    │
    └─ 批量同类操作（多文件）
        → for 循环 + safe-move.sh / extract-block.sh
```

## 操作脚本体系

脚本位于 `~/.claude/hooks/file-ops/`，分两层：

```yaml
安全层:
  文件: hooks/file-ops/safe-op-lib.sh
  职责: git snapshot、路径校验、操作后验证、失败回滚
  被所有操作脚本 source

搬迁操作:
  文件: hooks/file-ops/safe-move.sh
  接口: safe-move.sh <src> <dst>
  功能: mv 的安全包装（源存在校验、目标冲突检测、git snapshot）

块提取:
  文件: hooks/file-ops/extract-block.sh
  接口: extract-block.sh <file> <start-pattern> <end-pattern> <dst>
  功能: 用 grep 锚定起止位置，sed 提取到新文件
  定位方式: 内容模式匹配，非行号

块删除:
  文件: hooks/file-ops/remove-block.sh
  接口: remove-block.sh <file> <start-pattern> <end-pattern>
  功能: 用 grep 锚定起止位置，sed 原地删除
  定位方式: 内容模式匹配，非行号
```

### 内容锚定 vs 行号

```bash
# ❌ 脆弱：行号在多段操作时漂移，LLM 计数行号容易出错
sed -n '50,120p' file.ts > new.ts

# ✅ 可靠：用内容模式锚定起止位置
extract-block.sh file.ts \
  "^export function targetFunc" \
  "^export (function|class|const)" \
  new.ts
```

### 安全机制

每个操作脚本执行前后：

1. **git stash 快照**：操作前自动保存工作目录状态
2. **路径校验**：源文件存在、目标不冲突、无目录穿越
3. **操作后验证**：检查目标文件非空、源文件仍合法
4. **失败回滚**：任何步骤失败自动恢复到快照

## 保留比决策

当从文件中拆分内容时，按保留比例选择方案：

| 保留比 K/N | 推荐方案 | 消耗估算（N=1000 tokens 文件） |
|-----------|---------|------------------------------|
| > 70% | Read + Edit 删除少量段落 | N + 0.3N ≈ 1300 |
| 30%-70% | Read + extract-block.sh 提取 + remove-block.sh 删除 | N + ~120 ≈ 1120 |
| < 30% | Read + extract-block.sh 提取需要的部分 | N + ~60 ≈ 1060 |
| 0%（纯移动） | safe-move.sh | ~30 |

## 连续重构场景优化

当从同一文件拆出多个模块时：

```
Read file.ts（1 次，~N tokens）
    │
    ├─ 识别模块边界（函数/类签名）
    │
    ├─ 从末尾开始操作（避免前面操作影响后面的锚定）：
    │   ├─ extract-block.sh file.ts "^export class C" "^export" moduleC.ts  (~60 tokens)
    │   ├─ remove-block.sh file.ts "^export class C" "^export"             (~60 tokens)
    │   ├─ extract-block.sh file.ts "^export class B" "^export" moduleB.ts  (~60 tokens)
    │   ├─ remove-block.sh file.ts "^export class B" "^export"             (~60 tokens)
    │   └─ ...
    │
    └─ 补充 import 语句：Edit 工具（小改动，~50 tokens）
```

总消耗：N + ~290 tokens（操作阶段）
对比 Read + Write×3 + Edit：N + 3K + edit_delta（内容大量重复传输）

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 用 Read + Write 完成纯文件移动 | 用 `safe-move.sh`，节省 ~98% token |
| 用 Write 创建新文件，内容是刚 Read 过的子集 | 用 `extract-block.sh` 按内容锚定提取 |
| 依赖 LLM 准确记忆行号做 sed 操作 | 用内容模式锚定，行号仅辅助验证 |
| 从文件头部开始逐段操作 | 从末尾向前操作，避免锚定漂移 |
| 大文件全量 Write 只为改几行 | 用 Edit 精确修改（CC/Codex 核心能力） |
| 重新实现 Edit/apply_patch 的匹配引擎 | CC 和 Codex 已优化此能力，不重复造轮 |

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/core/architecture-evolution.md` | 架构升级的"小手术"执行层，本规范指导手术时的工具选择 |
| `rules/pattern/change-scope-guard.md` | 控制改什么；本规范控制怎么改最省 |
| `rules/pattern/change-impact-review.md` | 操作后验证行为不变 |

## 检查清单

- [ ] 纯移动/重命名是否使用了 `safe-move.sh` 而非 Read+Write？
- [ ] 块级提取/删除是否使用了内容锚定而非硬编码行号？
- [ ] 多段操作是否从末尾向前？
- [ ] 精确小修改是否交给 Edit 工具（不重复造轮）？
- [ ] 操作方式是否匹配保留比？
- [ ] 批量操作是否用循环而非逐个 Read+Write？

## 参考

- [Edit formats | aider](https://aider.chat/docs/more/edit-formats.html) — 编辑格式设计四原则
- [Apply Patch | OpenAI API](https://developers.openai.com/api/docs/guides/tools-apply-patch) — 上下文锚定替代行号
- [Code Surgery | Fabian Hertwig](https://fabianhertwig.com/blog/coding-assistants-file-edits/) — AI 编辑格式全景对比
- [Claude Code #36654](https://github.com/anthropics/claude-code/issues/36654) — Read 行号前缀导致 Edit 短行 bug
