# Multi-Model Agent Migrated Runtime

## 安装

在新环境中先安装共享基础依赖或本目录入口依赖：

```bash
./.venv/bin/pip install -r skills/migrated/requirements.txt
./.venv/bin/pip install -r skills/multi-model-agent/migrated/requirements.txt
```

如果后续要接具体 provider，再额外安装对应 integration 包，例如 Anthropic 或 OpenAI provider。

运行前可先检查：

```bash
python3 ~/.claude/scripts/check-langchain-runtime-deps.py --runtime multi-model-agent
```

## LiteLLM 配置自动发现

`tools.py` 中的 adapter 会按下面顺序自动寻找 LiteLLM 配置：

1. 显式传入的 `config_path`
2. 环境变量：
   - `LITELLM_CONFIG_PATH`
   - `LITELLM_CONFIG`
   - `MULTI_MODEL_AGENT_LITELLM_CONFIG`
3. 当前目录下的 `litellm-config.yaml`
4. 当前目录下的 `.claude/litellm-config.yaml`
5. `~/.claude/litellm-config.yaml`
6. `~/litellm-config.yaml`

如果没有找到配置文件，adapter 会退回到本地默认模型矩阵。

## 可选环境变量

- `LITELLM_BASE_URL`
- `LITELLM_MODEL_INFO_URL`
- `LITELLM_SPEND_LOGS_URL`
- `LITELLM_HEALTH_URL`
- `LITELLM_MODEL_LIST`

这些变量用于覆盖默认 endpoint 或在没有配置文件时提供模型列表。

## 当前边界

本目录仍然只覆盖 routing policy layer：

- 任务分析
- 模型选择
- fallback
- 轻量成本/监控快照

不覆盖：

- `.env` 写入
- 启动 LiteLLM 代理
- 真实网络调用
- provider 凭据管理
