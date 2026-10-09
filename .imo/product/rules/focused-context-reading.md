# Focused Context Reading Rule

## Summary

When understanding a large file, document, log, generated artifact, or search
result, locate the relevant evidence with keywords and structure first, then
read bounded slices. Keep the prompt context focused so repeated or irrelevant
content does not consume tokens.

## Trigger

Apply this rule when any of these are true:

- a target file or command output is large enough that a full read is likely to
  exceed the current task's useful context
- the task involves logs, JSONL/RAX exports, generated files, snapshots, or
  repository-wide search results
- the user asks to understand, review, diagnose, or locate behavior in a large
  surface
- the same file or output would otherwise be loaded repeatedly while searching
  for a small number of facts

## Priority

Use this priority order:

```text
explicit user instruction
> repository hard rules / specs
> local neighboring implementation patterns
> active IMO learning digest
> generic agent training defaults
```

This rule controls context acquisition, not the amount of evidence required to
support a conclusion.

## Required Local Evidence

Before reading a large surface in full, identify:

- the concrete question and the fields, symbols, headings, or events that can
  answer it
- the file format and a suitable structural or streaming parser
- the relevant entry points, references, line ranges, or record identifiers
- the smallest neighboring context needed to verify ownership and behavior
- the validation that will show the selected slices were sufficient

## Habits To Suppress

- loading an entire large file into prompt context before locating evidence
- using broad `cat`, unbounded `head`, or recursive dumps as the first search
- pasting the same long output into multiple reasoning steps
- scanning generated artifacts or historical logs when source ownership already
  answers the question
- treating absence from a truncated result as proof that a symbol or field is
  absent

## Implementation Behavior

1. State the question and search terms before reading. Use `rg`, `rg --files`,
   symbol/index lookup, or an equivalent targeted search to locate candidates.
2. Inspect structure before content: headers, keys, exports, schema metadata,
   record counts, timestamps, or line-numbered matches. Prefer bounded slices
   around matches over full-file reads.
3. For large structured data, use a streaming or local parser to select fields,
   records, and summaries. Keep raw output bounded and preserve enough
   identifiers or line ranges to trace it back to the source.
4. Expand the window only when the current evidence leaves a concrete
   ambiguity. Search neighboring definitions and consumers rather than loading
   unrelated directories.
5. Deduplicate repeated output before passing it onward. Summaries may replace
   raw content only when the summary retains the evidence needed for the
   conclusion.
6. Read a whole file only when it is small, the format's semantics require
   global state, or targeted inspection has demonstrated that local slices are
   insufficient; even then, prefer streaming or temporary local analysis for
   very large inputs.
7. Report the search scope, filters, and any truncation in the handoff so a
   later session can continue without reloading the entire surface.

## Allowed Exceptions

Full reads are allowed when the user explicitly requests the complete content,
when a small file is the authoritative contract, or when cryptographic,
format-wide, or ordering checks genuinely require every byte or record. Keep
those reads outside prompt context when a local command can perform the check.

## Review Questions

- Did I search for concrete symbols, fields, headings, or event identifiers
  before loading a large surface?
- Are the selected slices and neighboring definitions sufficient to support the
  conclusion?
- Did any output include irrelevant or duplicated content that could have been
  filtered locally?
- Did I record the scope, parser, filters, and truncation boundaries?
- If I read everything, is there a concrete exception and a bounded alternative
  I considered?

## Non-Goals

- Do not replace required source review, tests, or verification with a shallow
  keyword match.
- Do not hide uncertainty caused by truncation or filtering.
- Do not impose a fixed line or token limit when the file format or user request
  requires a different bounded strategy.
- Do not rewrite project files merely to make them easier to search.
