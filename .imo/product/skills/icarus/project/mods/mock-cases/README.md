# mock-cases

独立的 Mock 场景切换、JSON 查看与可信本地 HTML 预览。使用 `rich-code` 的公开源码入口，沿用原 David CodeBlock；研究工作台复用本目录的 `src/public.tsx`，不再内联实现。

```html
<div data-icarus-mock-cases>
  <script type="application/json" data-icarus-props>
    {"id":"entry","cases":[{"id":"visible","label":"显示入口","note":"本地示意","payload":{"prompt":"Trending products?"},"previewHtml":"<button>Trending products?</button>"}]}
  </script>
</div>
```

`previewHtml` 只接收用户授权的可信模板，不执行评论给出的脚本。`cases` 中的 id 必须唯一，label、note、payload 必填；原 `mock:<id>` 评论锚点保持。

在 Icarus workspace 中：

```bash
npm run build -- mock-cases research-workbench
npm run mod -- pack mods/mock-cases --out /absolute/mock-cases.zip
icarus mod install /absolute/mock-cases.zip
icarus mod enable /absolute/source.html --mods mock-cases
icarus mod disable /absolute/source.html --mods mock-cases
```

独立入口可运行时装卸；工作台通过源码组合复用，更新后须重建工作台。参见 [Mod 实现规范](../../../references/mod-implementation.md)。
