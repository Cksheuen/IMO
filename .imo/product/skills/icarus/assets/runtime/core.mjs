import { createCommentList } from "./comment-list.mjs";
import { createSelectionNavigation } from "./selection-navigation.mjs";
import { commentMarkup } from "./comment-ui.mjs";
import { modStorage } from "./mod-storage.mjs";
import { collectRegionText } from "./region-text.mjs";
import { createFeatureHost } from "./features.mjs";
import { createTransport } from "./transport.mjs";

export function mountIcarus({
  root = document.body,
  source = {},
  service,
} = {}) {
  if (document.querySelector("[data-icarus-ui]"))
    throw new Error("Icarus already mounted");
  const lifetime = new AbortController();
  const transport = createTransport(service, lifetime.signal);
  const listeners = new Set();
  const doc = { schema: "icarus-feedback/v1", source, entries: [] };
  let active = false,
    start = null,
    selected = null,
    destroyed = false,
    captureTarget = null;
  const ui = document.createElement("div");
  ui.dataset.icarusUi = "";
  ui.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;pointer-events:none";
  const shadow = ui.attachShadow({ mode: "open" });
  shadow.innerHTML = commentMarkup;
  document.body.append(ui);
  const $ = (s) => shadow.querySelector(s);
  const priorSpace = document.body.style.getPropertyValue(
    "--icarus-comment-space",
  );
  const priorSpacePriority = document.body.style.getPropertyPriority(
    "--icarus-comment-space",
  );
  const setPanel = (open, remember = true) => {
    if (remember)
      try {
        sessionStorage.setItem(
          `icarus:${service.documentId}:rail`,
          String(open),
        );
      } catch {}
    $("#panel").hidden = !open;
    $("#composer").hidden = !selected;
    $("#comments").setAttribute("aria-expanded", String(open));
    document.body.style.setProperty(
      "--icarus-comment-space",
      open ? "332px" : "0px",
    );
  };
  const getDocument = () => structuredClone(doc);
  const announce = () => {
    for (const fn of listeners) {
      try {
        fn(getDocument());
      } catch (error) {
        console.error(error);
      }
    }
  };
  const pathFor = (element) => {
    const attrs = [
      "data-icarus-anchor",
      "data-review-target",
      "data-review-node-id",
      "data-component-id",
      "data-api-field",
      "data-trd-row",
      "data-david-row-id",
      "id",
    ];
    for (let el = element; el && el !== root; el = el.parentElement) {
      for (const attr of attrs)
        if (el.hasAttribute(attr))
          return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    }
    const parts = [];
    for (
      let el = element;
      el && el !== root && parts.length < 12;
      el = el.parentElement
    ) {
      if (!el.parentElement) break;
      parts.unshift(
        `${el.localName}:nth-child(${[...el.parentElement.children].indexOf(el) + 1})`,
      );
    }
    return parts.join(" > ");
  };
  const navigation = createSelectionNavigation({
    root,
    source,
    showBox: (rect) => showBox(rect),
    hideBox: () => {
      $("#box").style.display = "none";
    },
    onChange: () =>
      queueMicrotask(() => {
        if (!destroyed) render();
      }),
  });
  const capture = (rect) => {
    const anchors = new Set();
    let context;
    const region = collectRegionText(rect, root, (el) => {
      if (anchors.size < 32) anchors.add(pathFor(el));
      context ??= navigation.context(el);
    });
    return {
      kind: "region",
      rect,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      ...region,
      anchors: [...anchors],
      capturedAt: new Date().toISOString(),
      ...(context ? { context } : {}),
    };
  };
  let processing = { inputs: {}, tasks: {} };
  const list = createCommentList({
    getProcessing: () => processing,
    shadow,
    getDocument,
    update: (id, patch) =>
      write(async () => apply(await transport.update(id, patch))),
    reply: (id, reply) =>
      write(async () => apply(await transport.reply(id, reply))),
    append: (id) => {
      list.expand(id);
      setActive(true, id);
    },
    locate: (selection, capturedSource) =>
      navigation.locate(selection, capturedSource),
    matchesScene: (selection) => navigation.matches(selection),
    storageKey: `icarus:${service.documentId}:comment-drafts`,
  });
  const render = () => list.render();
  let pending = null;
  let writeQueue = Promise.resolve();
  const write = (fn) => {
    const next = writeQueue.then(fn);
    writeQueue = next.catch(() => {});
    return next;
  };
  let firstRead = true;
  const apply = (next) => {
    if (destroyed) return;
    const changed =
      JSON.stringify(doc.entries) !== JSON.stringify(next.entries);
    doc.entries = next.entries;
    doc.source = next.source;
    if (firstRead) {
      firstRead = false;
      let preference;
      try {
        preference = sessionStorage.getItem(
          `icarus:${service.documentId}:rail`,
        );
      } catch {}
      if (!active)
        setPanel(
          preference === null ? next.entries.length > 0 : preference === "true",
          false,
        );
    }
    if (changed) {
      render();
      announce();
    }
  };
  const connected = (online) => {
    $("#connection").textContent = online ? "本机已连接" : "重试连接";
    $("#connection").dataset.state = online ? "online" : "offline";
  };
  const refresh = async () => {
    try {
      const next = await transport.read();
      apply(next);
      const tasks = await transport.tasks();
      if (!destroyed && JSON.stringify(tasks) !== JSON.stringify(processing)) {
        processing = tasks;
        render();
      }
      if (!destroyed) {
        connected(true);
        return true;
      }
    } catch (error) {
      if (!destroyed) {
        connected(false);
        if (
          processing.batch?.state === "running" &&
          processing.batch.leaseUntil <= Date.now()
        )
          processing.batch.state = "failed";
        for (const task of Object.values(processing.tasks))
          if (task.state === "running" && task.leaseUntil <= Date.now()) {
            task.state = "failed";
            task.message = "Agent 认领已超时，可重新排队";
            render();
          }
        $("#status").textContent = "本机服务不可用；新评论未保存，草稿已保留。";
      }
    }
    return false;
  };
  const comment = (body, selection = selected) => {
    const selectedCopy = structuredClone(selection);
    const next = writeQueue.then(async () => {
      if (destroyed) throw new Error("Icarus destroyed");
      if (
        typeof body !== "string" ||
        !body.trim() ||
        body.length > 4000 ||
        !selectedCopy
      )
        throw new Error("请先框选并输入 1–4000 字的评论");
      const key = JSON.stringify([body.trim(), selectedCopy]);
      if (!pending || pending.key !== key)
        pending = {
          key,
          entry: {
            id: crypto.randomUUID(),
            comment: body.trim(),
            selection: selectedCopy,
            source: structuredClone(source),
            status: "open",
            createdAt: new Date().toISOString(),
          },
        };
      saveDraft();
      const entry = pending.entry;
      try {
        const saved = await transport.add(entry);
        apply(saved);
        if (!destroyed) connected(true);
        pending = null;
        saveDraft();
        return structuredClone(saved.entries.find((e) => e.id === entry.id));
      } catch (error) {
        if (!destroyed) connected(false);
        throw error;
      }
    });
    writeQueue = next.catch(() => {});
    return next;
  };
  const setActive = (value, target = null) => {
    captureTarget = value ? target : null;
    active = value;
    ui.dataset.icarusSelecting = String(value);
    start = null;
    $("#capture").setAttribute("aria-pressed", String(value));
    $("#capture").textContent = value ? "拖动框选 · Esc 取消" : "框选评论";
    $("#box").style.display = "none";
    if (value) setPanel(false, false);
  };
  const isUI = (event) => event.composedPath().includes(ui);
  const on = (target, type, listener, options = {}) =>
    target.addEventListener(type, listener, {
      ...options,
      signal: lifetime.signal,
    });
  on($("#capture"), "click", () => setActive(!active));
  on($("#comments"), "click", () => {
    setActive(false);
    setPanel($("#panel").hidden);
  });
  on($("#close"), "click", () => {
    setPanel(false);
    $("#box").style.display = "none";
  });
  on($("#save"), "click", async () => {
    const body = $("textarea").value;
    const current = selected;
    $("#save").disabled = true;
    $("#status").textContent = "正在保存到本机…";
    try {
      await comment(body, current);
      if ($("textarea").value === body && selected === current) {
        $("textarea").value = "";
        saveDraft();
      }
      selected = null;
      setPanel(true);
      saveDraft();
      $("#status").textContent = "已保存到本机，Agent 可直接读取。";
    } catch (error) {
      $("#status").textContent =
        `未确认保存：${error.message}。草稿已保留，可重试。`;
    } finally {
      $("#save").disabled = false;
    }
  });
  on($("#connection"), "click", refresh);
  on($("#export"), "click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(getDocument(), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "icarus-feedback.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  on(
    document,
    "pointerdown",
    (event) => {
      if (!active || event.button !== 0 || isUI(event)) return;
      suppressClick = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    },
    { capture: true },
  );
  const rectAt = (event) => ({
    x: Math.min(start.x, event.clientX),
    y: Math.min(start.y, event.clientY),
    width: Math.abs(start.x - event.clientX),
    height: Math.abs(start.y - event.clientY),
  });
  const showBox = (rect) =>
    Object.assign($("#box").style, {
      display: "block",
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  on(
    document,
    "pointermove",
    (event) => {
      if (!start || event.pointerId !== start.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showBox(rectAt(event));
    },
    { capture: true },
  );
  on(
    document,
    "pointerup",
    (event) => {
      if (!start || event.pointerId !== start.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = rectAt(event),
        target = captureTarget;
      const captured =
        rect.width >= 3 && rect.height >= 3 ? capture(rect) : null;
      setActive(false);
      if (!captured) {
        if (target) setPanel(true);
        return;
      }
      if (target) {
        setPanel(true);
        void list.addSelection(target, captured, structuredClone(source));
        return;
      }
      selected = captured;
      $("#quote").textContent =
        selected.text || "该区域没有可提取的 DOM 文字。";
      $("#meta").textContent =
        `${selected.text.length} 字符${selected.truncated ? " · 已截断，请缩小选区" : ""} · ${selected.anchors.length} 个锚点`;
      setPanel(true);
      $("textarea").focus();
      saveDraft();
    },
    { capture: true },
  );
  // Suppress the synthetic click following a captured gesture only.
  let suppressClick = false;
  on(
    document,
    "pointerdown",
    () => {
      suppressClick = active;
    },
    { capture: true },
  );
  on(
    document,
    "click",
    (event) => {
      if (suppressClick && !isUI(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      suppressClick = false;
    },
    { capture: true },
  );
  on(document, "keydown", (event) => {
    if (event.key === "Escape") {
      const target = captureTarget;
      setActive(false);
      if (target) setPanel(true);
    }
  });
  for (const type of ["blur", "resize", "scroll", "pointercancel"])
    on(
      window,
      type,
      () => {
        const target = captureTarget;
        setActive(false);
        if (target) setPanel(true);
      },
      { capture: true },
    );
  const draftKey = `icarus:${service.documentId}:draft`;
  const saveDraft = () => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          body: $("textarea").value,
          selection: selected,
          sourceHash: source.sha256,
          pending,
        }),
      );
    } catch {}
  };
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) || "null");
    if (draft?.sourceHash === source.sha256 && typeof draft.body === "string") {
      $("textarea").value = draft.body;
      selected = draft.selection;
      if (draft.pending?.entry?.source?.sha256 === source.sha256)
        pending = draft.pending;
      $("#quote").textContent = selected?.text || "";
    }
  } catch {}
  on($("textarea"), "input", saveDraft);
  let refreshing = false;
  const poll = async () => {
    if (refreshing || destroyed) return;
    refreshing = true;
    try {
      await refresh();
    } finally {
      refreshing = false;
    }
  };
  render();
  const ready = refresh();
  const timer = setInterval(poll, 2000);
  let presentationClaims = 0;
  const nativeChannel = {
    baseUrl: `${service.baseUrl}/david/${service.documentId}`,
    async request(suffix, init = {}) {
      if (
        typeof suffix !== "string" ||
        !/^\/(health|feedback|materials)(\/|$)/.test(suffix) ||
        suffix.includes("..")
      )
        throw Error("Invalid David channel request");
      const response = await fetch(
        `${service.baseUrl}/david/${service.documentId}${suffix}`,
        {
          method: init.method ?? "GET",
          body: init.body,
          headers: {
            Authorization: `Bearer ${service.token}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
          },
          signal: AbortSignal.any(
            [lifetime.signal, init.signal, AbortSignal.timeout(10000)].filter(
              Boolean,
            ),
          ),
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        },
      );
      if (response.ok && init.method && init.method !== "GET") void refresh();
      return { status: response.status, body: await response.text() };
    },
    present() {
      presentationClaims++;
      setActive(false);
      ui.hidden = true;
      const priorOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.style.setProperty("--icarus-comment-space", "0px");
      return () => {
        presentationClaims--;
        if (!presentationClaims) {
          ui.hidden = false;
          document.body.style.overflow = priorOverflow;
          setPanel(!$("#panel").hidden, false);
          void refresh();
        }
      };
    },
  };
  const features = createFeatureHost({
    root,
    documentId: service.documentId,
    createStorage: (id, signal) => modStorage(service, id, signal),
    getDocument,
    selection: { register: navigation.register },
    david: nativeChannel,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
  return {
    getDocument,
    capture,
    comment,
    ready,
    refresh,
    use: features.use,
    remove: features.remove,
    listFeatures: features.list,
    async destroy() {
      destroyed = true;
      clearInterval(timer);
      lifetime.abort();
      try {
        await features.destroy();
      } finally {
        navigation.destroy();
        listeners.clear();
        if (priorSpace)
          document.body.style.setProperty(
            "--icarus-comment-space",
            priorSpace,
            priorSpacePriority,
          );
        else document.body.style.removeProperty("--icarus-comment-space");
        ui.remove();
      }
    },
  };
}
