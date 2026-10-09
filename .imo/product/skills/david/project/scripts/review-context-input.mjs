import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseReviewSpec } from "../src/lib/reviewSpec.ts";
import { embeddedJson } from "./review-context-html.mjs";

const MAX_BYTES = 32 * 1024 * 1024;
export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const boundedFile = (file) => {
  if (!fs.statSync(file).isFile())
    throw new Error("Input must be a regular file");
  if (fs.statSync(file).size > MAX_BYTES)
    throw new Error("Input exceeds 32 MiB");
  return fs.readFileSync(file, "utf8");
};

export async function readUrl(url) {
  const response = await fetch(url, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("Response exceeds 32 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readReview(input) {
  const remote = /^https?:\/\//i.test(input);
  const file = remote
    ? null
    : fs.realpathSync(
        input.startsWith("file:") ? fileURLToPath(input) : path.resolve(input),
      );
  if (file && fs.statSync(file).isDirectory()) {
    const candidates = fs
      .readdirSync(file)
      .filter((name) => /\.(json|html?)$/i.test(name))
      .sort()
      .map((name) => ({ path: path.join(file, name) }));
    return { directory: file, candidates };
  }
  const raw = remote ? await readUrl(input) : boundedFile(file);
  const isJson = remote
    ? new URL(input).pathname.toLowerCase().endsWith(".json")
    : path.extname(file).toLowerCase() === ".json";
  const spec = isJson ? JSON.parse(raw) : embeddedJson(raw, "review-data");
  const parsed = parseReviewSpec(spec);
  const receipt = isJson
    ? null
    : embeddedJson(raw, "david-review-source", false);
  const source = {
    input: file ?? input,
    kind: isJson ? "json" : "embedded-json",
    inputSha256: sha256(raw),
    status: !remote && isJson ? "direct-source" : "snapshot-only",
    reviewPath: !remote && isJson ? file : null,
    reviewSha256: !remote && isJson ? sha256(raw) : null,
    evidencePath: spec.sourcePath ?? null,
  };
  // A received HTML/URL must not cause arbitrary local file reads. Only a local,
  // adjacent renderer receipt is followed, with digest + slug verification.
  if (
    !remote &&
    receipt?.schema === "david-review-source/v1" &&
    typeof receipt.relativePath === "string" &&
    receipt.dataSha256 === sha256(JSON.stringify(spec))
  ) {
    const base = path.dirname(file);
    const candidate = path.resolve(base, receipt.relativePath);
    const within = (p) => p.startsWith(base + path.sep);
    source.declaredReview = receipt.relativePath;
    if (within(candidate) && fs.existsSync(candidate)) {
      const real = fs.realpathSync(candidate);
      if (within(real) && path.extname(real) === ".json") {
        const content = boundedFile(real);
        if (sha256(content) === receipt.sha256) {
          const current = JSON.parse(content);
          parseReviewSpec(current);
          if ((current.slug || path.basename(real, ".json")) === spec.slug) {
            source.status = "verified-source";
            source.reviewPath = real;
            source.reviewSha256 = receipt.sha256;
            return {
              spec: current,
              pages: parseReviewSpec(current).pages,
              source,
            };
          }
        } else source.status = "stale-snapshot";
      }
    }
  }
  return { spec, pages: parsed.pages, source };
}
