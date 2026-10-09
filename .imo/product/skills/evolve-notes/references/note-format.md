# Evolving note format

## Minimal document

Use frontmatter for identity and current state, not for revision history:

```yaml
---
note_schema: evolve-notes/v1
note_id: stable-id
source: source URL or local path
status: incubating
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
current_revision: R0
---
```

Keep a manual bookmark index near the top. Declare each target immediately before its heading:

```markdown
- `thesis`: 当前主论点

<!-- note:bookmark id=thesis title="当前主论点" -->
## 当前主论点
```

IDs use lowercase letters, digits, `.`, `_`, and `-`. Keep IDs stable when headings change.

## Evidence labels

Make epistemic status explicit when it matters:

- `来源事实`：the source directly supports the statement;
- `推断`：derived from one or more source facts;
- `假设`：useful but not yet verified;
- `本地证据`：verified against the target repository, runtime, or tests.

Do not turn every sentence into a schema field. Labels are for claims whose status affects a decision.

## Revision grammar

When a later pass changes an earlier belief:

```markdown
~~旧认识。~~（R2：被 section 4.1 的反例替代）

新认识。
```

Apply these rules:

1. Keep the old statement where it was first useful.
2. Strike the smallest complete span that became invalid.
3. Append the replacement immediately after it.
4. Add a short entry under `认知修订记录` with evidence and reason.
5. Do not use strikethrough as decoration; it means superseded understanding.
6. Fenced and inline code containing `~~` is literal code, not revision markup.

## Retrieval

Use `note_bookmarks.py list` before reading a large note. Read only the relevant bookmark section, then use `note_active_view.py --bookmark` when obsolete reasoning would waste context. Use `note_active_view.py --mode stats` to judge active size independently from retained history.

While the work is active, the source note is the canonical working surface. After
promotion, the target rule, skill, profile, or project source becomes canonical;
generated active views, bookmark JSON, and the completed note are disposable and
must not become a second editable truth.

## Folder promotion

When a threshold is reached, prefer:

```text
<note-id>/
  INDEX.md
  sources.md
  revisions.md
  topics/
    <topic-id>.md
```

- `INDEX.md` owns the cross-file bookmark index and current synthesis.
- `sources.md` owns source metadata and evidence locations.
- `revisions.md` summarizes cross-topic changes; local superseded text still stays struck in its topic file.
- Topic files own detailed reasoning and may have their own bookmark index.
- Bookmark IDs remain unique across one promoted note directory. Use `note_bookmarks.py index <note-dir>` for a disposable cross-file location view and `validate <note-dir>` before handoff.

Do not split only because a raw file is long. Split when stable topic boundaries reduce irrelevant reads.
