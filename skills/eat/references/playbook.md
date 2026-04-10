# Eat Playbook

本文件保留 `eat` 的长流程、模板和即时配置细节。只有在真正执行知识吸收时再读。

## 输入类型

| 类型 | 获取方法 | 特点 |
|------|----------|------|
| URL | WebFetch / WebSearch | 可能有鉴权 |
| 本地文件 | Read | 直接读取 |
| 粘贴文本 | 无需工具 | 已在上下文 |
| 多媒体 | OCR / 提取工具 | 先转文字 |

## 检索记录模板

```text
相关知识检索记录：
- 检索关键词：...
- 命中结果：
  - notes/research/xxx.md（高/中/低）
  - notes/lessons/xxx.md（高/中/低）
  - rules/xxx.md（高/中/低）
  - skills/xxx/SKILL.md（高/中/低）
- 当前处理策略：增量吸收 / 新建规则候选 / 先记入 notes
```

## 同构度评估

### 高同构

- 当前输入和本地系统在目标或闭环上高度重合
- 已足够指出具体缺口
- 本轮应直接 patch `rules/skills/hooks/workflows`

### 中同构

- 有明显映射，但还缺证据
- 先写 `notes/research/` 或 `notes/design/`

### 低同构

- 只有启发性
- 可只写 note

## 时效性验证

### 建议动作

```bash
WebSearch query="[文章标题] published date 2024 2025"
WebSearch query="[工具名] latest version release 2024 2025"
```

### 记录模板

```text
时效性验证记录：
- 来源 1: [标题] - [日期] - ✅/⚠️/❌
- 来源 2: [标题] - [日期] - ✅/⚠️/❌
- 结论：[是否可信]
```

## 即时配置

只有在知识吸收明确发现“立刻可用的新工具”时才做。

### MCP

- 读取现有 `.mcp.json`
- 检查是否已有同名配置
- 添加最小配置
- 提示用户重启会话

### npm 包

- CLI 工具：可考虑全局安装
- SDK / library：提示用户在目标项目内安装

### Skill

- 可直接用 skills CLI 安装
- 或手动放入 `skills/`

## 输出模板

### 规范模板

```markdown
# [标题]

> 来源：[原始链接/出处]

## 触发条件

- [条件]

## 执行规范

1. [步骤]

## 决策框架

```text
[判断树]
```
```

### 知识模板

```markdown
# [标题]

> 来源：[原始链接/出处]
> 吸收时间：YYYY-MM-DD

## 核心洞察

[一句话]

## 详细内容

[展开]
```
