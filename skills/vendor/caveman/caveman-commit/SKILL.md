---
name: caveman-commit
description: >
  生成极简 Commit Message。采用 Conventional Commits 格式（英文），subject ≤ 50 字符，
  只在"为什么"不显而易见时写 body。触发：用户说"写个 commit"、"生成 commit message"、
  "/commit"、或调用 /caveman-commit。
---

# Caveman Commit

> 本 skill 是 [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) 的中文化改版。
> 仅调用提示中文，**commit message 输出保持英文**（Conventional Commits 约定）。

## 核心规则

**Subject line：**

- 格式：`<type>(<scope>): <imperative summary>` — `<scope>` 可选
- `<type>` 取值：`feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`
- 祈使语气：`add` / `fix` / `remove`，不是 `added` / `adds` / `adding`
- ≤ 50 字符（尽量），硬上限 72
- 末尾不加句号
- 冒号后的首字母大小写跟随项目习惯

**Body（仅必要时写）：**

- 自解释的 subject → 不写 body
- 以下情况必须写：非显然的"为什么"、breaking change、迁移说明、关联 issue
- 每行 ≤ 72 字符
- 列表用 `-`，不用 `*`
- 末尾引用 issue/PR：`Closes #42`、`Refs #17`

## 禁写

- `This commit does X` / `I` / `we` / `now` / `currently` — diff 自己说话
- `As requested by ...` — 用 `Co-authored-by:` trailer
- `Generated with Claude Code` 或任何 AI 署名
- emoji（除非项目有约定）
- 重复文件名（scope 已经说过）

## 正反例

**反例**（冗余）：
```
feat: add a new endpoint to get user profile information from the database
```

**正例**（why 显著时带 body）：
```
feat(api): add GET /users/:id/profile

Mobile client needs profile data without the full user payload
to reduce LTE bandwidth on cold-launch screens.

Closes #128
```

**Breaking change**：
```
feat(api)!: rename /v1/orders to /v1/checkout

BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
before 2026-06-01. Old route returns 410 after that date.
```

## 自动降级

以下情况**必须写 body**，禁止压缩到 subject-only：

- breaking change
- security fix
- data migration
- revert 历史 commit

未来调试者需要上下文，不能省。

## 边界

- 仅生成 message，不执行 `git commit`、不 stage、不 amend
- 输出为可直接粘贴的代码块
- "stop caveman-commit" / "normal mode" → 恢复冗长风格
