---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX creation, editing, and analysis

`.docx` 是 ZIP + XML。这个 skill 的目标不是背诵 WordprocessingML，而是快速判断该走哪条路线，并调用现有脚本完成工作。

## 何时使用

- 读取、总结、转换 `.docx`
- 新建 Word 文档
- 修改已有 Word 文档
- 处理 tracked changes / comments / images / TOC / headers / footers
- 把 `.doc` 转成 `.docx`

不要用于：

- PDF 工作流
- 电子表格
- 一般代码任务

## 快速路线

| 任务 | 推荐路线 |
|------|----------|
| 读取内容 | `pandoc` 或 `scripts/office/unpack.py` |
| 新建文档 | `docx` / `docx-js` + 验证 |
| 修改已有文档 | unpack → edit XML → pack |
| 接受修订 | `scripts/accept_changes.py` |
| 转图片 | 先转 PDF，再 `pdftoppm` |

## 最小工作流

### 1. 读取 / 分析

```bash
pandoc --track-changes=all document.docx -o output.md
python scripts/office/unpack.py document.docx unpacked/
```

### 2. 新建文档

优先用 `docx` 生成，然后立即验证：

```bash
python scripts/office/validate.py doc.docx
```

### 3. 修改已有文档

严格按三步走：

```bash
python scripts/office/unpack.py document.docx unpacked/
# 直接编辑 unpacked/word/*.xml
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```

### 4. 接受修订

```bash
python scripts/accept_changes.py input.docx output.docx
```

## 硬规则

- 新建文档后必须验证
- 编辑已有文档时直接改 XML，不要临时写复杂脚本
- tracked changes / comments 必须保持合法 XML 结构
- 新增文本时使用 smart quotes 的 XML entity
- 表格默认用 `DXA` 宽度，不用百分比
- image 必须补齐 relationship / content type / 引用
- 遇到复杂版式时，优先查参考文件，不要凭记忆硬写 XML

## 常见决策

| 情况 | 处理 |
|------|------|
| 只是提取文字 | `pandoc` 即可 |
| 需要精确保留结构 | unpack XML |
| 需要 tracked changes / comments | 走 XML 编辑路线 |
| 需要专业排版的新文档 | 用 `docx` 生成 |
| 需要批量修改旧文档 | unpack 后最小化编辑，再 repack |

## 参考文件

- `references/authoring.md`：新建文档的常用模式与 `docx-js` 规则
- `references/xml-editing.md`：修改已有文档、tracked changes、comments、images
- `scripts/office/validate.py`
- `scripts/office/unpack.py`
- `scripts/office/pack.py`
- `scripts/comment.py`
- `scripts/accept_changes.py`
- `scripts/office/soffice.py`
