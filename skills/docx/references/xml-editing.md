# DOCX XML Editing Reference

仅在需要修改现有 `.docx`、tracked changes、comments 或 image relationships 时读取。

## 三步流程

```bash
python scripts/office/unpack.py document.docx unpacked/
# 编辑 unpacked/word/*.xml
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```

## 编辑规则

- 直接改 `unpacked/word/` 下的 XML
- 默认作者名用 `Claude`，除非用户指定
- 优先做最小替换，不扩大 diff
- 新增引号/撇号时用 smart quote entity：
  - `&#x2018;`
  - `&#x2019;`
  - `&#x201C;`
  - `&#x201D;`

## Tracked Changes

### 插入

```xml
<w:ins w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>inserted text</w:t></w:r>
</w:ins>
```

### 删除

```xml
<w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>deleted text</w:delText></w:r>
</w:del>
```

### 关键点

- 不要把 tracked change tag 塞进 `<w:r>` 内部
- 删除时用 `<w:delText>`，不是 `<w:t>`
- 整段删除时要一并处理 paragraph mark，否则接受修订后会留下空段落

## Comments

优先用脚本生成 comment boilerplate：

```bash
python scripts/comment.py unpacked/ 0 "Comment text with &amp; and &#x2019;"
```

### 关键点

- `<w:commentRangeStart>` / `<w:commentRangeEnd>` 是 `<w:p>` 的子节点，不是 `<w:r>` 的子节点
- reply 通过 `--parent` 建立关联

## Images

插图至少要同时改三处：

1. `word/media/` 放文件
2. `word/_rels/document.xml.rels` 加 relationship
3. `[Content_Types].xml` 加 content type

然后在 `document.xml` 中引用 `rId`

## 校验

pack 之后仍需检查：

- XML 是否合法
- relationship 是否齐全
- schema 是否明显冲突
- 空白文本是否需要 `xml:space="preserve"`
