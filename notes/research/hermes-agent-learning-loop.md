# Hermes Agent Learning Loop Architecture

> 来源：
> - https://github.com/NousResearch/hermes-agent
> - https://hermes-agent.nousresearch.com/docs/
> 吸收时间：2026-04-09

## 相关知识检索记录

- 检索关键词：`hermes-agent`, `learning loop`, `skill`, `memory`, `session search`, `honcho`
- 命中结果：
  - `notes/research/browser-agent-architecture.md`（相关度：中）
  - `rules/pattern/code-as-interface.md`（相关度：中）
  - `rules/pattern/living-spec.md`（相关度：低）
  - `rules/pattern/generator-evaluator-pattern.md`（相关度：低）
- 当前处理策略：新增研究 note，并提炼一个新的 `rules/pattern/` 规则；不改动现有规则正文

## 时效性验证记录

- 来源 1：`nousresearch/hermes-agent` GitHub 仓库，最新 release `v0.7.0`，2026-04-03，✅
- 来源 2：GitHub 仓库主页，默认分支最近仍有提交，2026-04-09，✅
- 来源 3：官方文档站 `hermes-agent.nousresearch.com/docs` 当前可访问，✅
- 结论：资料是活跃项目，不是历史归档；实现模式可作为当前参考

## 核心洞察

**Hermes 最值得吸收的不是“有 memory / 有 skills / 有 subagent”，而是把这几类能力拆成不同记忆回路，再用异步与隔离机制把它们重新闭环。**

它没有把“长期能力”都塞进一个 memory store，而是明确分成四层：

| 层 | 存什么 | 何时读 | 何时写 |
|---|---|---|---|
| **Declarative Memory** | 稳定事实、偏好、环境约束 | 每个 session 读快照 | 中途可写盘，但下个 session 才重新注入 |
| **Episodic Recall** | 过往会话全过程 | 需要时搜索召回 | 默认靠 transcript 持久化 |
| **Procedural Memory / Skills** | 可复用的做事方法 | 命中技能时按需加载 | 完成复杂任务后新建；发现过时立即 patch |
| **User Model** | 跨 session 的用户/AI 表征 | 需要 personalization 时注入/查询 | 独立后端持续观察与综合 |

这四层合起来，才构成 Hermes 所说的 `closed learning loop`。

## 关键模式

### 1. Frozen Snapshot Memory

Hermes 的文件型 memory 明确区分：

- **磁盘上的 live state**：每次工具写入都立即持久化
- **system prompt snapshot**：只在 session 启动时冻结一次

这样做的目的不是“懒刷新”，而是**保住 prefix cache 与 prompt 稳定性**。也就是说：

- 稳定事实能跨 session 继承
- 当前 session 中途写入不会污染提示词结构
- 临时任务进度不应该进入该层

这是对“memory ≠ session log”的清晰切分。

### 2. Session Search 替代“把一切写进长期记忆”

Hermes 单独提供 `session_search`：

- 底层先用 FTS5 搜 transcript
- 然后只对命中的 session 做聚焦摘要
- 返回的是**回忆结果**，不是整段原始日志

这意味着：

- 任务过程、报错、临时决策可以留在 transcript
- 需要时再召回，不必污染长期 memory
- “曾经做过什么”与“以后都成立什么”被明确分离

这是非常强的边界设计。

### 3. Procedural Memory = Skills，且必须在使用中维护

Hermes 把 skill 当成**过程性记忆**，不是提示词素材库：

- 复杂任务、棘手报错、非平凡 workflow 完成后，鼓励立刻沉淀为 skill
- 使用 skill 时一旦发现命令错误、步骤缺失、内容过时，要求**当场 patch**

关键点不是“支持创建 skill”，而是：

**skill 进入运行闭环后，必须像代码一样维护。**

这比把 skill 当静态知识库更接近真实工程系统。

### 4. User Modeling 单独抽象，不混入普通 memory

Hermes 的 Honcho 集成说明了另一个边界：

- 普通 memory 负责稳定事实
- 用户建模负责更高阶的 representation / dialectic reasoning

而且它把 AI peer 和 user peer 都视为可建模对象，不只是“记住用户说了什么”。

这说明当系统开始做 personalization 时，**最好把“可推理的用户模型”从普通记忆里分出去**，否则：

- prompt 会越来越重
- 写入语义会混乱
- 很难控制成本和更新节奏

### 5. Async Prefetch 把高延迟记忆层移出响应路径

Hermes 对 Honcho 的一个很强的实现选择是：

- 当前轮结束时后台触发 `context()` / `peer.chat()`
- 下一轮开始时直接从 cache 读取
- 第一轮允许 cold start，后续轮次避免把外部 memory HTTP 往返放在主路径上

这是值得单独记住的工程结论：

**贵而慢的 memory enrichment，不该阻塞当前轮的主推理路径。**

### 6. Code Execution Tool = RPC 化的 Code-as-Interface

Hermes 的 `execute_code` 不是普通 shell tool。

它生成一个 `hermes_tools.py` stub，把有限工具通过 RPC 暴露给脚本，再让脚本在子进程或远端 backend 内运行。这样：

- 复杂多步工具链可以在一个 inference turn 内完成
- 中间结果不进入主上下文
- 依然保留父进程对工具调用的控制边界

这不是在否定 `code-as-interface`，而是把它推进到更可落地的一步：

**代码生成 > 离散工具调用，但最好通过受限 RPC 暴露能力，而不是直接把全部宿主权限交给脚本。**

### 7. Delegation 的真正价值是“上下文隔离”，不是“并行”本身

Hermes 的 `delegate` 设计里，子 agent 默认拥有：

- 新会话
- 独立 task/session
- 收窄后的 toolset
- 父上下文看不到子 agent 中间过程

还会显式屏蔽递归 delegation、用户澄清、共享 memory 写入、跨平台发送消息等工具。

这说明 delegation 的重点应是：

**让子 agent 只带着任务问题进入，而不是继承父 agent 的全部状态与副作用能力。**

## 对当前系统的启发

### 已有理念被验证

- `rules/pattern/code-as-interface.md`
  - Hermes 的 RPC code execution 是它的工程化变体
- `rules/core/task-notes-boundary.md`
  - Hermes 对 memory 与 session_search 的分层，印证了“长期知识”和“单次执行记录”必须分开

### 可以直接复用的新判断

1. 不要把所有跨 session 内容都写进一个 memory store
2. `事实`、`过程`、`技能`、`用户模型` 应拆层
3. 高延迟 recall 最好做成 turn-end async prefetch
4. 技能若进入主流程，就必须支持运行时 patch，而不是只读
5. 程序化工具调用应优先走受限 RPC，而不是给脚本无限宿主权限

## 适用场景

- 设计长期运行的 coding agent / assistant
- 规划 memory、skills、session log 的职责边界
- 设计跨 session personalization 或 user modeling
- 优化外部 memory / profile API 的延迟路径
- 设计 subagent 与代码执行的安全边界

## 不应误读的地方

- Hermes 的优势不是“功能很多”，而是**各层职责切得清楚**
- `closed learning loop` 不等于“自动把所有经历都永久化”
- `session_search` 的存在，恰恰说明大量任务信息不应进长期 memory
- skill 自改进需要边界和校验，否则会变成自污染

## 相关规则

- [[code-as-interface]]
- [[task-notes-boundary]]
- [[generator-evaluator-pattern]]

