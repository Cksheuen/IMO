#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const [command, slug, ...rest] = process.argv.slice(2);
const help =
  "Usage: david-materials-cli.mjs list <slug> [--page <id>] | get <slug> <materialId> | import <slug> --page <id> --page-label <label> --title <name> --file <path> [--source <reference>]";
const option = (name) => {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : undefined;
};
const base = `http://127.0.0.1:${Number(process.env.DAVID_FEEDBACK_PORT || 5180)}`;
const request = async (method, url, body) => {
  const response = await fetch(base + url, {
    method,
    redirect: "error",
    credentials: "omit",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error}`);
  return data;
};
try {
  if (!slug || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug))
    throw new Error(help);
  const endpoint = `/materials/${encodeURIComponent(slug)}`;
  if (command === "list") {
    const doc = await request("GET", endpoint);
    const page = option("--page");
    if (page) {
      doc.groups = doc.groups.filter((g) => g.pageId === page);
      doc.items = doc.items.filter((item) =>
        doc.groups.some((g) => g.id === item.groupId),
      );
    }
    console.log(JSON.stringify(doc, null, 2));
  } else if (command === "get") {
    if (!rest[0]) throw new Error(help);
    const data = await request(
      "GET",
      `${endpoint}/${encodeURIComponent(rest[0])}/content`,
    );
    console.log(
      JSON.stringify({ item: data.item, localPath: data.localPath }, null, 2),
    );
  } else if (command === "import") {
    const file = option("--file"),
      pageId = option("--page"),
      label = option("--page-label"),
      title = option("--title");
    if (!file || !pageId || !label || !title) throw new Error(help);
    const source = option("--source") || path.resolve(file);
    const bytes = fs.readFileSync(file);
    const kind = path.extname(file).slice(1).toLowerCase();
    if (!["png", "css"].includes(kind))
      throw new Error("Only PNG and CSS are supported");
    const doc = await request("GET", endpoint);
    const group = doc.groups.find((g) => g.pageId === pageId) || {
      id: `page:${pageId}`,
      label,
      pageId,
    };
    const content =
      kind === "png"
        ? `data:image/png;base64,${bytes.toString("base64")}`
        : bytes.toString("utf8");
    const id = `material-${crypto.createHash("sha256").update(JSON.stringify({ group, title, source, kind, content })).digest("hex").slice(0, 24)}`;
    const saved = await request("POST", `${endpoint}/items`, {
      expectedVersion: doc.version,
      material: { id, group, title, sourceRef: source, kind, content },
    });
    const reread = await request("GET", `${endpoint}/${id}/content`);
    const verified =
      reread.item.sha256 ===
      crypto.createHash("sha256").update(bytes).digest("hex");
    if (!verified) throw new Error("Material verification failed");
    console.log(
      JSON.stringify(
        { id, version: saved.version, verified, localPath: reread.localPath },
        null,
        2,
      ),
    );
  } else throw new Error(help);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
