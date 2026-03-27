# hooks / notes 调用链设计

- Date: 2026-03-27

## 问题

只初始化 `hooks/` 与 `notes/` 目录是不够的。

目录没有内容，根因通常有两类：

- 没有语义定义
- 没有调用链

本仓库此前两个问题都存在，而当前阶段更关键的是把调用链补齐。

## hooks/ 的调用链

### 写入/维护者

- 人工创建 hook 脚本
- Agent 在明确需要事件自动化时补充脚本与说明

### 读取/执行者

- Claude Code hook runtime

### 触发入口

- `settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`

### 生效条件

只有目录内有脚本并不够，还必须满足：

1. 在 settings 中声明对应事件
2. 指向实际脚本路径
3. matcher 与事件类型匹配
4. 脚本可执行且输出符合 hook 约定

### 设计补充要求

以后新增 hook 时，文档中至少写清：

- 绑定的事件名
- 配置位置
- 脚本路径
- 输入输出约定
- 验证方法

## notes/ 的调用链

### 写入者

- Agent 在 Learn / brainstorm / 设计讨论中写入
- 人工在复盘、迁移、记录经验时写入

### 读取者

- 后续调研与设计工作
- 从 `notes/` 晋升 `rules/`、`skills/`、`memory/` 的 `Promotion Loop`
- `Correction Loop` / `Research Loop` / `Design Loop` / `Recovery Loop` 等任务循环

### 触发入口

- `CLAUDE.md` 的 Learn 阶段
- `brainstorm` 等技能的调研收敛阶段
- `Promotion Loop` 的晋升判断阶段
- 用户明确要求“记下来”“沉淀一下”“做个教训记录”

### 建议触发条件

- 用户纠正了 agent 的理解或方法
- 用户追问暴露了设计漏洞、遗漏或误判
- 完成了一次值得复用的调研
- 做出尚未稳定到进入 `rules/` 的设计决策
- 需要记录迁移计划或复盘

### 读取协议

- 被纠正、被质疑、被要求复盘：先读取 `notes/lessons/`
- 做调研、技术选型、方案比较：先读取 `notes/research/`
- 做目录、架构、调用链设计：先读取 `notes/design/`
- 执行失败、返工、回滚：回读 `notes/lessons/`
- note 达到稳定门槛：进入 `Promotion Loop`

## 验证标准

判断一个目录是否“设计完成”，至少要同时满足：

- 有语义定义
- 有写入触发条件
- 有读取/执行入口
- 有至少一个最小样例
