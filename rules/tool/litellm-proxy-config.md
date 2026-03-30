# LiteLLM 多模型代理配置模板

> 来源：brainstorm 调研 + multi-model-agent skill | 吸收时间：2026-03-30

## 触发条件

当需要配置多模型协作时：
- Claude + Codex 混合使用
- 成本优化（简单任务用轻量模型）
- 模型能力互补（推理 + 编码）

## 配置文件位置

```
~/.claude/
├── litellm-config.yaml    # LiteLLM 主配置
├── .env                   # 环境变量（API Keys）
└── scripts/
    └── start-multi-model.sh  # 启动脚本
```

## 核心配置

### litellm-config.yaml

```yaml
model_list:
  # Claude 模型
  - model_name: claude-opus
    litellm_params:
      model: anthropic/claude-opus-4-6-20250519
      api_key: ${ANTHROPIC_API_KEY}

  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-6-20250519
      api_key: ${ANTHROPIC_API_KEY}

  - model_name: claude-haiku
    litellm_params:
      model: anthropic/claude-haiku-4-5-20251001
      api_key: ${ANTHROPIC_API_KEY}

  # Codex / OpenAI 模型
  - model_name: codex
    litellm_params:
      model: openai/codex-5.4
      api_key: ${OPENAI_API_KEY}
      api_base: ${CODEX_API_BASE:-https://api.openai.com/v1}

  - model_name: gpt-4
    litellm_params:
      model: openai/gpt-4.1
      api_key: ${OPENAI_API_KEY}

router_settings:
  routing_strategy: "simple-shuffle"
  num_retries: 3
  fallbacks:
    - {"claude-opus": ["claude-sonnet", "gpt-4"]}
    - {"codex": ["claude-sonnet"]}

general_settings:
  master_key: ${LITELLM_MASTER_KEY}
```

### .env

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx

# OpenAI / Codex
OPENAI_API_KEY=sk-xxx
CODEX_API_BASE=https://api.example.com/v1  # 可选

# LiteLLM
LITELLM_MASTER_KEY=sk-litellm-xxx

# Claude Code 子 Agent 默认模型
CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet
```

## 启动方式

### 方法 1: LiteLLM 服务

```bash
# 启动代理
litellm --config ~/.claude/litellm-config.yaml --port 4000

# 配置 Claude Code
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_API_KEY=$LITELLM_MASTER_KEY
```

### 方法 2: claude-code-proxy

```bash
# 安装
pip install claude-code-proxy

# 启动（自动路由）
claude-code-proxy --port 4000
```

### 方法 3: 环境变量直配

```bash
# 简单场景：只改默认子 Agent 模型
export CLAUDE_CODE_SUBAGENT_MODEL=codex
```

## 模型选择决策框架

```
任务类型？
    │
    ├─ 代码密集（实现/重构/测试）
    │       → codex 或 claude-sonnet
    │
    ├─ 研究调研（搜索/总结）
    │       → claude-haiku（快+省钱）
    │
    ├─ 架构设计（规划/决策）
    │       → claude-opus（深度推理）
    │
    ├─ 代码审查（验证/检查）
    │       → claude-sonnet（平衡）
    │
    └─ 默认
            → claude-sonnet
```

## 相关规范

- [[multi-model-agent]] - 多模型协作编排技能
- [[orchestrate]] - 任务分解与并行执行

## 参考

- [LiteLLM Docs](https://docs.litellm.ai/)
- [claude-code-proxy](https://github.com/1rgs/claude-code-proxy)
