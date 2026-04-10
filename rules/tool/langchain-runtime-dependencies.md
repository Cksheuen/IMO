# LangChain 迁移 Runtime 依赖规范

## 触发条件

当任务满足以下任一条件时：

- 读取、运行或验证 `skills/*/migrated/` 下的 LangChain / LangGraph runtime
- 读取、运行或验证 `rules/pattern/migrated/` 下的 LangGraph 样例
- 出现 `ModuleNotFoundError: langgraph`、`langchain`、`langchain_core`
- 用户明确要求“安装 LangChain / LangGraph 依赖”“跑通 migrated runtime”

## 核心原则

**缺依赖且当前任务确实需要运行时，不停在报错层，直接检查并申请安装。**

- 统一使用仓库本地 `.venv/`
- 不把这类依赖安装到全局 Python
- 不把 provider integration（如 `langchain-anthropic`）误当成基础必需依赖

## 标准步骤

### Step 1: 先检查

运行：

```bash
python3 ~/.claude/hooks/check-langchain-runtime-deps.py --runtime <runtime>
```

常见 `<runtime>`：

- `multi-model-agent`
- `orchestrate`
- `dual-review-loop`
- `promote-notes`
- `self-verification`

若只需检查共享基础依赖，也可用：

```bash
python3 ~/.claude/hooks/check-langchain-runtime-deps.py --runtime all
```

### Step 2: 缺依赖则安装

若检查结果缺少基础依赖，且当前任务需要运行这些 runtime：

```bash
./.venv/bin/pip install -r skills/migrated/requirements.txt
```

也允许使用对应 runtime 的局部入口：

```bash
./.venv/bin/pip install -r skills/orchestrate/migrated/requirements.txt
```

### Step 3: 若受限则自动申请安装

若 `pip install` 因网络、sandbox 或权限失败：

- 不先用纯文字来回确认
- 直接按工具协议申请 escalation
- justification 应明确说明“当前任务需要运行 migrated runtime，缺少 LangChain/LangGraph 基础依赖”

### Step 4: 安装后立即回归验证

至少做一项：

- 重新运行失败的命令
- 重新运行 example / smoke
- 用 `.venv/bin/python` 做最小 import 验证

## 必需依赖边界

当前共享基础依赖写在：

- `skills/migrated/requirements.txt`

内容仅包含：

- `langgraph`
- `langchain`
- `langchain-core`

这些是当前 migrated runtime 的基础运行面。

以下不属于默认必需依赖：

- `langchain-anthropic`
- `langchain-openai`
- 任何 provider-specific integration

只有当任务实际需要某个 provider 示例或真实 LLM 调用时，才按需额外安装。

## 反模式

- 看到 `ModuleNotFoundError` 只在回复里说“环境没装”
- 直接用系统 Python / 全局 pip 安装
- 把 provider integration 混进共享基础依赖
- 不验证安装后是否真能运行
