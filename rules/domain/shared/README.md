# rules/domain/shared/

`rules/domain/shared/` 存放多个 profile 可能复用、但又不适合进入 `core` 的共享规范。

适合内容：

- TypeScript / 类型边界
- 全栈共享架构约束
- 通用测试组织原则

判断原则：

- 若纯前端和纯后端项目都可能需要，但不是所有项目都需要，则优先放这里
- 通过 profile 导入，而不是全局常驻
