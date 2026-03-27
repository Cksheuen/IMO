# rules/scoped/backend/

带 `paths:` frontmatter 的后端文件级规则入口。

目标：

- 只有在处理后端相关文件时才加载
- 避免后端约束进入纯前端任务

典型路径：

- `src/api/**/*.ts`
- `server/**/*.ts`
- `services/**/*.py`

Phase 1 仅创建结构说明，后续补真正的 path-scoped rule。
