# rich-code

rich-code migrated from current David source

- 源码：`src/`；运行包：`dist/index.mjs`。
- 构建：在 Icarus workspace 执行 `npm run build -- rich-code`。
- 独立 ZIP：`npm run mod -- pack mods/rich-code --out /absolute/rich-code.zip`。
- 输入与插槽：[David 模块契约](../../../references/david-mods.md)。
- 原始文件归属：[来源清单](../../packages/david-source/source-manifest.json)。

源码开发依赖 workspace 中的共享原语；发布包只需 mod.json 声明的运行时依赖。请用 Icarus pack/release，避免将开发 package.json 直接作为 npm 发布包。

`highlights` 可选参数与 Research 工作台共用原 CodeBlock：

```json
{
  "code": "config.read()",
  "highlights": [
    {
      "kind": "config",
      "label": "配置",
      "tone": "violet",
      "tokens": ["config.read()"]
    }
  ]
}
```

支持 `violet/blue/green/amber/rose/cyan/lime/coral`；默认按字面内容匹配。`match: "identifier"` 只匹配完整标识符；`legend: false` 可隐藏该规则的图例。不执行输入中的正则或 HTML。

`lineNumbers` 可逐行提供原始源码行号，例如 `[20, 21, null, 30]`；`null` 显示为 `—`，批注行号仍相对于传入代码计算。

公开源码入口：`src/public.ts`，统一输出原 CodeBlock、批注/高亮校验与类型。复合消费者声明 `icarusBuild.composes: ["rich-code"]`，不要绕过入口重复实现或直接导入底层渲染器。

`symbols` 是相关代码共用的标识符列表，例如 `["Input", "Output", "SelectionABResult", "PromptCandidates", "PromptCandidate"]`。Input/Output 固定紫/蓝色，其余按声明顺序分配固定的六色调色板并循环；新增名字追加到列表即可保持已有颜色。最多 64 个唯一标识符。使用原 CodeBlock 渲染，源码文本、行号和批注锚点不变；颜色只辅助关联，名称仍完整显示，不额外堆叠图例。

符号在当前代码块中有明确声明时可点击跳转到定义行；类型化字段（如 `PromptCandidates []PromptCandidate`）跳到对应类型。定义行会高亮并滚入代码窗口，支持键盘 Enter；不改源码文本、相对行号或真实源码行号。声明缺失或重名有歧义时保留普通高亮；注释/字符串中的示例不当作定义。`definitions: {"Name": 7}` 可显式指定当前块中的第 7 行（不是显示的源码行号），供不适合自动识别的语言使用。
