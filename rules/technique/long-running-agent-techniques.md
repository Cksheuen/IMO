# 长时运行 Agent 技术规范

> 来源：[Anthropic Engineering - Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (2025-11-26)

## TL;DR

| 问题 | 解决方案 | 关键 Artifact |
|------|----------|---------------|
| 一次性做太多 | Initializer + Coding Agent 双层架构 | `feature_list.json` |
| 过早宣布完成 | Feature List 约束，每次只做一个 | `progress file` |
| 留下半成品 | Git repo + progress notes | `init.sh` |
| Context Anxiety | Handoff → Context Reset | `handoff.md` |

## 触发条件

当 Agent 执行长时间任务时：
- 任务复杂度超过单次上下文容量
- 模型出现 Context Anxiety 症状
- 需要多 Agent 协作
- **跨 context window 的编码任务**（如构建完整应用）

---

## 双层 Agent Harness（核心模式）

### 问题诊断

Agent 在长时运行任务中两大失败模式：

| 模式 | 表现 |
|------|------|
| **一次性做太多** | 尝试 one-shot 整个应用，中途 context 耗尽，留下半成品 |
| **过早宣布完成** | 看到一些进展就认为任务完成，忽略未实现功能 |

### 解决方案：Initializer + Coding Agent

```
┌─────────────────────────────────────────────────────────────┐
│  Initializer Agent（仅首次运行）                              │
│                                                              │
│  输入：User Request ("Build me X")                           │
│  输出：                                                      │
│    • feature_list.json ← 展开用户需求为可测试的 feature 列表  │
│    • init.sh           ← 运行开发服务器的脚本                │
│    • progress file     ← 跨会话的 agent 行为日志             │
│    • git commit        ← 初始文件记录                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Coding Agent（循环运行，直到所有 feature 通过）              │
│                                                              │
│  Loop:                                                       │
│    1. Read progress file & git log → 了解状态               │
│    2. Run init.sh → 启动开发服务器                          │
│    3. Run basic E2E test → 验证环境未被破坏                 │
│    4. Pick ONE feature from feature_list.json → 选择任务    │
│    5. Implement feature → 实现功能                          │
│    6. Test feature (Puppeteer MCP) → 端到端验证             │
│    7. Update feature_list.json (passes: true) → 标记完成    │
│    8. Git commit + update progress → 留下干净状态           │
│                                                              │
│  Until: 所有 features 的 passes = true                      │
└─────────────────────────────────────────────────────────────┘
```

### 关键 Artifacts

| Artifact | 作用 | 内容 |
|----------|------|------|
| `init.sh` | 启动环境 | 运行开发服务器的脚本 |
| `progress file` | 跨会话记忆 | 所有 agent 做过的事 |
| `feature_list.json` | 任务清单 | feature 描述 + pass/fail 状态 |
| Git commits | 可回滚状态 | 描述性提交信息 |

### Feature List 文件

**核心作用**：将用户的高层需求**展开**为可测试的 feature 列表

```
User Request: "Build me claude.ai clone"
        │
        ▼ 展开为 200+ features
[
  "User can open a new chat, type query, press enter, see AI response",
  "New chat button creates a fresh conversation",
  "Theme toggle switches between light/dark mode",
  ...
]
```

### Feature List 格式

```json
{
  "category": "functional",
  "description": "New chat button creates a fresh conversation",
  "steps": [
    "Navigate to main interface",
    "Click the 'New Chat' button",
    "Verify a new conversation is created"
  ],
  "passes": false
}
```

**关键规则**：只允许修改 `passes` 字段，禁止删除或编辑 tests

### Coding Agent 会话流程（标准化）

```
Step 1: 状态恢复
    Read progress file & git log → 了解之前做了什么

Step 2: 环境启动
    Run init.sh → 启动开发服务器

Step 3: 环境验证（关键！）
    Run basic E2E test → 确认基础功能正常
    └─ 如果失败 → 先修复再继续，避免在破损环境上工作

Step 4: 任务选择
    Pick ONE feature from feature_list.json
    └─ 选择 passes: false 中优先级最高的

Step 5: 实现
    Implement feature → 编写代码

Step 6: 验证（必须端到端）
    Test feature with browser automation (Puppeteer MCP)
    └─ 像真实用户一样操作，截图验证

Step 7: 更新状态
    Update feature_list.json (set passes: true)
    └─ 只修改 passes 字段，禁止删除/编辑 tests

Step 8: 提交记录
    Git commit + update progress file
    └─ 为下一个 session 留下干净状态

Step 9: 检查终止条件
    All features pass? → 完成 / 否则 → 继续循环
```

### 四大失败模式解决方案

| 问题 | Initializer Agent | Coding Agent |
|------|-------------------|--------------|
| 过早宣布完成 | Feature list file | 读取列表，每次只做一个 feature |
| 留下 bug/未记录状态 | Git repo + progress notes | 读取 progress + git logs，测试 |
| 过早标记 feature 完成 | Feature list | 自我验证所有 feature（用浏览器自动化） |
| 花时间弄清楚如何运行 | init.sh 脚本 | 读取 init.sh |

### 测试要求

**必须**使用浏览器自动化工具（如 Puppeteer MCP）进行端到端测试：
- 不只依赖单元测试或 curl
- 像真实用户一样操作
- 截图验证功能正确性

---

## Context Anxiety 处理

### 识别信号

| 类型 | 表现 |
|------|------|
| 行为 | 突然说"差不多完成"但明显还有工作、跳过细节、质量下降 |
| 技术 | 上下文使用超过 70% |

### 处理流程

```
检测 Anxiety → 生成 handoff.md → Context Reset → 新 Session 读取 handoff
```

### Handoff 格式

```markdown
# Handoff - [任务名称]
## 进度
- [x] 已完成项
- [ ] 进行中
## 关键决策
## 下一步
```

### 模型差异

| 模型 | Anxiety 程度 | 建议 |
|------|-------------|------|
| Sonnet 4.5 | 强 | 必须 Reset |
| Opus 4.5 | 中 | 按需 Reset |
| Opus 4.6 | 弱 | 优先 Compaction |

---

## 评估标准设计

### 设计流程

```
识别维度 → 明确定义 → 设定权重 → 提供示例 → 设定阈值
```

### 标准格式（每个维度必须包含）

| 要素 | 说明 |
|------|------|
| name | 维度名称 |
| weight | high/medium/low |
| thresholds | pass/fail 分数 |
| definition | 一句话定义 |
| examples | 高分/低分表现 |
| anti_patterns | AI slop 模式 |

---

## Sprint Contract 规范

### 使用条件

| 必须 | 可跳过 |
|------|--------|
| 任务 > 1 小时 | 任务 < 30 min |
| 多人/Agent 协作 | 单一明确任务 |
| 高层需求需细化 | |

### Contract 内容

```yaml
sprint_contract:
  scope: [要做的]        # 必须
  excluded: [不做的]      # 必须
  acceptance_criteria:   # 必须，3-7 条
    - action: [行为]
      verification: [测试方法]
```

### 协议流程

```
Generator 提议 → Evaluator 审核 → 签署 → 编码
         ↑________________↓
           问题 → 反馈 → 修订
```

---

## 相关规范

- [[generator-evaluator-pattern]] - 多 Agent 架构
- [[task-centric-workflow]] - 任务分解
- [[proactive-delegation]] - 主动委派（会话内预防上下文膨胀）
