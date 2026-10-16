# rich-content

rich-content migrated from current David source

- 源码：`src/`；运行包：`dist/index.mjs`。
- 构建：在 Icarus workspace 执行 `npm run build -- rich-content`。
- 独立 ZIP：`npm run mod -- pack mods/rich-content --out /absolute/rich-content.zip`。
- 输入与插槽：[David 模块契约](../../../references/david-mods.md)。
- 原始文件归属：[来源清单](../../packages/david-source/source-manifest.json)。

源码开发依赖 workspace 中的共享原语；发布包只需 mod.json 声明的运行时依赖。请用 Icarus pack/release，避免将开发 package.json 直接作为 npm 发布包。
