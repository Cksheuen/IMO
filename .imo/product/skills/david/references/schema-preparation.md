# 工程准备字段

### 工程准备

`MappingRow.preparation` 可选，字段真源为 `project/src/lib/preparationModel.ts`。结构为：

```ts
preparation: {
  id: string;
  title: string;
  tasks: { id: string; label: string; detail?: string }[];
  fields: { id: string; label: string; placeholder?: string; value?: string; required?: boolean }[];
}
```

两数组合计 1–60 项，条目 id 必须唯一；未知键、空标签、非法类型拒绝。真实 checkbox/text input 位于实现列，总览默认折叠；同一 slug 与 preparation.id 共享本机浏览器记录。刷新保留填写，存储不可用时明确只保留本次页面内存。该状态不修改 review JSON，不创建文件、不提交表单，也不修改评论服务状态。`required` 仅标识待收集信息，不构成实现授权或自动阻塞评审。

`changeBlock.before/after.codeAnnotations` 与技术代码使用相同的行号/范围校验和 hover 展示。注释只能附在 code 侧，不能附在 text 侧；`parseReviewSpec` 与两份 renderer 共用校验器。

代码改动对照按原始行号计算相同行、删除行和新增行：删除行右侧留空、新增行左侧留空，相同行保持同一高度，红/绿标记只应用到实际变化行；两侧垂直滚动同步。窄屏保留对照关系并允许横向滚动，不改成无法逐行比较的上下堆叠。行级 hover 注释继续引用各侧原始行号。
