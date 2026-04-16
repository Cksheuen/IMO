---
name: promote-notes
description: notes 晋升技能。当 `notes/` 中的 lesson、research、design 已满足稳定条件时，执行被动晋升评估，决定是否提炼为 `rules/`、`skills/` 或 `memory/`。当用户要求”提炼 notes””把经验升格成规则/技能””检查哪些 note 可以晋升”时触发；也可在运行中由 Promotion Loop 自动调用。
description_en: "Notes promotion skill. Evaluates lessons, research, and design notes in `notes/` for passive promotion and decides whether they should be distilled into rules, skills, or memory."
---

# Promote Notes - 被动晋升技能

**专注把已经稳定的 note 晋升为更强约束的知识资产。**

## 当前设计优先级

**默认采用“手动触发 `/promote-notes` 为主，自动扫描/排队为辅”。**

原因：

- `rules/`、`skills/`、`memory/declarative/` 的污染成本不同，不能把后台自动晋升当默认主路径
- 自动 Promotion Loop 的主要价值是保留候选信号，不是替代人工做最终抽象决策
- 用户显式触发时，允许批量处理 queue 中的候选，并在当前 agent 中完成收敛、写结果、应用结果

此技能既可被用户显式调用，也可在运行过程中被 `Promotion Loop` 自动调用。

用户侧应通过命令切换模式，而不是直接编辑配置文件：

- `/promotion-mode on`：允许 Stop / SubagentStop 在后台自动扫描并执行 Promotion Loop
- `/promotion-mode off`：禁止自动后台触发，只保留用户手动 `/promote-notes`
- `/promotion-mode status`：查看当前模式

兼容别名仍可用：
- `/promotion-auto-on`
- `/promotion-auto-off`
- `/promotion-auto-status`

底层状态仍落在仓库根目录 `promotion-config.json`，但那是运行时存储，不是推荐的用户入口。

## 执行位置

| 触发方式 | 执行位置 | 原因 |
|---------|---------|------|
| 用户显式调用 `/promote-notes` | 当前 agent | 用户主动请求 |

> **变更说明**（2026-04-15）：`lesson-gate.sh` 已从全局 `settings.json` 的自动 Stop hook 中移除。自动后台触发路径不再存在于共享 runtime 中。晋升的唯一入口是用户手动 `/promote-notes`。

**当前收敛后的推荐理解**：

- 自动模式默认只负责 `scan -> queue -> status reminder`
- 真正的晋升主路径默认是用户显式 `/promote-notes`
- 只有低风险、低歧义的 candidate 才值得考虑恢复后台自动晋升

`promote-notes` 与 `eat` 的边界：

- `eat`：吸收**新资料**，主动形成新知识
- `promote-notes`：评估**旧 note** 是否成熟到可以被动升格
- `promote-notes`：是 `memory/declarative/` 的 owner，负责 declarative 落盘决策与写入

```
note 达到稳定门槛 → 晋升评估 → rules / skills / memory / 保持在 notes
```

### Declarative Memory（target=memory）协议

当晋升目标是 `memory/declarative/` 时，`promote-notes` 只能产出 **canonical fact candidate**，禁止把 note 原文直接搬运进 declarative store。

- 允许内容：`subject`、`key`、`value`、`valueType`、`scope`、`source`、`updatedAt`、`lastVerifiedAt`
- 禁止内容：note body、长段解释、task 进度叙述、transcript 过程复述
- 写入要求：先 canonicalize 为 fact candidate，再按 contract `upsert(subject + key)`

## 核心原则

| 原则 | 含义 |
|------|------|
| **Passive-promotion** | 只处理已有 note 的升格，不处理新资料吸收 |
| **Stability-first** | 未稳定的 note 不晋升，宁可继续观察 |
| **Promotion-by-evidence** | 至少基于复用、触发条件、执行步骤等证据判断 |
| **Minimal-upgrade** | 能升成短 rule 就不要硬拆 skill |
| **No-forced-promotion** | 如果 note 仍主要是解释背景，就继续留在 notes |

## 适用场景

- 用户说“把这些 notes 提炼成规则”
- 用户说“哪些 lesson 已经能升格了”
- 某个 `candidate-rule` 状态的 note 需要评估去向
- 同一主题在多个任务中反复出现
- 某次 loop 写完 note 后已满足自动晋升门槛

## 执行流程

### 自动调用输入

当由 `Promotion Loop` 自动调用时，可直接使用 hook 扫描结果作为输入：

```json
{
  "promotionScan": {
    "hasCandidates": true,
    "candidates": [
      {
        "path": "notes/lessons/xxx.md",
        "signal": "candidate-rule"
      }
    ]
  }
}
```

此时应优先处理这些候选 note，而不是重新全量扫描。

当前运行时也允许通过 queue dispatch 输入：

```json
{
  "promotionDispatch": {
    "queuePath": "promotion-queue.json",
    "candidates": [
      {
        "path": "notes/lessons/xxx.md",
        "signal": "candidate-rule",
        "status": "processing"
      }
    ]
  }
}
```

当 `promotionDispatch.candidates` 已存在时，应只处理这些已被主 agent claim 的候选。

### subagent 执行约束

当由系统自动触发时，应把 `promote-notes` 交给独立 subagent 执行，并遵守：

- 主 agent 不直接在当前用户链路中展开完整晋升分析
- subagent 读取 queue / 候选 note 后独立完成评估
- subagent 完成后回传：是否晋升、去向、更新了哪些文件、是否清空 queue
- subagent 完成后应写 `promotion-result.json`，并由主链路显式运行 `python3 "$HOME/.claude/.claude/hooks/promotion-apply-result.py" --result-file promotion-result.json`

### Step 0: 候选 note 检索（必须执行）

**强制动作**：

- [ ] 若输入已包含 `promotionDispatch.candidates`，优先只处理这些已 claim 的候选
- [ ] 否则若输入已包含 `promotionScan.candidates`，优先使用这些候选
- [ ] 否则搜索 `notes/lessons/` 中 `Status: candidate-rule` 的 note
- [ ] 否则补充搜索最近被反复更新的 `notes/research/` / `notes/design/`
- [ ] 记录每个候选 note 的 `Last Verified`、`Source Cases`、`Promotion Criteria`

**手动主路径补充**：

- [ ] 若存在 `promotion-queue.json`，先检查 queue 状态，而不是直接全量扫描
- [ ] 手动触发时优先按小批量处理（建议每批 `1-3` 个候选）
- [ ] 若 queue 中已有 `processing` 项，先判断是否需要 `release/fail/apply` 收尾，再继续 claim 新候选
- [ ] 优先使用 `hooks/promote-notes-run.py` 作为人工 helper，而不是手工拼结果文件

**检索重点**：

- 是否存在重复复用
- 是否已有明确触发条件
- 是否已经形成执行步骤
- 是否仍严重依赖单次案例

### Step 1: 晋升资格判断

满足任意两项，才进入下一步：

- 同一主题被再次复用
- 触发条件已经清晰
- 执行步骤已经稳定
- 决策框架不再依赖单个案例
- 不同任务中出现相同模式

若不满足：保持在 `notes/`，仅更新状态与说明。

### Step 2: 去向决策

| 条件 | 去向 |
|------|------|
| 短、稳定、可执行、应频繁引用 | `rules/` |
| 长流程、工具导向、适合按需触发 | `skills/` |
| 跨 session 稳定事实（可 canonicalize） | `memory/declarative/`（canonical fact candidate） |
| 主要是检索路标或项目索引 | `memory/`（非 declarative） |
| 仍偏解释性、案例性 | 保持在 `notes/` |

### Step 3: 去重与冲突检查

**必须检查**：

- `rules/**/*.md`
- `skills/*/SKILL.md`
- `memory/**/*.md`

**处理方式**：

- 完全重复：不晋升，只更新现有资产
- 部分重叠：合并精华，补充新证据
- 有冲突：对比优劣，必要时放弃晋升

### Step 4: 晋升动作

若决定晋升：

1. 创建或更新目标 `rule` / `skill` / `memory`
2. 在原 note 中记录晋升去向
3. 更新原 note 的状态，例如 `promoted`
4. 保留 `Source Cases` 作为来源链路

**手动主路径执行顺序**：

1. `python3 "$HOME/.claude/hooks/promote-notes-run.py" scan`
2. `python3 "$HOME/.claude/hooks/promote-notes-run.py" list`
3. `python3 "$HOME/.claude/hooks/promote-notes-run.py" claim --count <N>`
4. `python3 "$HOME/.claude/hooks/promote-notes-run.py" stub-result`
5. 手动编辑 `promotion-result.json`
6. `python3 "$HOME/.claude/hooks/promote-notes-run.py" apply`
7. 复查 queue 是否已出队，必要时再处理下一批

helper 约束：

- `stub-result` 只生成可编辑模板，不自动推断最终 action
- 默认 stub 会用 `defer` 占位，必须人工改成 `promoted_to_rule` / `promoted_to_skill` / `indexed_in_memory` / `keep` / `merge`
- helper 只减少机械性输入，不替代晋升判断

若目标是 `memory/declarative/`，将第 1 步收紧为：

1. 仅生成 canonical fact candidate（不复制 note 正文）
2. 校验 candidate 满足 declarative contract
3. 以 `subject + key` 执行 `upsert`

若决定不晋升：

1. 更新原 note 的 `Promotion Criteria` 或状态说明
2. 说明为什么继续停留在 `notes/`

## 输出模板

当前推荐的结构化结果文件格式：

```json
{
  "promotionDispatchResult": {
    "status": "completed",
    "processed": [],
    "deferred": [],
    "failed": []
  }
}
```

其中：

- `processed`：已完成晋升或已明确保留在 notes 且可出队
- `deferred`：证据不足，继续留在 queue 观察
- `failed`：本次评估失败，需保留并记录原因

`processed` 中的最小推荐字段：

```json
{
  "path": "notes/lessons/example.md",
  "action": "promoted_to_rule | promoted_to_skill | indexed_in_memory | keep | merge",
  "target_path": "rules-library/pattern/example.md",
  "reason": "why this decision was made"
}
```

当 `action = indexed_in_memory` 时，必须额外提供 canonical declarative record：

```json
{
  "path": "notes/lessons/example.md",
  "action": "indexed_in_memory",
  "target_path": "memory/declarative/user-preferences.json",
  "reason": "stable cross-session fact",
  "record": {
    "id": "user.output-language",
    "kind": "preference",
    "subject": "user",
    "key": "output.language",
    "value": "zh-CN",
    "valueType": "string",
    "scope": "cross-session",
    "status": "active",
    "source": {
      "type": "file",
      "ref": "notes/lessons/example.md"
    },
    "updatedAt": "2026-04-13",
    "lastVerifiedAt": "2026-04-13"
  }
}
```

当 `action = keep` 时，表示“本次已评估并继续留在 notes，可出队”；不要把这种项写成 `failed`。

当 `action = promoted_to_skill` 时，生成模板应优先提炼：

- 适用场景
- 执行流程
- 输出要求
- 边界与不适用场景
- 来源与决策依据

不要把 note body 原样整段搬进 `## 执行流程`。

```markdown
# Notes 晋升评估

## 候选 note
- 来源：notes/xxx.md
- 当前状态：active / candidate-rule / stale
- 复用证据：...

## 晋升判断
- 是否满足门槛：是/否
- 理由：...

## 去向决策
- 目标：rules / skills / memory / 保持在 notes
- 理由：...

## 执行动作
- 新增/更新文件：...
- 原 note 状态更新：...
```

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 因为 note 写得多就强行晋升 | 必须先检查稳定证据 |
| 把解释性材料升成强约束 rule | 继续留在 notes |
| 旧 note 的升格仍交给 `eat` | 使用 `promote-notes` |
| 晋升后丢失来源链路 | 在原 note 记录去向与来源 |

## 阻断条件

以下情况禁止晋升：

1. 候选 note 没有复用证据
2. 没有明确触发条件或执行步骤
3. 与已有 rule/skill 高度重复但未做对比
4. note 仍明显依赖单次案例

阻断时的行动：

- 告知“暂不满足晋升条件”
- 更新 note 的 `Promotion Criteria`
- 保持在 `notes/` 继续观察
