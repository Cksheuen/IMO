---
name: dual-review-loop
description: CC + Codex 双重审查循环。用户触发 /dual-review-loop 后，在 Claude Code 实现与 Codex review 之间建立自动迭代循环，直到代码通过审查或达到最大轮次。当用户说"双重审查"、"codex 循环审查"、"review loop"、"让 codex 帮我审一下然后修"时触发。此 skill 仅限用户主动调用，禁止 agent 自动触发。
---

# Dual Review Loop - CC + Codex 双重审查循环

**在 Claude Code 实现与 Codex 审查之间建立迭代闭环，直到代码质量通过双方验证。**

```
CC 实现 → Codex review → 有问题？→ Codex rescue 诊断 → CC review 确认
    → CC implement 修复 → Codex review 验证 → 循环直到通过
```

## 重要约束

**此 skill 仅限用户通过 `/dual-review-loop` 主动触发。**

禁止在以下场景自动触发：
- 简单 bug fix 或单文件修改
- 用户未明确要求双重审查
- 任务复杂度为 Trivial/Simple

理由：每轮循环消耗 Codex API 调用 + CC token，简单任务使用此 skill 是浪费。

## 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--max-rounds` | 3 | 最大迭代轮次 |
| `--scope` | auto | Codex review 范围（auto/working-tree/branch） |
| `--base` | （无） | Codex review 的 base ref |
| `--skip-rescue` | false | 跳过 Codex rescue 诊断，直接由 CC 分析 |

解析方式：从 `$ARGUMENTS` 中提取，未提供则使用默认值。

## 执行流程

### Step 0: 初始化审查报告

创建或更新 `dual-review-report.json`（位于当前项目 task 目录，若无 task 则放在 cwd）：

```json
{
  "created_at": "<timestamp>",
  "max_rounds": 3,
  "scope": "auto",
  "current_round": 0,
  "status": "in_progress",
  "rounds": []
}
```

### Step 1: Codex Review

调用 Codex 原生审查：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" review --wait [--scope <scope>] [--base <base>]
```

解析 review 输出，提取结构化结果：

```yaml
verdict: approve | needs-attention
findings:
  - severity: critical | high | medium | low
    title: "..."
    file: "path"
    line_start: N
    line_end: N
    recommendation: "..."
```

### Step 2: 判断是否通过

```
verdict == "approve" 且无 critical/high findings？
    │
    ├─ 是 → 记录本轮结果 → 输出最终报告 → 结束
    │
    └─ 否 → 继续 Step 3
```

**通过标准**：
- verdict 为 `approve`
- 无 `critical` 或 `high` severity 的 finding
- `medium`/`low` 的 finding 仅记录，不触发修复循环

### Step 3: Codex Rescue 诊断（可选）

如果 `--skip-rescue` 未设置，且存在 critical/high findings：

将 findings 整理为诊断请求，调用 Codex rescue 进行深度分析：

```
/codex:rescue --wait 针对以下 review findings 进行深度诊断，分析根因并给出具体修复方案：
[findings 摘要，按 severity 排序]
```

Codex rescue 的输出包含更详细的根因分析和修复建议。

如果 `--skip-rescue` 设置或 findings 都是 medium/low，跳过此步，直接用 review findings 作为修复依据。

### Step 4: CC Reviewer 审查

启动 CC reviewer agent 审查 Codex 的诊断结果：

```
Agent(subagent_type: "reviewer", prompt: "
审查以下 Codex review 发现和诊断结果，确认哪些问题需要修复：

## Codex Review Findings
[findings]

## Codex Rescue 诊断（如有）
[rescue output]

任务要求：
1. 确认每个 finding 是否为真实问题（排除误报）
2. 对确认的问题按影响排序
3. 为每个需修复的问题生成 delta_context
4. 输出结构化的修复清单
")
```

CC reviewer 的职责是**过滤误报**——Codex review 可能产生 false positive，CC reviewer 基于对项目上下文的理解进行二次确认。

### Step 5: CC Implementer 修复

对每个确认需修复的问题，启动 CC implementer agent：

```
Agent(subagent_type: "implementer", prompt: "
修复以下审查发现的问题：

## 修复清单
[confirmed issues with delta_context]

约束：
- 只修复清单中列出的问题，不做额外改动
- 每个修复完成后 git commit
- 遵循 change-scope-guard 规范
")
```

如果有多个独立问题，可并行启动多个 implementer（使用 worktree 隔离）。

### Step 6: 记录本轮结果

更新 `dual-review-report.json`：

```json
{
  "round": 1,
  "codex_review": {
    "verdict": "needs-attention",
    "findings_count": { "critical": 1, "high": 2, "medium": 3, "low": 1 },
    "findings": [...]
  },
  "codex_rescue": {
    "ran": true,
    "summary": "..."
  },
  "cc_review": {
    "confirmed_issues": 2,
    "false_positives": 1,
    "issues": [...]
  },
  "cc_fix": {
    "fixed": 2,
    "commits": ["abc1234", "def5678"]
  }
}
```

### Step 7: 循环判断

```
current_round < max_rounds？
    │
    ├─ 是 → current_round++ → 回到 Step 1
    │
    └─ 否 → 输出最终报告 → 标记 status = "max_rounds_reached" → 结束
```

## 与 feature-list.json 集成

如果当前 task 目录存在 `feature-list.json`，每轮结束后同步更新：

- Codex review 发现的 critical/high 问题 → 对应 feature 的 `passes` 设为 `false`
- CC implementer 修复后 → 对应 feature 的 `passes` 重置为 `null`（等待下轮验证）
- 最终通过 → 对应 feature 的 `passes` 设为 `true`

这确保 verification-gate 的 Stop hook 能感知双重审查的状态。

## 最终报告格式

循环结束后，输出结构化报告：

```markdown
## Dual Review Loop 报告

### 总览
- 轮次：2/3
- 最终状态：通过 ✅ / 未通过 ⚠️
- 总发现问题数：7
- 确认真实问题数：5（误报率 28%）
- 已修复：5

### 各轮摘要

#### Round 1
- Codex 发现：3 critical, 2 high, 2 medium
- CC 确认：4 个真实问题，1 个误报
- 已修复：4 个

#### Round 2
- Codex 发现：0 critical, 0 high, 1 medium
- 结论：通过

### 残留 Medium/Low 问题（仅记录）
- [file:line] 描述...
```

## 决策框架

### 何时使用此 skill

```
任务完成后想确保质量？
    │
    ├─ 简单修改（1-2 文件，明确的 fix）→ 不需要，直接 /codex:review 即可
    │
    ├─ 中等修改（功能实现，3+ 文件）→ 可选使用
    │
    └─ 复杂修改（架构变更、跨模块重构）→ 推荐使用
```

### Codex Review vs 此 Skill

| 场景 | 推荐工具 |
|------|---------|
| 快速 review 看一眼 | `/codex:review` |
| 需要自动修复循环 | `/dual-review-loop` |
| 对抗性审查（找设计缺陷）| `/codex:adversarial-review` |
| 实现 + review + 修复闭环 | `/dual-review-loop` |

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| Codex 未安装/未认证 | 提示用户运行 `/codex:setup` |
| Codex review 超时 | 记录超时，跳过本轮 rescue，由 CC 独立审查 |
| Codex rescue 失败 | 降级为 CC-only 审查，继续循环 |
| Implementer 修复引入新问题 | 下一轮 Codex review 会捕获，自然进入修复循环 |
| 达到最大轮次仍未通过 | 输出报告，列出残留问题，建议人工干预 |

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 每次小改动都跑 dual-review-loop | 简单修改用 `/codex:review` 就够了 |
| 忽略 CC reviewer 的误报过滤 | CC reviewer 的价值在于排除 Codex 的 false positive |
| 修复时扩大改动范围 | implementer 严格遵循 change-scope-guard |
| 不看报告直接信任"通过" | 检查 medium/low 残留问题是否需要后续处理 |
