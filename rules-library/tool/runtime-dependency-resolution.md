---
paths:
  - "**/*.py"
  - "**/requirements*.txt"
  - "hooks/**/*"
  - "skills/**/*"
---

# Runtime 依赖自动解决规范

> 来源：PyYAML / LangGraph / LangChain 等依赖反复缺失导致脚本静默降级或报错中断 | 吸收时间：2026-04-15

## 核心问题

仓库内的 Python 脚本（hooks、compile-rules、migrated runtime、health-dashboard 等）依赖非标准库包（`pyyaml`、`langgraph`、`langchain` 等）。当这些包缺失时：

- 脚本直接报 `ModuleNotFoundError` 中断
- 或走 fallback 静默丢失功能（如 YAML 列表解析退化为单行解析）
- Agent 停在报错层反复说"环境没装"，不主动解决

## 核心原则

**缺依赖且当前任务需要运行时，主动检测 → 向用户申请 → 安装 → 验证，一条链路走完。**

## 触发条件

当出现以下任一情况时：

- `ImportError` 或 `ModuleNotFoundError`
- 脚本因 `try/except ImportError` 走了 fallback 且 fallback 会丢失功能
- 需要运行 `hooks/`、`skills/*/scripts/`、`rules/pattern/migrated/` 下的 Python 脚本
- 用户要求"跑通某个脚本""验证某个 runtime"
- 新增或修改的代码引入了新的 `import`

## 执行流程

### Step 1: 检测缺失

运行脚本或执行 import 验证时发现缺包：

```bash
python3 -c "import yaml" 2>&1 || echo "MISSING: pyyaml"
python3 -c "import langgraph" 2>&1 || echo "MISSING: langgraph"
```

### Step 2: 确认安装目标

检查仓库内是否有对应的 `requirements.txt`：

```bash
# 共享基础依赖
cat ~/.claude/requirements.txt 2>/dev/null

# 子系统局部依赖
cat ~/.claude/skills/migrated/requirements.txt 2>/dev/null
cat ~/.claude/hooks/requirements.txt 2>/dev/null
```

若缺包不在任何 `requirements.txt` 中，将其追加到最匹配的 `requirements.txt`。

### Step 3: 向用户申请安装

**不要**停在报错层只说"需要安装 X"。**直接**向用户提出安装申请：

```
当前任务需要 pyyaml（compile-rules.py 的 YAML frontmatter 解析依赖它）。
执行：pip3 install pyyaml
是否允许？
```

申请内容包含：

- 缺失包名
- 为什么需要（哪个脚本、什么功能）
- 具体安装命令

### Step 4: 安装

用户批准后，优先使用仓库本地 venv：

```bash
# 优先 venv
./.venv/bin/pip install <package>

# 若无 venv，使用 --user
pip3 install --user <package>
```

**禁止**：

- 使用 `sudo pip install`
- 安装到系统全局 Python（除非用户明确指定）
- 安装用不到的额外包

### Step 5: 验证

安装后立即做最小 import 验证：

```bash
python3 -c "import <module>; print('<module> OK')"
```

若脚本有 fallback 分支，验证主分支（而非 fallback）现在能被命中。

## 已知依赖映射

| 包名 | import 名 | 消费方 | 分类 |
|------|-----------|--------|------|
| `pyyaml` | `yaml` | `compile-rules.py` frontmatter 解析 | 治理脚本 |
| `langgraph` | `langgraph` | migrated runtime 状态机 | runtime |
| `langchain` | `langchain` | migrated runtime 基础 | runtime |
| `langchain-core` | `langchain_core` | migrated runtime 基础 | runtime |

当发现新的缺失依赖时，更新此表。

## 与现有规则的关系

| 规则 | 关系 |
|------|------|
| `rules/tool/langchain-runtime-dependencies.md` | LangChain 专属子集，本规范是其通用上游 |

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 看到 ImportError 只回复"环境没装" | 主动走 检测→申请→安装→验证 链路 |
| 静默接受 fallback 丢功能 | 识别 fallback 场景并提醒用户安装主路径依赖 |
| 直接 `sudo pip install` 或全局安装 | 优先 venv，其次 `--user` |
| 安装后不验证 | 安装后立即 import 验证 |
| 把所有可能的包都装上 | 只安装当前任务实际需要的包 |
