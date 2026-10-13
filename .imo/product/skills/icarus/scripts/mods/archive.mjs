import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import tar from "tar-stream";
import { zipSync, unzipSync } from "fflate";
import { safePath, MAX_BYTES } from "./manifest.mjs";
export function packZip(mod, output) {
  const entries = Object.fromEntries(
    [...mod.files].map(([name, data]) => [
      `${mod.manifest.id}/${name}`,
      new Uint8Array(data),
    ]),
  );
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, zipSync(entries, { level: 9 }));
  return path.resolve(output);
}
const finderMetadata = (name) =>
  name.startsWith("__MACOSX/") ||
  name === "__MACOSX" ||
  name.split("/").at(-1) === ".DS_Store";
function inspectZip(raw) {
  let end = -1;
  for (let i = raw.length - 22; i >= Math.max(0, raw.length - 65557); i--)
    if (raw.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("Invalid ZIP directory");
  const count = raw.readUInt16LE(end + 10);
  let at = raw.readUInt32LE(end + 16),
    size = 0;
  const seen = new Set();
  if (
    count > 260 ||
    raw.readUInt16LE(end + 4) !== 0 ||
    raw.readUInt16LE(end + 6) !== 0
  )
    throw new Error("ZIP limits / multi-volume archives unsupported");
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || raw.readUInt32LE(at) !== 0x02014b50)
      throw new Error("Invalid ZIP member");
    const n = raw.readUInt16LE(at + 28),
      extra = raw.readUInt16LE(at + 30),
      comment = raw.readUInt16LE(at + 32),
      mode = raw.readUInt32LE(at + 38) >>> 16;
    if (at + 46 + n + extra + comment > end)
      throw new Error("Invalid ZIP member length");
    const name = raw.subarray(at + 46, at + 46 + n).toString("utf8");
    if (!finderMetadata(name.replace(/\/$/, "")))
      safePath(name.replace(/\/$/, ""));
    if (seen.has(name)) throw new Error("Duplicate ZIP member");
    seen.add(name);
    if (
      (mode & 0xf000) !== 0 &&
      (mode & 0xf000) !== 0x8000 &&
      (mode & 0xf000) !== 0x4000
    )
      throw new Error("ZIP links and special files are forbidden");
    size += raw.readUInt32LE(at + 24);
    if (size > MAX_BYTES) throw new Error("Expanded ZIP exceeds limit");
    at += 46 + n + extra + comment;
  }
}
export async function unpack(archive, dest) {
  if (fs.statSync(archive).size > MAX_BYTES * 2)
    throw new Error("Archive too large");
  const raw = fs.readFileSync(archive),
    entries = new Map();
  let total = 0;
  const add = (name, bytes) => {
    safePath(name);
    total += bytes.length;
    if (total > MAX_BYTES || entries.size >= 130 || entries.has(name))
      throw new Error("Archive limits or duplicate entries");
    entries.set(name, Buffer.from(bytes));
  };
  if (/\.zip$/i.test(archive)) {
    inspectZip(raw);
    let advertised = 0;
    const values = unzipSync(raw, {
      filter: (file) => {
        const name = file.name.replace(/\/$/, "");
        if (!finderMetadata(name)) safePath(name);
        advertised += file.originalSize;
        if (advertised > MAX_BYTES)
          throw new Error("Expanded ZIP exceeds limit");
        return !finderMetadata(name) && !file.name.endsWith("/");
      },
    });
    for (const [name, bytes] of Object.entries(values)) add(name, bytes);
  } else if (/\.(tgz|tar\.gz)$/i.test(archive)) {
    const bytes = zlib.gunzipSync(raw, { maxOutputLength: MAX_BYTES * 2 });
    await new Promise((resolve, reject) => {
      const extract = tar.extract();
      extract.on("error", reject);
      extract.on("finish", resolve);
      extract.on("entry", (header, stream, next) => {
        try {
          safePath(header.name.replace(/\/$/, ""));
          if (!["file", "directory"].includes(header.type))
            throw new Error("Archive links and special files are forbidden");
          if (header.size > MAX_BYTES) throw new Error("Oversized tar entry");
        } catch (e) {
          extract.destroy(e);
          stream.resume();
          return;
        }
        const chunks = [];
        stream.on("data", (b) => chunks.push(b));
        stream.on("error", reject);
        stream.on("end", () => {
          try {
            if (header.type === "file") add(header.name, Buffer.concat(chunks));
            next();
          } catch (e) {
            extract.destroy(e);
          }
        });
        stream.resume();
      });
      extract.end(bytes);
    });
  } else throw new Error("Expected .zip or .tgz");
  const manifests = [...entries.keys()].filter(
    (n) => n === "mod.json" || n.endsWith("/mod.json"),
  );
  if (manifests.length !== 1)
    throw new Error("Archive must contain exactly one mod.json");
  const prefix = manifests[0].slice(0, -"mod.json".length);
  for (const [name, bytes] of entries) {
    if (!name.startsWith(prefix)) throw new Error("Files outside mod folder");
    const rel = safePath(name.slice(prefix.length));
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes, { flag: "wx" });
  }
}
