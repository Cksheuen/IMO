---
name: cc-to-framework-migration
description: Claude Code 配置到独立 Agent 框架的迁移评估与实现入口。扫描 skills、rules、agents，识别真正需要状态机、持久化、服务化或生产观测的高价值候选，再生成最小迁移方案。用户提到“迁移到框架”“LangChain/LangGraph 迁移”“框架化”或“独立部署 Agent”时触发。
description_en: "Evaluate and migrate suitable Claude Code skills, rules, and agents into an independently deployable agent framework."
---

# CC-to-Framework Migration

只迁移因复杂状态、独立部署或生产运行而真正受益的能力。Markdown
配置仍是最佳形态时，明确保留，不为“框架化”制造代码。

## 触发与排除

适用：

- 需要跨会话状态、checkpoint、循环或人工中断恢复；
- 需要独立服务、多租户、生产追踪或跨模型运行；
- 用户明确要求把现有 CC agent/skill 迁成框架代码。

不适用：

- 仅分享或复用一个 skill；
- 简单子 agent 调用、文件操作或快速原型；
- 强依赖宿主工具且没有独立部署需求。

## 决策框架

逐项评估：

| 维度 | 正向信号 | 负向信号 |
| --- | --- | --- |
| 状态复杂度 | 分支、循环、恢复、checkpoint | 纯声明式步骤 |
| 运行需求 | 服务化、多租户、可观测 | 仅本地个人使用 |
| 宿主耦合 | 纯 API/工具协议 | 深度依赖宿主文件和原生工具 |
| 验证成本 | 有稳定输入输出契约 | 行为主要依赖隐式会话上下文 |

纯声明式内容或深度宿主耦合项默认不得判为高价值迁移。

## 工作流

1. 扫描用户指定范围；未指定时，限定在相关 `skills/`、`rules/`、
   `agents/`，不要默认复制整个配置目录。
2. 为每项记录当前入口、状态、依赖、副作用、验证方式和宿主耦合。
3. 分为 `migrate`、`keep`、`needs-evidence`，说明收益与成本。
4. 只对用户确认的 `migrate` 项设计状态、节点、工具、恢复和观测契约。
5. 先实现一条端到端最小路径，再扩展并行、重试或 provider 适配。
6. 用原实现的代表性输入对照验证；记录有意差异。

## 映射原则

- skill 步骤可映射为 tool、node 或 chain，但不机械一一转换；
- agent prompt 是策略输入，不等于稳定业务状态；
- task list 可映射为显式 state，但只有恢复需求时才引入 checkpointer；
- 并发由独立性和写集决定，不因框架支持而默认开启；
- 人工 gate 必须有明确暂停点、恢复输入和幂等边界；
- 宿主文件、worktree、权限和凭证隔离需要外部适配，不能声称由图框架自动解决。

具体 API 会演进。实现前只查所选框架的官方当前文档，不把旧示例当契约。

## 交付物

- 候选清单：分类、证据、收益、成本和迁移建议；
- 最小架构：state、nodes、edges、tools、side effects、recovery；
- 可运行实现与聚焦测试；
- 原实现和迁移实现的行为对照；
- 保留项及不迁移原因。

已有迁移样本与历史分析按需读取本目录的 `migrated/` 和
`migration-analysis-report.md`，不要在触发时全部加载。

## 边界

- 不因用户提到 LangChain/LangGraph 就默认全量迁移；
- 不复制 secrets、runtime state 或用户私有数据；
- 不伪造框架能力、provider 可用性或部署结果；
- 不用大型抽象替代一个仍然清晰的 Markdown workflow；
- 未验证的候选保持 `needs-evidence`，不强行生成代码。
