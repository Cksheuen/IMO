# DOCX Authoring Reference

需要在 `.docx` 中新建结构化内容时再读取本文件。

## 基本生成流程

1. 用 `docx` / `docx-js` 生成文档
2. 明确页尺寸、边距、样式
3. 写完后运行 `scripts/office/validate.py`
4. 验证失败时再 unpack 修 XML

## 关键规则

- 明确设置 page size，不依赖默认值
- 美国文档默认用 US Letter
- Landscape 时传 portrait 尺寸，由库自己 swap
- 不要手写 unicode bullet，使用 numbering config
- PageBreak 必须放在 Paragraph 内
- Heading 要用正确的 heading level，TOC 才能识别
- 表格必须双重指定宽度：table `columnWidths` + cell `width`
- 表格宽度用 `DXA`，不要用百分比
- `ShadingType.CLEAR` 优于 `SOLID`
- 不要用 table 模拟分隔线

## 常见结构

### 页尺寸

```javascript
page: {
  size: { width: 12240, height: 15840 },
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
}
```

### 列表

```javascript
numbering: {
  config: [
    {
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•" }]
    }
  ]
}
```

### 表格

```javascript
new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [4680, 4680],
  rows: [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          children: [new Paragraph("Cell")]
        })
      ]
    })
  ]
})
```

### 图片

```javascript
new ImageRun({
  type: "png",
  data: fs.readFileSync("image.png"),
  transformation: { width: 200, height: 150 }
})
```

### TOC

```javascript
new TableOfContents("Table of Contents", {
  hyperlink: true,
  headingStyleRange: "1-3"
})
```

### 页眉页脚

```javascript
headers: { default: new Header({ children: [new Paragraph("Header")] }) }
footers: { default: new Footer({ children: [new Paragraph("Footer")] }) }
```
