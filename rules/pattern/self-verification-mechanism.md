# Agent 自验证机制

> **来源**: harness 设计哲学 + long-running-agent-techniques
> **吸收时间**: 2026-03-31

## 核心洞察

**Harness 的 loop 设计哲学**：Agent 在完成实现后应自动进行验证，验证失败时自动迭代修复，直到所有功能通过验证或达到迭代上限。

## 问题诊断

| 稡式 | 表现 |
|------|------|
| **过早宣布完成** | 看到一些进展就认为任务完成，忽略未实现功能 |
| **无验证循环** | 实现后没有自动验证，需要用户手动调用 reviewer |
| **无限迭代** | 验证失败后无限制重试，浪费 token |

## 解决方案

### 架构

```
Stop Event Pipeline:
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ralph-loop ──► verification-gate ──► lesson-gate ──► exit   │
│      │               │                    │                 │
│      ▼               ▼                    ▼                 │
│  [loop active?]  [pending          [unhandled              │
│      │           features?]            signals?]            │
│      ▼               ▼                    ▼                 │
│  block + loop    block +            block +                 │
│  same prompt     trigger reviewer   write lesson            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 关键机制

1. **Feature List**: 结构化任务状态跟踪
2. **Verification Gate**: Stop hook 验证门控
3. **Iteration Limit**: 防止无限迭代

## Feature List Schema

```json
{
  "task_id": "auth-implementation",
  "created_at": "2026-03-31T10:00:00Z",
  "session_id": "<current_session>",
  "status": "in_progress",
  "features": [
    {
      "id": "F001",
      "category": "functional",
      "description": "User can login with email and password",
      "acceptance_criteria": [
        "Navigate to /login page",
        "Fill email field",
        "Fill password field",
        "Click submit",
        "Verify redirect to dashboard"
      ],
      "verification_method": "e2e",
      "passes": null,
      "verified_at": null,
      "attempt_count": 0,
      "max_attempts": 3,
      "notes": ""
    }
  ],
  "summary": {
    "total": 1,
    "passed": 0,
    "pending": 1
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `passes` | boolean/null | 验证状态： null=待验证, true=通过, false=失败 |
| `attempt_count` | number | 已尝试修复次数 |
| `max_attempts` | number | 最大尝试次数（默认 3） |
| `notes` | string | 失败原因或备注 |

## Verification Gate 行为

### 正常流程

```
Stop hook 触发
    │
    ├─ stop_hook_active = true → 允许退出（防止循环）
    │
    ├─ 无 feature-list.json → 允许退出（无验证需求）
    │
    ├─ status = "completed" → 允许退出（任务已完成）
    │
    ├─ pending = 0 → 允许退出（全部通过）
    │
    ├─ 有 feature 超过 max_attempts
    │     │
    │     └─ 标记 status = "completed" → 允许退出（需要人工干预）
    │
    └─ pending > 0 → 阻止退出，显示验证指令
```

### 验证选项

**Option A - 手动验证**：
1. Review each pending feature against its acceptance criteria
2. Run verification (tests, E2E, or manual checks)
3. Update feature-list.json with results

**Option B - 自动化 reviewer agent**：
```
Agent(subagent_type: "reviewer", prompt: "Verify feature-list.json in the current project task directory")
```

**Option C - 跳过验证**：
```
resolve_feature_list() {
  local git_root dir

  if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    if [ "$(basename "$git_root")" = ".claude" ]; then
      printf '%s/tasks/current/feature-list.json\n' "$git_root"
    else
      printf '%s/.claude/tasks/current/feature-list.json\n' "$git_root"
    fi
    return
  fi

  dir="$PWD"
  while :; do
    if [ "$(basename "$dir")" = ".claude" ]; then
      printf '%s/tasks/current/feature-list.json\n' "$dir"
      return
    fi

    if [ -d "$dir/.claude" ]; then
      printf '%s/.claude/tasks/current/feature-list.json\n' "$dir"
      return
    fi

    [ "$dir" = "/" ] && break
    dir=$(dirname "$dir")
  done

  printf '%s/tasks/current/feature-list.json\n' "$HOME/.claude"
}

FEATURE_LIST=$(resolve_feature_list)

jq '.status = "completed"' "$FEATURE_LIST"
```

## Reviewer Agent 更新 protocol

Reviewer agent 在完成审查后更新 feature-list.json：

```bash
resolve_feature_list() {
  local git_root dir

  if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    if [ "$(basename "$git_root")" = ".claude" ]; then
      printf '%s/tasks/current/feature-list.json\n' "$git_root"
    else
      printf '%s/.claude/tasks/current/feature-list.json\n' "$git_root"
    fi
    return
  fi

  dir="$PWD"
  while :; do
    if [ "$(basename "$dir")" = ".claude" ]; then
      printf '%s/tasks/current/feature-list.json\n' "$dir"
      return
    fi

    if [ -d "$dir/.claude" ]; then
      printf '%s/.claude/tasks/current/feature-list.json\n' "$dir"
      return
    fi

    [ "$dir" = "/" ] && break
    dir=$(dirname "$dir")
  done

  printf '%s/tasks/current/feature-list.json\n' "$HOME/.claude"
}

FEATURE_LIST=$(resolve_feature_list)

# 通过验证
jq '(.features[] | select(.id == "F001") | .passes) = true |
    (.features[] | select(.id == "F001") | .verified_at) = "'$(date -I --iso-8601-seconds=utc)'" |
    .summary.passed += 1 |
    .summary.pending -= 1' "$FEATURE_LIST" > /tmp/fl.json && mv /tmp/fl.json "$FEATURE_LIST"

# 验证失败
jq '(.features[] | select(.id == "F001") | .passes) = false |
    (.features[] | select(.id == "F001") | .notes) = "Failure reason" |
    (.features[] | select(.id == "F001") | .attempt_count) += 1' "$FEATURE_LIST" > /tmp/fl.json && mv /tmp/fl.json "$FEATURE_LIST"
```

## 迭代上限保护

当 feature 验证失败次数达到 `max_attempts` 时：

1. 验证门控检测到超限
2. 输出警告信息
3. 标记 task 为 "completed"
4. 允许退出（需要人工干预）

```
Feature F001 exceeded max attempts (3/3)
This feature will be marked as "blocked" and requires manual intervention.
```

## 与 orchestrate skill 整合

### Step 1: 任务分解

分解后**必须创建 feature-list.json**：

```bash
resolve_tasks_root() {
  local git_root dir

  if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    if [ "$(basename "$git_root")" = ".claude" ]; then
      printf '%s/tasks\n' "$git_root"
    else
      printf '%s/.claude/tasks\n' "$git_root"
    fi
    return
  fi

  dir="$PWD"
  while :; do
    if [ "$(basename "$dir")" = ".claude" ]; then
      printf '%s/tasks\n' "$dir"
      return
    fi

    if [ -d "$dir/.claude" ]; then
      printf '%s/.claude/tasks\n' "$dir"
      return
    fi

    [ "$dir" = "/" ] && break
    dir=$(dirname "$dir")
  done

  printf '%s/tasks\n' "$HOME/.claude"
}

TASKS_ROOT=$(resolve_tasks_root)

TASK_DATE=$(date +%F)
TASK_SLUG="feature-auth"
TASK_DIR="$TASK_DATE-$TASK_SLUG"
mkdir -p "$TASKS_ROOT/$TASK_DIR"

cat > "$TASKS_ROOT/$TASK_DIR/feature-list.json" << 'EOF'
{
  "task_id": "$TASK_DIR",
  "created_at": "$(date -I --iso-8601-seconds=utc)",
  "session_id": "<current_session>",
  "status": "in_progress",
  "features": [...]
}
EOF

ln -sfn "$TASK_DIR" "$TASKS_ROOT/current"
```

任务目录名应遵循 `YYYY-MM-DD-slug`，保证扫描 `tasks/` 时可直接识别任务主题；只有临时草稿任务才退化到 `YYYY-MM-DD-draft-task-<shortid>`。

路径规则：优先使用 `<project>/.claude/tasks/`；若当前仓库本身就是 `~/.claude/`，则等价为 `~/.claude/tasks/`；若当前不在 git 项目中但向上能找到项目 `.claude/`，仍使用该项目的 `.claude/tasks/`；只有都找不到时才回退 `~/.claude/tasks/`。

### Step 5.3: 集成验证

所有子任务完成后：
1. 合并 worktree 变更到主分支
2. 运行项目测试
3. **启动 reviewer agent 验证 feature list**
4. **verification-gate.sh 检测 pending features**

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 未创建 feature-list.json | 分解后必须创建 feature-list.json |
| 手动标记 passes = true | 运行验证后再更新状态 |
| 无限制重试失败 feature | 检查 attempt_count，达到 max_attempts 后寻求人工干预 |
| 跳过验证直接退出 | 让 verification-gate 阻止退出，完成验证后再退出 |

## 文件位置

| 文件 | 路径 | 作用 |
|------|------|------|
| Feature List | 解析后的当前项目 task 目录（通常为 `<project>/.claude/tasks/current/feature-list.json`；无法解析项目时回退 `~/.claude/tasks/current/feature-list.json`） | 任务状态跟踪 |
| Verification Gate | `~/.claude/hooks/verification-gate.sh` | Stop hook 验证门控 |
| Reviewer Agent | `~/.claude/agents/reviewer.md` | 代码审查 + 状态更新 |
| Orchestrate Skill | `~/.claude/skills/orchestrate/SKILL.md` | 任务分解 + feature list 创建 |

## 参考

- [Anthropic Engineering - Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- `long-running-agent-techniques.md` - Harness 设计哲学
- `generator-evaluator-pattern.md` - Generator (implementer) + Evaluator (reviewer)
