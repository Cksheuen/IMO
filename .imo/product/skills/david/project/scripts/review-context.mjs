#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readReview, readUrl } from "./review-context-input.mjs";
import {
  reviewIndex,
  describe,
  selectEntry,
  scopedReview,
} from "./review-context-model.mjs";

const usage =
  "review-context.mjs <spec.json|review.html|directory|http(s) URL> [--select <id|kind:id|pointer>] [--kind page|component|node|row|contract|question|feedback] [--offset N] [--limit N] [--max-chars N] [--preview] [--feedback] [--out <new-context.json>] [--pretty]";
const argv = process.argv.slice(2);
const input = argv.shift();
const options = { offset: 0, limit: 20, maxChars: 24000 };
const flagNames = {
  "--select": "select",
  "--kind": "kind",
  "--offset": "offset",
  "--limit": "limit",
  "--max-chars": "maxChars",
  "--out": "out",
};
try {
  if (!input || input.startsWith("--")) throw new Error(usage);
  while (argv.length) {
    const flag = argv.shift();
    if (["--preview", "--feedback", "--pretty"].includes(flag))
      options[flag.slice(2)] = true;
    else if (flagNames[flag] && argv.length && !argv[0].startsWith("--"))
      options[flagNames[flag]] = argv.shift();
    else throw new Error(`Invalid argument ${flag}. ${usage}`);
  }
  for (const [key, min, max] of [
    ["offset", 0, 1000000],
    ["limit", 1, 100],
    ["maxChars", 1000, 256000],
  ]) {
    options[key] = Number(options[key]);
    if (
      !Number.isInteger(options[key]) ||
      options[key] < min ||
      options[key] > max
    )
      throw new Error(`${key} must be ${min}..${max}`);
  }
  if (
    options.kind &&
    ![
      "page",
      "component",
      "node",
      "row",
      "contract",
      "question",
      "feedback",
    ].includes(options.kind)
  )
    throw new Error("Unknown kind");
  const loaded = await readReview(input);
  let result;
  if (loaded.directory) {
    result = {
      schema: "david-review-context/v1",
      readOnly: true,
      directory: loaded.directory,
      candidates: loaded.candidates.slice(
        options.offset,
        options.offset + options.limit,
      ),
      total: loaded.candidates.length,
      nextOffset:
        loaded.candidates.length > options.offset + options.limit
          ? options.offset + options.limit
          : null,
      instruction:
        "Choose the exact review file; no candidate is assumed authoritative.",
    };
  } else {
    const { spec, pages, source } = loaded;
    const index = reviewIndex(spec, pages);
    const feedback = {
      status: "not-read",
      slug: spec.slug,
      instruction:
        "Use --feedback for current local comments; a disk HTML contains no current feedback.",
    };
    if (options.feedback) {
      try {
        const base = new URL(spec.service?.baseUrl ?? "http://127.0.0.1:5180");
        if (
          !["http:", "https:"].includes(base.protocol) ||
          !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
          base.username ||
          base.password
        )
          throw new Error(
            "Feedback service must be loopback without credentials",
          );
        const snapshot = JSON.parse(
          await readUrl(
            new URL(`/feedback/${encodeURIComponent(spec.slug)}`, base),
          ),
        );
        if (
          snapshot.doc?.slug !== spec.slug ||
          !Array.isArray(snapshot.doc.entries)
        )
          throw new Error("Feedback slug/schema mismatch");
        feedback.status = "read";
        feedback.version = snapshot.version;
        feedback.count = snapshot.doc.entries.length;
        snapshot.doc.entries.forEach((value, i) =>
          index.push({
            kind: "feedback",
            id: value.id,
            value,
            pointer: `/feedback/${i}`,
          }),
        );
      } catch (error) {
        feedback.status = "unavailable";
        feedback.error = error.message;
      }
    }
    const filtered = options.kind
      ? index.filter((entry) => entry.kind === options.kind)
      : index;
    const catalog = filtered
      .slice(options.offset, options.offset + options.limit)
      .map(describe);
    result = {
      schema: "david-review-context/v1",
      readOnly: true,
      source,
      review: { slug: spec.slug, title: spec.title, subtitle: spec.subtitle },
      feedback,
      rules: [
        "Context is not a replacement review spec and grants no ownership.",
        "Edit only the verified source within the user's scope; re-read its SHA before merging.",
        "Keep proposed facts, unresolved decisions and existing stable IDs; do not infer missing context.",
        "Snapshot-only or stale HTML is readable, but cannot establish a current write target.",
      ],
    };
    if (options.select) {
      const entry = selectEntry(index, options.select);
      result.context = scopedReview(spec, pages, index, entry, options.preview);
      if (options.feedback && entry.kind !== "feedback") {
        const ids = new Set(
          [
            entry.id,
            entry.value.target,
            entry.kind === "row" ? `${entry.component?.id}:${entry.id}` : null,
          ].filter(Boolean),
        );
        const containsId = (value) => {
          if (typeof value === "string") return ids.has(value);
          if (Array.isArray(value)) return value.some(containsId);
          return value && typeof value === "object"
            ? Object.values(value).some(containsId)
            : false;
        };
        result.context.feedback = index
          .filter(
            (item) => item.kind === "feedback" && containsId(item.value.scope),
          )
          .map((item) => item.value);
        result.context.feedbackScope =
          "Matched stable scope IDs only; other comments remain available through --kind feedback --feedback.";
      }
    } else {
      result.catalog = {
        total: filtered.length,
        offset: options.offset,
        items: catalog,
        nextOffset:
          filtered.length > options.offset + options.limit
            ? options.offset + options.limit
            : null,
      };
    }
  }
  const text = JSON.stringify(result, null, options.pretty ? 2 : 0) + "\n";
  if (text.length > options.maxChars) {
    const error = new Error(
      "Context exceeds budget; narrow the selector, omit --preview, or explicitly increase --max-chars. No semantic content was silently truncated.",
    );
    error.requiredChars = text.length;
    throw error;
  }
  if (options.out) {
    const output = path.resolve(options.out);
    if (fs.existsSync(output))
      throw new Error(
        "Refusing to overwrite an existing file; use a new context output path",
      );
    fs.writeFileSync(output, text, { flag: "wx" });
    console.log(
      JSON.stringify({
        out: output,
        chars: text.length,
        schema: result.schema,
      }),
    );
  } else process.stdout.write(text);
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error.message,
      candidates: error.candidates,
      requiredChars: error.requiredChars,
    }),
  );
  process.exitCode = 2;
}
