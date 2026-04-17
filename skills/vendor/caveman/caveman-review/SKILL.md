---
name: caveman-review
description: >
  极简代码 Review 注释生成器。每条发现一行：位置 + 问题 + 修复。触发：用户说
  "review 这个 PR"、"code review"、"/review"、或调用 /caveman-review。
---

# Caveman Review

> 本 skill 是 [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) 的中文化改版。
> 调用提示中文，**输出的 review 注释按场景自选中英**：PR 是中文仓默认中文，英文仓默认英文。

## 核心格式

`L<line>: <问题>. <修复>.`

多文件 diff 场景：`<file>:L<line>: ...`

## 严重度前缀（混合严重度时使用）

| 前缀 | 含义 |
|------|------|
| `🔴 bug:` | 真 bug，会造成线上事故 |
| `🟡 risk:` | 能跑但脆弱（竞态、未判空、吞错误） |
| `🔵 nit:` | 风格/命名/微优化，作者可忽略 |
| `❓ q:` | 真正的提问，不是建议 |

## 禁写

- `我注意到...` / `看起来像是...` / `你可以考虑...`
- `这只是个建议，但...` → 用 `nit:`
- `整体不错，但是...` → 只在 review 开头说一次，别每条重复
- 复述这行代码做了什么 → reviewer 会读 diff
- `也许` / `可能` / `我觉得` → 不确定就用 `q:`

## 保留

- 精确行号
- 精确的符号/函数/变量名（用反引号包裹）
- 具体的修复方案，不是"考虑 refactor 一下"
- 如果修复方案从问题描述看不出来，说清"为什么"

## 正反例

**反例**：
> 我注意到第 42 行你没有在访问 email 属性前检查 user 对象是否为 null。如果数据库没找到这个用户，可能会导致崩溃。你可以考虑在这里加一个 null 检查。

**正例**：
```
L42: 🔴 bug: user 在 .find() 后可能为 null。访问 .email 前需加 guard。
```

---

**反例**：
> 这个函数看起来做了很多事情，也许拆成更小的函数会提升可读性。

**正例**：
```
L88-140: 🔵 nit: 50 行函数做了 4 件事。拆出 validate / normalize / persist。
```

---

**反例**：
> 你考虑过 API 返回 429 的情况吗？我觉得我们应该处理一下。

**正例**：
```
L23: 🟡 risk: 429 无重试。用 withBackoff(3) 包裹。
```

## 自动降级

以下场景**必须展开写完整段落**，不压缩：

- 安全发现（CVE 级 bug 需完整说明 + CVE 参考）
- 架构层面的分歧（需要理由，不是单行）
- 新人 onboarding 上下文（作者需要"为什么"）

这类评论写完整段后，其余评论恢复简洁。

## 边界

- 只生成 review 注释，不写修复代码，不 approve / request-changes，不跑 linter
- 输出为可直接粘贴到 PR 的文本
- "stop caveman-review" / "normal mode" → 恢复冗长风格
