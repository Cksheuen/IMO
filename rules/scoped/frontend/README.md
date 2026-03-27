# rules/scoped/frontend/

带 `paths:` frontmatter 的前端文件级规则入口。

目标：

- 只有在处理前端相关文件时才加载
- 避免前端约束污染后端或文档任务

典型路径：

- `src/**/*.{ts,tsx,js,jsx}`
- `app/**/*.{ts,tsx,js,jsx}`
- `components/**/*.{ts,tsx}`

Phase 1 仅创建结构说明，后续补真正的 path-scoped rule。
