---
name: multi-model-agent
description: 多模型协作编排技能。配置 LiteLLM 代理实现 Claude + Codex 混合模型协作，根据任务类型自动路由到最优模型。触发条件：用户要求"混合模型"/"多模型协作"/"配置 LiteLLM"/"Codex + Claude"。
---

# Multi-Model Agent - 多模型协作编排

**通过 LiteLLM Proxy 实现 Claude + Codex/OpenAI/Gemini 等多模型混合协作，按任务类型自动路由最优模型。**

```
任务类型 → 路由规则 → 最优模型 → 执行 → 聚合
```

## 触发条件

满足任一即可激活：
- 用户要求"混合模型"/"多模型协作"
- 用户提到 "Codex + Claude" 或类似组合
- 用户要求配置 LiteLLM/模型代理
- 任务需要不同模型的优势互补（推理 + 编码、创意 + 分析）
- 用户要求优化 token 成本

## 核心原则

| 原则 | 说明 |
|------|------|
| **Best-for-Task** | 不同模型有不同优势，任务类型决定模型选择 |
| **Transparent Proxy** | LiteLLM 统一 API 格式，Agent 无感知切换 |
| **Cost-Aware** | 简单任务用轻量模型，复杂任务用强模型 |
| **Graceful Fallback** | 模型不可用时自动降级 |

## 模型能力矩阵

| 模型 | 优势场景 | 相对成本 | 推荐用途 |
|------|---------|---------|---------|
| **Claude Opus 4.6** | 复杂推理、架构设计、长上下文理解 | 高 | 主 Agent、复杂实现 |
| **Claude Sonnet 4.6** | 平衡推理与速度 | 中 | 常规实现、代码审查 |
| **Claude Haiku 4.5** | 快速响应、简单任务 | 低 | 研究调研、格式转换 |
| **Codex 5.4** | 代码生成、重构、测试编写 | 中 | 代码密集任务 |
| **GPT-4.1** | 工具调用、结构化输出 | 中高 | API 集成、数据提取 |
| **Gemini 2.5** | 多模态、长上下文 | 中 | 文档分析、图像理解 |

## 配置方案

### 方案 A: LiteLLM Proxy（推荐）

**优势**：统一接口、自动格式转换、负载均衡、成本追踪

```yaml
# ~/.claude/litellm-config.yaml
model_list:
  # Claude 系列
  - model_name: claude-opus
    litellm_params:
      model: anthropic/claude-opus-4-6

  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-6

  - model_name: claude-haiku
    litellm_params:
      model: anthropic/claude-haiku-4-5-20251001

  # Codex 系列（通过 OpenAI 兼容接口）
  - model_name: codex
    litellm_params:
      model: openai/codex-5.4  # 或实际 endpoint
      api_base: ${CODEX_API_BASE}

  # 其他模型
  - model_name: gpt-4
    litellm_params:
      model: openai/gpt-4.1

router_settings:
  routing_strategy: "simple-shuffle"  # 或 "latency-based-routing"
  num_retries: 3
  retry_after: 30
  fallbacks: [
    {"claude-opus": ["claude-sonnet", "gpt-4"]},
    {"codex": ["claude-sonnet"]}
  ]

general_settings:
  master_key: ${LITELLM_MASTER_KEY}
  database_url: ${LITELLM_DATABASE_URL}  # 可选：成本追踪
```

**启动 Proxy**：
```bash
litellm --config ~/.claude/litellm-config.yaml --port 4000
```

**Claude Code 配置**：
```bash
# 设置代理端点
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_API_KEY=your-litellm-master-key
```

### 方案 B: claude-code-proxy

**适用场景**：只需要 OpenAI <-> Claude 自动转换

```bash
# 安装
pip install claude-code-proxy

# 启动（自动路由 haiku→gpt-4.1-mini, sonnet→gpt-4.1）
claude-code-proxy --port 4000
```

### 方案 C: 环境变量直配

**适用场景**：简单场景，不需要复杂路由

```bash
# 设置子 Agent 默认模型
export CLAUDE_CODE_SUBAGENT_MODEL=codex-5.4

# 或在 .env 中配置
echo "CLAUDE_CODE_SUBAGENT_MODEL=codex-5.4" >> ~/.claude/.env
```

## Agent 配置

### 方法 1: Agent Frontmatter（推荐）

为每个 Agent 配置专属模型：

```markdown
---
name: implementer
model: codex  # 使用 codex 模型
description: 代码实现 Agent
---

# Implementer Agent
...
```

**模型字段优先级**：
1. `CLAUDE_CODE_SUBAGENT_MODEL` 环境变量（最高）
2. Agent tool 调用时的 `model` 参数
3. Agent frontmatter 的 `model:` 字段
4. 主会话模型（最低）

### 方法 2: 动态模型选择

在 orchestrate skill 中动态指定：

```markdown
| Agent | 能力 | 模型 |
|-------|------|------|
| implementer | 写代码 | codex |
| researcher | 调研 | haiku |
| reviewer | 审查 | sonnet |
| architect | 架构设计 | opus |
```

## 路由规则设计

### 基于任务类型的路由

```yaml
routing_rules:
  # 代码密集任务 → Codex
  - match:
      task_type: ["implementation", "refactoring", "test-writing"]
      keywords: ["写代码", "实现", "重构", "测试"]
    route_to: codex

  # 研究调研 → Haiku
  - match:
      task_type: ["research", "search", "summarize"]
      keywords: ["调研", "搜索", "总结"]
    route_to: claude-haiku

  # 架构设计 → Opus
  - match:
      task_type: ["architecture", "design", "planning"]
      keywords: ["架构", "设计", "规划"]
    route_to: claude-opus

  # 默认 → Sonnet
  - match:
      task_type: "*"
    route_to: claude-sonnet
```

### 基于成本的路由

```yaml
cost_optimization:
  rules:
    # 简单任务强制用轻量模型
    - condition: "estimated_turns < 10"
      force_model: claude-haiku

    # 中等复杂度用平衡模型
    - condition: "estimated_turns < 30"
      force_model: claude-sonnet

    # 复杂任务才用强模型
    - condition: "estimated_turns >= 30 or requires_deep_reasoning"
      force_model: claude-opus
```

## 执行流程

### Step 1: 分析任务需求

```markdown
## 任务分析

### 任务类型
- [ ] 实现代码
- [ ] 研究调研
- [ ] 架构设计
- [ ] 代码审查
- [ ] 其他

### 复杂度评估
- 预估 turns: [数字]
- 是否需要深度推理: 是/否
- 是否需要代码生成: 是/否

### 推荐模型
[基于分析推荐的模型]
```

### Step 2: 配置路由

根据分析结果配置 LiteLLM 路由规则或选择直配模型。

### Step 3: 执行并监控

```bash
# 查看 LiteLLM 使用统计
curl http://localhost:4000/spend/logs

# 查看模型调用分布
curl http://localhost:4000/model/info
```

### Step 4: 成本分析

```markdown
## 成本分析

### 本次任务
- Claude Opus: X tokens, $Y
- Codex: Z tokens, $W
- 总成本: $Total

### 对比单一模型
- 全用 Opus: $OpusOnly
- 节省: X%
```

## 与 orchestrate skill 协作

`multi-model-agent` 作为 `orchestrate` 的增强层：

```
orchestrate 分解任务 → multi-model-agent 路由模型 → 执行
```

在 orchestrate 的 Step 2 模式选择中：

```markdown
### Step 2: 模式选择 + 模型路由

| 子任务 | Agent 类型 | 推荐模型 | 理由 |
|--------|-----------|----------|------|
| #1 实现登录 | implementer | codex | 代码密集 |
| #2 调研方案 | researcher | haiku | 只读调研 |
| #3 架构设计 | architect | opus | 深度推理 |
```

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|---------|
| 所有任务都用 Opus | 成本过高 | 简单任务用 haiku |
| 不配置 fallback | 模型挂了就失败 | 配置降级链 |
| 忽略成本监控 | 无法优化 | 定期查看使用统计 |
| 混用无规则 | 结果不可预期 | 明确路由规则 |
| 单机多代理无隔离 | 模型切换冲突 | 使用 worktree 隔离 |

## 配置示例

### 完整的 multi-model 环境配置

```bash
# ~/.claude/.env

# LiteLLM Proxy
LITELLM_BASE_URL=http://localhost:4000
LITELLM_MASTER_KEY=sk-xxx

# 默认子 Agent 模型（可被 frontmatter 覆盖）
CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet

# 模型特定配置
CODEX_API_BASE=https://api.example.com/v1
CODEX_API_KEY=sk-xxx

# 成本追踪（可选）
LITELLM_DATABASE_URL=postgresql://user:pass@localhost/litellm
```

### 启动脚本

```bash
#!/bin/bash
# ~/.claude/scripts/start-multi-model.sh

# 启动 LiteLLM
litellm --config ~/.claude/litellm-config.yaml --port 4000 &

# 等待就绪
sleep 5

# 设置环境变量
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_API_KEY=$LITELLM_MASTER_KEY

# 启动 Claude Code
claude
```

## 检查清单

- [ ] LiteLLM Proxy 已启动并验证连通性？
- [ ] 各模型 API Key 已配置？
- [ ] 路由规则符合任务需求？
- [ ] Fallback 链已配置？
- [ ] 成本监控已启用？
- [ ] Agent frontmatter 模型配置正确？

## 相关规范

- [[orchestrate]] - 任务分解与并行执行
- [[proactive-delegation]] - 何时需要委派
- [[long-running-agent-techniques]] - 长时 Agent 管理

## 参考

- [LiteLLM Documentation](https://docs.litellm.ai/)
- [claude-code-proxy GitHub](https://github.com/1rgs/claude-code-proxy)
- [Claude Code Subagent Model Resolution](https://docs.anthropic.com/claude-code/subagents#model-resolution)
