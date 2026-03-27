# rules/scoped/tests/

测试文件级规则入口。

目标：

- 仅在处理测试文件时加载
- 将测试策略与生产代码规范分开注入

典型路径：

- `**/*.{test,spec}.{ts,tsx,js,jsx,py}`
- `tests/**/*`

Phase 1 仅创建结构说明，后续补真正的 path-scoped rule。
