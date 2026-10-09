// HARD-GATE 30 多 agent 协作协议 · 纯测试支撑模块
// -----------------------------------------------
// 本模块只操作 review spec 的普通 JSON 对象，是「协作语义」层的验证基准，
// 不进入运行时 bundle（运行时在 project/src/**）。与 project/src/lib/reviewSpec.ts
// 的 parseReviewSpec 互补：后者校验 schema 形状，本模块校验协作协议——ownership
// 归属、patch-only 边界、按 owner 裁剪上下文、冲突/lease 合并协议。
//
// 数据集：collaboration 清单（顶层可选字段，见 examples/collaboration-canvas-review.review.json）
// 协议语义（与 SKILL「多 agent 协作同一 HTML（HARD-GATE 30）」保持一致）：
// - 只改自己拥有（owner 是你当前 session）的 page / node；未声明内容按「无主」，先取得 ownership。
// - 只做 patch-only 变更：单一叶子最小 diff，不整页/整节点重写，不删改任何锚点。
// - 写修改需持有当前租约：leaseHolder 缺省从 spec.collaboration.lease.holder 读取（manifest 生效），
//   未持有租约不得提交；未声明租约（旧 spec）时退化到仅 ownership 门控。
// - 冲突一律重读 + 保留对方编辑 + patch 重试，绝不静默覆盖；跨 ownership 不合并。
//
// 所有函数纯函数式：返回新对象，不修改入参。

/** 深拷贝 spec（JSON 可序列化，无 undefined/函数）。 */
export const clone = (value) => JSON.parse(JSON.stringify(value));

/** collaboration 清单解析：pages/nodes 各自解析为 owner 映射。 */
export const parseManifest = (spec) => {
  const collab = spec?.collaboration ?? {};
  const pages = new Map();
  const nodes = new Map();
  for (const p of collab.pages ?? []) pages.set(p.pageId, p.owner);
  for (const n of collab.nodes ?? []) nodes.set(n.ref, n.owner);
  return { pages, nodes };
};

/**
 * 指定 ref 的 owner：先查 pages（pageId），再查 nodes（node/component id）。
 * 未声明返回 null（「无主」）。
 */
export const ownerOf = (spec, ref) => {
  const { pages, nodes } = parseManifest(spec);
  if (pages.has(ref)) return pages.get(ref);
  if (nodes.has(ref)) return nodes.get(ref);
  return null;
};

/** spec 中真实存在的全部 page id。 */
export const collectPageIds = (spec) =>
  new Set((spec.pages ?? []).map((p) => p.id));

/** spec 中真实存在的全部 node / component id。 */
export const collectNodeIds = (spec) => {
  const out = new Set();
  const walk = (node) => {
    out.add(node.id);
    for (const child of node.children ?? []) walk(child);
  };
  for (const comp of spec.components ?? []) walk(comp);
  return out;
};

/**
 * 校验 collaboration 清单不悬空：pageId 命中 pages，node ref 命中真实节点/组件。
 * 返回 { ok, dangling }；dangling 列出断链引用。
 */
export const validateOwnershipRefs = (spec) => {
  const collab = spec?.collaboration ?? {};
  const pageIds = collectPageIds(spec);
  const nodeIds = collectNodeIds(spec);
  const dangling = [];
  for (const p of collab.pages ?? [])
    if (!pageIds.has(p.pageId)) dangling.push(`page:${p.pageId}`);
  for (const n of collab.nodes ?? [])
    if (!nodeIds.has(n.ref)) dangling.push(`node:${n.ref}`);
  return { ok: dangling.length === 0, dangling };
};

/** 是否允许 agent 对 ref 发起写修改。 */
export const canPatchOwned = (spec, agent, ref) => {
  const owner = ownerOf(spec, ref);
  if (owner === null) return { ok: false, reason: "unowned" };
  if (owner !== agent) return { ok: false, reason: "foreign-owner" };
  return { ok: true, reason: "owned" };
};

/** 定位 ref 指向的对象，返回 { kind："page" | "node", node }；不存在返回 null。 */
export const locateRef = (spec, ref) => {
  const page = (spec.pages ?? []).find((p) => p.id === ref);
  if (page) return { kind: "page", node: page };
  const findIn = (root) => {
    if (root.id === ref) return root;
    for (const child of root.children ?? []) {
      const hit = findIn(child);
      if (hit) return hit;
    }
    return null;
  };
  for (const comp of spec.components ?? []) {
    const hit = findIn(comp);
    if (hit) return { kind: "node", node: hit };
  }
  return null;
};

/** 按 path 读取对象（如 ["mapping","0","change"]）。 */
export const getByPath = (obj, path) =>
  path.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);

/** 按 path 覆写，返回新对象（copy-on-write，只复制路径链）。 */
export const setByPath = (obj, path, value) => {
  if (path.length === 0) return value;
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  const [head, ...rest] = path;
  out[head] = setByPath(obj[head], rest, value);
  return out;
};

/** 整份 pageHtml 里 node/component/page 锚点清单（去重后排序），用于 patch-only 校验。 */
export const anchorInventory = (spec) => {
  const markup = (spec.pages ?? []).map((p) => p.pageHtml).join("\n");
  const tokens = (attr) => {
    const re = new RegExp(`${attr}=["']([^"']*)["']`, "g");
    const values = [];
    let m;
    while ((m = re.exec(markup)))
      values.push(...m[1].split(/\s+/).filter(Boolean));
    return [...new Set(values)].sort();
  };
  return {
    page: tokens("data-page-id"),
    node: tokens("data-review-node-id"),
    component: tokens("data-component-id"),
  };
};

const anchorKey = (inv) => JSON.stringify(inv);

/** 单个 node/page 的 owner 作用域摘要：只含自身字段，children 只记 id
 *  （无主子节点的内容变更不应计入其父 owner 的作用域）。 */
const digestNode = (node) =>
  JSON.stringify({
    ...node,
    children: (node.children ?? []).map((c) => c.id),
  });

/** 每个 declared owner 的作用域摘要：其 pages + 其 nodes 的对象摘要。 */
const ownerDigests = (spec) => {
  const { pages, nodes } = parseManifest(spec);
  const byOwner = new Map();
  const add = (owner, label, obj) => {
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push([label, digestNode(obj)]);
  };
  for (const p of spec.pages ?? []) {
    const owner = pages.get(p.id);
    if (owner !== undefined) add(owner, `page:${p.id}`, p);
  }
  const walk = (node) => {
    const owner = nodes.get(node.id);
    if (owner !== undefined) add(owner, `node:${node.id}`, node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const comp of spec.components ?? []) walk(comp);
  return byOwner;
};

/**
 * patch-only 验证（应用 patch 后调用）：
 * - 锚点清单不变（不删改 data-page-id / data-review-node-id / data-component-id）；
 * - 除发起者外，其余已声明 owner 的作用域摘要逐一不变（不跨 ownership 悄悄改动）。
 * 返回 { ok, anchorsKept, unchangedScopes, allForeignKept }。
 */
export const verifyPatchOnly = (baseSpec, patchedSpec, agent) => {
  const anchorsKept =
    anchorKey(anchorInventory(baseSpec)) ===
    anchorKey(anchorInventory(patchedSpec));
  const beforeDigests = ownerDigests(baseSpec);
  const afterDigests = ownerDigests(patchedSpec);
  const unchangedScopes = [];
  for (const [owner, before] of beforeDigests) {
    if (owner === agent) continue;
    const after = afterDigests.get(owner) ?? [];
    if (JSON.stringify(before) === JSON.stringify(after))
      unchangedScopes.push(owner);
  }
  const foreignCount = beforeDigests.size - (beforeDigests.has(agent) ? 1 : 0);
  const allForeignKept = unchangedScopes.length === foreignCount;
  return {
    ok: anchorsKept && allForeignKept,
    anchorsKept,
    unchangedScopes,
    allForeignKept,
  };
};

/**
 * 单条 patch：{ ref, path, value }，path 从 ref 定位到的对象内部导航。
 * 返回新 spec；不改入参。
 */
export const applyPatch = (spec, patch) => {
  const next = clone(spec);
  const located = locateRef(next, patch.ref);
  if (!located) throw new Error(`patch.ref 不存在: ${patch.ref}`);
  return locateAndReplace(next, located, patch);
};

/** 在定位对象上按 path 覆写，返回覆写后的 spec（替换承载容器里的对象）。 */
const locateAndReplace = (spec, located, patch) => {
  const rootArr = located.kind === "page" ? spec.pages : spec.components;
  const findIn = (containers) => {
    for (let i = 0; i < containers.length; i += 1) {
      if (containers[i] === located.node)
        return { parent: containers, index: i };
      const hit = findIn(containers[i].children ?? []);
      if (hit) return hit;
    }
    return null;
  };
  const found = findIn(rootArr);
  if (!found) throw new Error(`无法定位 ${patch.ref}`);
  const replaced = setByPath(
    found.parent[found.index],
    patch.path,
    patch.value,
  );
  found.parent[found.index] = replaced;
  return spec;
};

/**
 * manifest 租约 holder；未声明租约返回 null。
 */
export const resolveLeaseHolder = (spec) =>
  spec?.collaboration?.lease?.holder?.trim() || null;

/**
 * 显式取得/交接租约：更新 collaboration.lease.holder 与心跳，返回新 spec。
 * 交接模型：只有当前 holder 能提交写；多 owner 合入时逐段 acquire → 提交 → 交接。
 */
export const acquireLease = (
  spec,
  agent,
  heartbeatAt = new Date().toISOString(),
) => {
  const next = clone(spec);
  next.collaboration = {
    ...(next.collaboration ?? {}),
    schemaVersion: next.collaboration?.schemaVersion ?? 1,
    patchOnly: next.collaboration?.patchOnly ?? true,
    pages: next.collaboration?.pages ?? [],
    nodes: next.collaboration?.nodes ?? [],
    lease: { holder: agent, heartbeatAt },
  };
  return next;
};

/**
 * ownership + lease 门控的 patch：
 * - leaseHolder 传 null 时从 spec.collaboration.lease.holder 读取（manifest 生效）；
 *   解析出的 holder 非空且不等于 agent 时拒绝（no-lease）；manifest 无租约（旧 spec）
 *   则 lease 门控关闭，退化为仅 ownership 门控。
 * - 目标必须是 agent 自有；无主目标仅在持租约时可改，且自动登记 ownership；
 * - patch.ref 必须真实存在，否则稳定返回 conflict（unknown-ref），不抛异常。
 * - 应用后做 patch-only 验证（锚点不变 + 他人 scope 不变），不满足则拒绝并回滚。
 * 返回 { status, reason?, spec, ownershipRecorded?, patchOnly? }。
 */
export const patchOwned = (spec, agent, leaseHolder, patch) => {
  if (!locateRef(spec, patch.ref)) {
    return { status: "conflict", reason: "unknown-ref", spec };
  }
  const holder = leaseHolder === null ? resolveLeaseHolder(spec) : leaseHolder;
  if (holder !== null && holder !== agent) {
    return { status: "conflict", reason: "no-lease", spec };
  }
  const owner = ownerOf(spec, patch.ref);
  if (owner !== null && owner !== agent) {
    // 冲突：保留对方编辑，绝不静默覆盖。
    return { status: "conflict", reason: "foreign-owner", spec };
  }
  let base = spec;
  let ownershipRecorded = false;
  if (owner === null) {
    // 无主目标：登记 ownership 后按自有目标 patch（仅持租约者可做）。
    base = clone(spec);
    base.collaboration = {
      ...(base.collaboration ?? {}),
      schemaVersion: base.collaboration?.schemaVersion ?? 1,
      patchOnly: base.collaboration?.patchOnly ?? true,
      nodes: [
        ...(base.collaboration?.nodes ?? []),
        { ref: patch.ref, owner: agent },
      ],
      lease: base.collaboration?.lease,
    };
    ownershipRecorded = true;
  }
  const applied = applyPatch(base, patch);
  const verified = verifyPatchOnly(base, applied, agent);
  if (!verified.ok) {
    return { status: "rejected-not-patch-only", reason: verified, spec };
  }
  return {
    status: "ok",
    spec: applied,
    ownershipRecorded,
    patchOnly: verified,
  };
};

/**
 * 按 owner 裁剪上下文：只保留 agent 的 pages + 含其自有节点的组件子树，
 * 并同步裁剪 collaboration 清单为其自有 claims。裁剪结果仍应能通过
 * parseReviewSpec 与 render-review.mjs（独立渲染）。
 * 保留规则：根组件含 agent 自有节点才保留；自有节点的完整子树保留
 * （owner 对子树负责），且其祖先链保留。
 */
export const trimContextFor = (spec, agent) => {
  const { pages, nodes } = parseManifest(spec);
  const ownedPageIds = new Set(
    (spec.pages ?? [])
      .filter((p) => pages.get(p.id) === agent)
      .map((p) => p.id),
  );
  const hasOwnedDescendant = (node) =>
    nodes.get(node.id) === agent ||
    (node.children ?? []).some(hasOwnedDescendant);

  // 保留规则：节点本身被 agent 拥有、子树含被 agent 拥有的节点，或位于
  // agent 自有节点的子树内（insideOwned 继承标记）——自有节点的完整子树保留。
  const prune = (node, insideOwned = false) => {
    const owned = nodes.get(node.id) === agent;
    if (!owned && !insideOwned && !hasOwnedDescendant(node)) return null;
    const nextInside = insideOwned || owned;
    return {
      ...node,
      children: (node.children ?? [])
        .map((child) => prune(child, nextInside))
        .filter(Boolean),
    };
  };

  const components = [];
  for (const comp of spec.components ?? []) {
    const pruned = prune(comp);
    if (pruned) components.push(pruned);
  }

  // M2：跨页 ownership 不变量——保留「被保留节点锚点所在」的 page。
  // 仅按 ownership 保留页面时，owned 节点位于非自有页会让裁剪结果缺锚点、
  // 无法 parseReviewSpec；因此保留自有页 + 承载了任一保留节点 data-review-node-id
  // 锚点的非自有页（非自有页仅作只读上下文，不进入 collaboration.pages claims）。
  const requiredAnchors = new Set();
  const collectAnchors = (node) => {
    requiredAnchors.add(node.target || node.id);
    for (const child of node.children ?? []) collectAnchors(child);
  };
  for (const comp of components) collectAnchors(comp);
  const hostsRequiredAnchor = (page) => {
    const attrs = [
      ...page.pageHtml.matchAll(/data-review-node-id=["']([^"']*)["']/g),
    ].map((m) => m[1]);
    return attrs.some((a) => requiredAnchors.has(a));
  };
  const keptPages = (spec.pages ?? []).filter(
    (p) => ownedPageIds.has(p.id) || hostsRequiredAnchor(p),
  );

  const trimmed = {
    slug: spec.slug,
    title: spec.title,
    subtitle: spec.subtitle,
    pages: keptPages,
    components,
    overview: spec.overview,
    sourcePath: spec.sourcePath,
  };
  const contractIds = new Set();
  const collectContracts = (value) => {
    if (!value || typeof value !== "object") return;
    for (const id of value.api?.contractIds ?? []) contractIds.add(id);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(collectContracts);
      else if (child && typeof child === "object") collectContracts(child);
    }
  };
  collectContracts(trimmed);
  if (spec.apiContracts)
    trimmed.apiContracts = spec.apiContracts.filter((contract) =>
      contractIds.has(contract.id),
    );
  // Questions lack a machine-readable owner link; do not silently discard decisions.
  if (spec.openQuestions) trimmed.openQuestions = clone(spec.openQuestions);
  if (spec.collaboration !== undefined) {
    trimmed.collaboration = {
      schemaVersion: spec.collaboration.schemaVersion ?? 1,
      patchOnly: spec.collaboration.patchOnly ?? true,
      pages: (spec.collaboration.pages ?? []).filter((p) =>
        ownedPageIds.has(p.pageId),
      ),
      nodes: (spec.collaboration.nodes ?? []).filter(
        (n) => nodes.get(n.ref) === agent,
      ),
      lease: spec.collaboration.lease,
    };
  }
  return trimmed;
};

/**
 * 多 owner patch 顺序合入：逐条对「上一结果」patchOwned，leaseHolder 取
 * 当前 spec 的 collaboration.lease.holder（M1：lease 从 manifest 生效）——
 * 只有当前租约持有者能提交，非 holder 的 patch 记为 no-lease 冲突、保留对方
 * 编辑继续后续 patch。多 owner 合入由调用方用 acquireLease 逐段交接，
 * 符合「一次只有一个写会话」语义。返回 { spec, applied, conflicts }。
 */
export const mergeOwnerPatches = (spec, patches) => {
  let current = spec;
  const applied = [];
  const conflicts = [];
  for (const patch of patches) {
    const res = patchOwned(current, patch.agent, null, patch);
    if (res.status === "ok") {
      current = res.spec;
      applied.push({ ref: patch.ref, agent: patch.agent });
    } else {
      conflicts.push({
        ref: patch.ref,
        agent: patch.agent,
        reason: res.reason,
      });
      // 冲突：保留 current（含对方编辑），不应用本次 patch —— patch 重试交给调用方。
    }
  }
  return { spec: current, applied, conflicts };
};

/**
 * 租约合法性：holder 非空、heartbeatAt 为合法 ISO、holder 是已在清单声明的 owner。
 */
export const verifyLease = (spec) => {
  const lease = spec?.collaboration?.lease;
  if (!lease) return { ok: false, reason: "no-lease" };
  if (typeof lease.holder !== "string" || lease.holder.trim() === "")
    return { ok: false, reason: "empty-holder" };
  if (
    lease.heartbeatAt !== undefined &&
    Number.isNaN(Date.parse(lease.heartbeatAt))
  )
    return { ok: false, reason: "bad-heartbeat" };
  const { pages, nodes } = parseManifest(spec);
  const declaredOwners = new Set([...pages.values(), ...nodes.values()]);
  if (!declaredOwners.has(lease.holder))
    return { ok: false, reason: "holder-not-owner" };
  return { ok: true, reason: "ok" };
};
