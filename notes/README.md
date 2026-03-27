# notes/

`notes/` 的一级定义以 `.gitignore` 注释为准：**知识沉淀（经验教训、笔记）**。

它不是强约束执行规范，也不是代码索引，而是把值得保留的经验、调研、教训和中间结论沉淀下来，供后续整理进 `rules/`、`skills/`、`memory/` 或文档。

## 设计目标

- 给仓库留出一层“先沉淀、后提炼”的缓冲区
- 保存经验教训、调研笔记、设计思考、迁移记录
- 避免把尚未稳定的内容直接写进 `CLAUDE.md` 或 `rules/`

## 适合放什么

- 经验教训
- 调研记录
- 设计草案与取舍
- 迁移计划
- 使用笔记
- 复盘记录

## 不适合放什么

- 需要立即生效的强约束规则
- 完整工作流定义
- 纯代码索引
- 自动生成的大量运行时产物

## 与相邻目录的区别

| 目录 | 主要用途 | 适合内容 |
|------|----------|----------|
| `rules/` | 可执行规范 | 稳定、可复用、带触发条件的规则 |
| `skills/` | 完整工作流 | 可直接触发的能力模块 |
| `notes/` | 知识沉淀 | 经验教训、笔记、调研、设计草案 |
| `memory/` | 检索索引 | 关键路径、代码地图、系统摘要 |

## 推荐组织方式

这里不强制固定信息架构，但建议优先使用语义明确的子目录，例如：

- `notes/research/`：调研与方案比较
- `notes/lessons/`：按主题归并的经验教训、复盘
- `notes/design/`：设计草案、迁移方案

如果内容规模很小，也可以先直接放在 `notes/` 根目录，后续再整理。

### lessons 的组织原则

- 默认按**主题**建文，而不是按日期为每次事件新建一篇
- 文件名优先表达问题域，例如 `notes/lessons/context-loading-and-call-path.md`
- 单次事件作为同一主题下的 `Source Cases`、反例、补充证据持续并入
- 只有完全找不到可归并主题时，才创建新的 lesson note

### lessons 的最小结构

建议每篇 lesson note 至少包含：

- `Status`：`active` / `candidate-rule` / `stale`
- `First Seen`：首次出现日期
- `Last Verified`：最近一次被复用或重新验证的日期
- `Trigger`：什么情况下会触发这个教训
- `Decision`：应该怎么做
- `Source Cases`：支撑这个主题的具体案例列表
- `Promotion Criteria`：什么情况下应提炼到 `rules/`、`skills/` 或 `memory/`

## 生命周期

推荐遵循这条路径：

1. 先把值得保留的认识写入 `notes/`
2. lesson 类内容先尝试归并到现有主题，并更新 `Last Verified` 与 `Source Cases`
3. 同类教训重复出现并稳定后，提炼为 `rules/` 或 `skills/`
4. 对需要快速检索的稳定结论，再补到 `memory/`

### 生命周期状态

| 状态 | 含义 | 下一步 |
|------|------|--------|
| `active` | 最近仍在复用，结论有效 | 持续归并新案例 |
| `candidate-rule` | 已重复出现，结构稳定 | 进入 `Promotion Loop` 评估是否晋升 |
| `stale` | 超过 90 天未验证 | 复用前先复核，必要时删除或重写 |

### 维护动作

每次准备写入 `notes/lessons/` 时，执行以下流程：

1. 先搜索是否已有同主题 note
2. 若命中，更新原 note 的 `Last Verified`、`Source Cases`、`Decision`
3. 若未命中，再创建新的主题 note
4. 若一个主题连续被复用，改为 `candidate-rule`
5. 若超过 90 天未验证，标记为 `stale`

### Promotion Loop

当 note 满足以下任意两项时，被动触发晋升评估：

- 同一主题被再次复用
- 触发条件已经清晰
- 执行步骤已经稳定
- 决策框架不再依赖单个案例
- 不同任务中出现相同模式

默认要求：满足门槛后**自动进入评估**，不依赖用户额外提醒。

评估结果三选一：

- 晋升到 `rules/`
- 晋升到 `skills/`
- 保持在 `notes/`，继续观察

## 调用链

`notes/` 不会自动长出内容，必须由工作流显式写入。

它也不会默认被全量读取；必须由任务循环按需选择子目录。

### 推荐读取循环

- `Correction Loop`：用户纠正、追问、质疑、复盘时，优先读取 `notes/lessons/`
- `Research Loop`：方案探索、技术选型、外部调研时，优先读取 `notes/research/`，必要时补读 `notes/lessons/`
- `Design Loop`：目录设计、迁移方案、调用链设计时，优先读取 `notes/design/`，必要时补读 `notes/lessons/`
- `Recovery Loop`：执行失败、返工、回滚、重复踩坑时，回读 `notes/lessons/`
- `Promotion Loop`：当 note 达到稳定门槛时，自动触发晋升评估
- `Promotion Loop` 的完整评估与落盘默认由独立 subagent 执行，主 agent 只负责触发与守门

推荐触发点：

- 用户纠正了 agent，需要沉淀经验教训
- 用户追问暴露了设计漏洞或遗漏，也按 lesson 触发处理
- 完成了 brainstorm 或外部调研，需要保留收敛过程
- 做了目录、架构、迁移设计，但暂时还不适合写成强约束规则

推荐写入责任：

- `CLAUDE.md` 的 Learn 阶段负责 lesson/design 类沉淀
- `brainstorm` 负责 research 类沉淀，并在发现可统筹的教训时更新 `notes/lessons/`
- `Promotion Loop` 负责把满足条件的 note 晋升到 `rules/` / `skills/` / `memory/`
- 用户显式要求“记下来”“沉淀一下”时直接写入对应 note

### 自动晋升协议

- 更新 `notes/lessons/` 后，如果同主题再次命中或状态变为 `candidate-rule`，立即进入 `Promotion Loop`
- 写完 `notes/research/` 后，如果结论已形成稳定触发条件与执行步骤，立即进入 `Promotion Loop`
- 写完 `notes/design/` 后，如果设计决策已跨任务复用，立即进入 `Promotion Loop`
- 会话结束前若本轮更新过 note，默认做一次轻量晋升扫描

当前最小执行链已经落地为：

1. `promotion-scan.py` 轻量扫描并写入 `promotion-queue.json`
2. `promotion-gate.py` 在 queue 仍有 actionable candidates 时阻止静默结束
3. 主 agent / orchestrator 运行 `promotion-dispatch.py claim`
4. 若有候选，则派发 `promote-notes` subagent
5. subagent 写 `promotion-result.json`，再运行 `promotion-apply-result.py`
6. `promotion-dispatch.py apply` 根据结果清理或更新 queue

这意味着：

- hook 不直接执行完整晋升
- 主 agent 不直接做完整评估
- queue 成为主 agent 与 subagent 之间的事实源

### 与 hooks 的关系

- `hooks/` 负责事件触发时的自动动作
- `notes/` 负责事件之后的知识沉淀与后续复用
- hook 可以提醒“该检查是否需要写 note”，但不应自动注入大量 note 原文

## 当前约束

- `notes/` 的核心是“沉淀”，不是“约束”
- 优先保留高信号内容，不做聊天记录堆积
- 一条 note 最好只服务一个主题，便于后续提炼
- lesson note 不应退化成按日期堆积的事件日志
