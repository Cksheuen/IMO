---
name: evolve-notes
description: 在确需跨轮修订时维护临时 Markdown 认知工作面；保留被替代认知的划除痕迹，生成当前有效视图，使用稳定书签按主题定位，并在单文件过大时提升为目录。稳定结论应回填现有 rule、skill 或 profile，完成回读后删除工作面；不用于 PRD、spec、实施计划或短小的一次性摘要。
---

# Evolve Notes

把笔记当作可修订的临时认知工作台，而不是知识最终载体、一次性总结或任务状态机。

## 边界

- 只管理笔记的演进、定位和当前视图；资料理解与本地映射由调用方负责。
- 不创建 PRD、spec、task tree、进度表或实现计划。
- 单轮即可完成的短资料直接总结，不引入笔记仪式。
- 先检查现有 rule、skill、profile 和项目 source/docs 是否已有承载；能直接回填时不创建 note。
- 用户要求直接炼化时，note 只作临时工作面；目标 owner 回读、引用清理完成后删除，不保留归档副本。
- 不把被推翻的认识直接删除；保留原位划除和修订原因。

## 工作流

1. 先确定现有承载 owner；只有目标尚不明确且确需多轮修订时，才确定 note 根目录。IMO 临时真源使用 `.imo/notes/`，普通项目优先复用已有 `notes/`。
2. 新建笔记时复制 `assets/note-template.md`，填写来源、目标和初始书签。
3. 首轮只建立结构地图、问题和证据位置，不急于写最终结论。
4. 每轮阅读后分别记录来源事实、推断和待验证假设。
5. 认识被替代时，将旧内容写成 `~~旧内容~~`，紧跟新内容，并在修订记录说明证据与原因。
6. 用稳定的 `note:bookmark` ID 定位主题；标题可改，ID 不随标题变化。
7. 需要给模型或读者提供干净上下文时，生成当前有效视图；不要手工复制“最终版”形成第二真源。
8. 达到目录化阈值时，按主题拆分文件并保留一个索引入口；结论稳定后回填目标 owner，删除 note 及其索引引用。

首次创建、目录化或修改标记语法时，读取 `references/note-format.md`。

## 工具

生成去除划除内容后的当前视图：

```bash
python3 <skill-dir>/scripts/note_active_view.py NOTE.md
python3 <skill-dir>/scripts/note_active_view.py NOTE.md --bookmark topic-id
python3 <skill-dir>/scripts/note_active_view.py NOTE.md --mode struck
python3 <skill-dir>/scripts/note_active_view.py NOTE.md --mode stats
```

列出、定位和校验书签：

```bash
python3 <skill-dir>/scripts/note_bookmarks.py list NOTE.md
python3 <skill-dir>/scripts/note_bookmarks.py show NOTE.md topic-id
python3 <skill-dir>/scripts/note_bookmarks.py validate NOTE.md
python3 <skill-dir>/scripts/note_bookmarks.py index NOTE-DIR
python3 <skill-dir>/scripts/note_bookmarks.py validate NOTE-DIR
```

目录参数只用于一个已目录化 note 根；书签 ID 在该 note 内保持唯一。`index`
输出是可丢弃视图，`INDEX.md` 仍是人工修订的真源。脚本只读笔记并输出结果，
不自动改写源文件。

## 目录化阈值

满足任一条件时考虑从单文件提升为目录：

- 稳定书签超过 20 个；
- 当前有效正文超过 1,500 行；
- 出现 3 个以上可独立复用的主题；
- 单次主题检阅仍需读取超过 25% 的无关正文。

目录化不是自动拆分。先确认主题边界，再保留来源、修订和跨文件书签索引。
阈值判断优先读取 `--mode stats`，避免按包含大量已划除历史的原始行数误拆分。

## 交接

- 新资料的获取、证据核对和本地能力映射交给 `eat`（炼化）。
- 已稳定且跨任务复用的内容交给 `promote-notes` 判断是否升格，或按用户授权直接回填现有 owner。
- 来源和认知演进只在当前工作面仍有必要时保留；完成回填、回读和引用清理后删除原 note，
  不把晋升结果倒灌成新的任务/spec 框架。
