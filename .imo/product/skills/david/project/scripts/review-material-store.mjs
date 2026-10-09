import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  assertMaterialGroup,
  assertMaterialInput,
  parseMaterialDocument,
  MATERIAL_IMAGE_LIMIT,
  MATERIAL_CSS_LIMIT,
} from "../src/lib/reviewMaterials.ts";
const sameGroup = (a, b) =>
  a.id === b.id && a.label === b.label && a.pageId === b.pageId;
const fail = (message, status = 422) => {
  throw Object.assign(new Error(message), { httpStatus: status });
};
const safeSlug = (slug) =>
  typeof slug === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug);
export function createMaterialStore(root) {
  const dir = (slug) => {
    if (!safeSlug(slug)) fail("非法资料 slug", 400);
    return path.join(root, slug);
  };
  const index = (slug) => path.join(dir(slug), "index.json");
  const read = (slug) =>
    fs.existsSync(index(slug))
      ? parseMaterialDocument(JSON.parse(fs.readFileSync(index(slug), "utf8")))
      : {
          schema: "david-materials/v1",
          slug,
          version: 0,
          groups: [],
          items: [],
        };
  const atomic = (file, bytes) => {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  };
  const save = (doc) => {
    parseMaterialDocument(doc);
    fs.mkdirSync(dir(doc.slug), { recursive: true });
    atomic(index(doc.slug), JSON.stringify(doc, null, 2));
    return doc;
  };
  const version = (doc, expected) => {
    if (!Number.isSafeInteger(expected)) fail("需要 expectedVersion", 400);
    if (doc.version !== expected) fail("设计资料已变化，请刷新后重试", 409);
  };
  const addGroup = (slug, group, expected) => {
    assertMaterialGroup(group);
    const doc = read(slug);
    const existing = doc.groups.find((g) => g.id === group.id);
    if (existing) {
      if (!sameGroup(existing, group)) fail("资料分组 id 冲突", 409);
      return doc;
    }
    version(doc, expected);
    return save({
      ...doc,
      version: doc.version + 1,
      groups: [...doc.groups, group],
    });
  };
  const add = (slug, input, expected) => {
    assertMaterialInput(input);
    const doc = read(slug);
    let bytes;
    if (input.kind === "css") bytes = Buffer.from(input.content, "utf8");
    else {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        input.content,
      );
      if (!match) fail("请选择 PNG 截图");
      bytes = Buffer.from(match[1], "base64");
      if (
        bytes.length < 33 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.subarray(12, 16).toString() !== "IHDR" ||
        !bytes.readUInt32BE(16) ||
        !bytes.readUInt32BE(20) ||
        bytes.readUInt32BE(16) > 30000 ||
        bytes.readUInt32BE(20) > 30000
      )
        fail("PNG 内容无效");
    }
    if (
      bytes.length >
      (input.kind === "png" ? MATERIAL_IMAGE_LIMIT : MATERIAL_CSS_LIMIT)
    )
      fail("资料超过大小限制", 413);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const existing = doc.items.find((i) => i.id === input.id);
    if (existing) {
      if (
        existing.sha256 !== sha256 ||
        existing.title !== input.title ||
        existing.groupId !== input.group.id ||
        existing.sourceRef !== input.sourceRef
      )
        fail("资料 id 已存在且内容不同", 409);
      return doc;
    }
    version(doc, expected);
    const group = doc.groups.find((g) => g.id === input.group.id);
    if (group && !sameGroup(group, input.group))
      fail("资料分组信息已变化", 409);
    const item = {
      id: input.id,
      groupId: input.group.id,
      title: input.title,
      kind: input.kind,
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      fileName: `${input.id}.${input.kind}`,
      bytes: bytes.length,
      sha256,
      createdAt: new Date().toISOString(),
    };
    const next = {
      ...doc,
      version: doc.version + 1,
      groups: group ? doc.groups : [...doc.groups, input.group],
      items: [...doc.items, item],
    };
    parseMaterialDocument(next);
    fs.mkdirSync(dir(slug), { recursive: true });
    atomic(path.join(dir(slug), item.fileName), bytes);
    return save(next);
  };
  const content = (slug, id) => {
    const item = read(slug).items.find((i) => i.id === id);
    if (!item) fail("设计资料不存在", 404);
    const localPath = path.join(dir(slug), item.fileName);
    const bytes = fs.readFileSync(localPath);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== item.sha256)
      fail("设计资料文件与索引不一致");
    return {
      item,
      localPath,
      content:
        item.kind === "png"
          ? `data:image/png;base64,${bytes.toString("base64")}`
          : bytes.toString("utf8"),
    };
  };
  return { read, addGroup, add, content };
}
