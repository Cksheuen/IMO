---
name: promote-notes
description: notes 晋升技能。当 `notes/` 中的 lesson、research、design 已满足稳定条件时，执行被动晋升评估，决定是否提炼为 `rules/`、`skills/` 或 `memory/`。当用户要求”提炼 notes””把经验升格成规则/技能””检查哪些 note 可以晋升”时触发；也可在运行中由 Promotion Loop 自动调用。
---

# Promote Notes - 被动晋升技能

**专注把已经稳定的 note 晋升为更强约束的知识资产。**

此技能既可被用户显式调用，也可在运行过程中被 `Promotion Loop` 自动调用。

## 执行位置

| 触发方式 | 执行位置 | 原因 |
|---------|---------|------|
| **自动触发（Stop hook）** | **后台独立进程** | 不打断主 agent 流程 |
| 用户显式调用 `/promote-notes` | 当前 agent | 用户主动请求 |

### 自动触发的后台执行

当 `lesson-gate.sh` 检测到未处理的纠正信号时：

1. 使用 `nohup claude --print -p “...” &` 启动后台进程
2. 进程独立运行，不阻塞主 agent
3. 日志输出到 `~/.claude/logs/lesson-capture/background-*.log`
4. 主 agent 正常结束（`exit 0`），用户流程不被打断

**关键约束**：
- 后台进程不向主 agent 输出任何内容
- 用户不会看到 `[LESSON CAPTURE REQUIRED]` 等提示
- Lesson capture 在后台静默完成

`promote-notes` 与 `eat` 的边界：

- `eat`：吸收**新资料**，主动形成新知识
- `promote-notes`：评估**旧 note** 是否成熟到可以被动升格

```
note 达到稳定门槛 → 晋升评估 → rules / skills / memory / 保持在 notes
```

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

- [ ] 若输入已包含 `promotionScan.candidates`，优先使用这些候选
- [ ] 否则搜索 `notes/lessons/` 中 `Status: candidate-rule` 的 note
- [ ] 否则补充搜索最近被反复更新的 `notes/research/` / `notes/design/`
- [ ] 记录每个候选 note 的 `Last Verified`、`Source Cases`、`Promotion Criteria`

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
| 主要是检索路标或项目索引 | `memory/` |
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
