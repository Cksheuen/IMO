# LLM 友好格式规范

> 来源：调研 Markdown/YAML/JSON 对 LLM 的效率影响 | 吸收时间：2026-03-26

## 触发条件

当编写供 LLM 阅读的文档（rules、skills、memory）时，应用此规范：
- 需要在 token 效率和可读性之间平衡
- 包含嵌套结构或配置数据
- 追求 Agent 正确解析的高准确性

## 核心原则

**混合格式：叙述用 Markdown，结构用 YAML**

| 格式 | Token 效率 | 准确性 | 适用场景 |
|------|------------|--------|----------|
| **Markdown** | 最高（比 JSON 省 34-38%） | 中 | 纯文本描述、流程说明 |
| **YAML** | 中（比 JSON 省 10-15%） | **最高 62%** | 嵌套结构、配置数据 |
| **JSON** | 低 | 中 50% | API 交互、程序化处理 |
| **XML** | 最差（比 Markdown 多 80%） | 低 | ❌ 禁止使用 |

## 决策框架

```
内容类型？
    │
    ├─ 嵌套层级 ≥ 3 层 ──→ YAML 代码块
    │
    ├─ 流程步骤 ──→ Markdown 列表
    │
    ├─ 对比数据 ──→ Markdown 表格
    │
    └─ 决策逻辑 ──→ Markdown 代码块（ASCII 树）
```

## 格式规范

### 1. 嵌套结构 → YAML 代码块

```yaml
# ✅ 层级关系清晰，Agent 解析准确
architecture:
  layers:
    llm:
      role: "理解任务"
      input: "自然语言"
    dom:
      role: "提取结构"
      input: "Raw HTML"
```

### 2. 流程步骤 → Markdown 列表

```markdown
1. 接收用户输入
2. LLM 解析任务
3. DOM 提取元素
```

### 3. 对比数据 → Markdown 表格

| 方案 | 优点 | 缺点 |
|------|------|------|
| A | 快速 | 不稳定 |

### 4. 决策逻辑 → ASCII 树

```
条件判断？
    ├─ 是 → 执行 A
    └─ 否 → 执行 B
```

## 反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|----------|
| 全部用 YAML | Token 浪费 | 叙述用 Markdown |
| 全部用 Markdown | 嵌套结构难解析 | 深层嵌套用 YAML |
| 使用 XML | Token 浪费 80% | ❌ 禁止 |
| 使用 JSON | Token 浪费 34% | 仅 API 交互时用 |

## 检查清单

- [ ] 嵌套 ≥ 3 层的结构是否使用 YAML 代码块？
- [ ] 流程描述是否使用 Markdown 列表？
- [ ] 对比数据是否使用 Markdown 表格？
- [ ] 是否避免了 XML 和不必要的 JSON？
- [ ] 同一文件内格式风格是否统一？

## 相关规范

- [[code-as-interface]] - 代码生成模式

## 参考

- [Which Nested Data Format Do LLMs Understand Best?](https://www.improvingagents.com/blog/best-nested-data-format)
- [Markdown is 15% more token efficient than JSON](https://community.openai.com/t/markdown-is-15-more-token-efficient-than-json/841742)
