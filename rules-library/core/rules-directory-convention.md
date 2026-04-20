# 规则目录分流规范

> 来源：rules/ → rules-library/ 三层加载架构重构 | 吸收时间：2026-04-15

## 核心问题

项目有两个规则目录：`rules/` 和 `rules-library/`。新增规则时必须明确放哪个目录，放错会导致：

- 放 `rules/`：每次会话都加载，浪费 token 预算
- 放 `rules-library/`：需要关键词匹配才注入，元级约束可能被漏掉

## 架构概览

```
rules/                    ← always-loaded（Claude Code 原生加载）
├── core/                 ← 仅放元级约束，当前 4 个文件
│   ├── context-injection.md
│   ├── global-governance-assets.md
│   ├── llm-friendly-format.md
│   └── user-facing-language.md

rules-library/            ← 按需注入（hooks/rules-inject.py 关键词匹配）
├── core/                 ← 核心工作流约束
├── pattern/              ← 通用模式
├── technique/            ← 具体技术手段
├── tool/                 ← 工具相关约束
└── domain/               ← 领域特定规则
    ├── frontend/
    ├── backend/
    └── shared/
```

## 加载机制

| 目录 | 加载方式 | 时机 | 索引标记 |
|------|----------|------|----------|
| `rules/` | Claude Code 原生自动加载 | 每次会话启动 | `always_loaded: true` |
| `rules-library/` | `hooks/rules-inject.py` 按需注入 | 用户 prompt 包含匹配关键词时 | `always_loaded: false` |

索引由 `scripts/build-rules-index.py` 生成到 `rules-index.json`。

## 分流决策

```text
新增一条规则？
    │
    ├─ 每次会话都必须生效？（元级约束）
    │       │
    │       ├─ 是 → rules/core/
    │       │       前提：当前 rules/ 仅 4 个文件，新增需极强理由
    │       │
    │       └─ 否 → rules-library/ 对应子目录
    │
    └─ 有具体触发条件？（特定任务、领域、工具）
            │
            └─ 是 → rules-library/ 对应子目录
                    确保标题和「## 触发条件」段包含足够精准的关键词（build-rules-index.py 从这两处提取）
```

### 放 `rules/` 的标准（极严格）

必须同时满足：

- 是"关于规则本身如何组织/注入/格式化/治理"的元级约束
- 不依赖任何具体任务类型、领域或工具
- 去掉它会导致整个规则系统运行异常
- 当前 `rules/` 的文件数应控制在 5 个以内

### 放 `rules-library/` 的标准（默认）

满足以下任一条件即可：

- 有明确的触发场景或适用领域
- 描述的是具体模式、技术手段或工具约束
- 离开特定上下文后不需要每次都加载

## 子目录选择

| 子目录 | 内容 | 示例 |
|--------|------|------|
| `core/` | 核心工作流约束 | task-centric-workflow, proactive-delegation |
| `pattern/` | 通用设计/开发模式 | change-scope-guard, generator-evaluator-pattern |
| `technique/` | 具体技术手段 | git-worktree-parallelism |
| `tool/` | 工具链约束 | langchain-runtime-dependencies |
| `domain/frontend/` | 前端领域规则 | ui-logic-boundary |
| `domain/backend/` | 后端领域规则 | architecture-stages |
| `domain/shared/` | 跨领域共享规则 | architecture-stages |

## 新增规则后的检查清单

1. 确认放在了正确的目录（`rules/` 或 `rules-library/`）
2. 运行 `python3 ~/.claude/scripts/build-rules-index.py` 重建索引
3. 检查 `rules-index.json` 中新规则的 `always_loaded` 和 `keywords` 是否正确
4. 若新规则被其他 skill 引用，确保引用路径正确

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 新规则默认放 `rules/` | 默认放 `rules-library/`，除非有极强元级理由 |
| 引用路径写 `rules/core/xxx.md` 但文件在 `rules-library/` | 检查文件实际位置，使用正确路径 |
| 新增规则后不重建索引 | 运行 `build-rules-index.py` |
| `rules/` 文件数超过 5 个 | 评估是否有文件应降级到 `rules-library/` |
