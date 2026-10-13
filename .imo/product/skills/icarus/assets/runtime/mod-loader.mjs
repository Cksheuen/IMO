/** Applies trusted local plans without replacing the HTML or comment kernel. */
export function connectMods(icarus, initial, service) {
  const lifetime = new AbortController();
  const modules = new Map();
  let active = [],
    revision = "",
    lastAttempt = "",
    busy = Promise.resolve(),
    destroyed = false,
    error = null;
  // Presentation is owned by the document. Diagnostics remain available to
  // the Agent through status(), retry() and the change event, without a badge.
  const emit = () => {
    window.dispatchEvent(
      new CustomEvent("icarus-mods-change", { detail: status() }),
    );
  };
  const status = () => ({
    revision,
    error,
    mods: active.map((x) => ({ id: x.spec.id, version: x.spec.version })),
    missing: initial.missing ?? [],
    warnings: initial.warnings ?? [],
  });
  const enqueue = (fn) => {
    const next = busy.then(fn);
    busy = next.catch(() => {});
    return next;
  };
  const removeAll = async () => {
    const errors = [];
    for (const item of [...active].reverse()) {
      try {
        await icarus.remove(item.spec.id);
      } catch (e) {
        errors.push(e);
      }
    }
    active = [];
    if (errors.length) throw new AggregateError(errors, "Mod cleanup failed");
  };
  const mount = async (items) => {
    for (const item of items) {
      await icarus.use(item.feature, item.options);
      active.push(item);
    }
  };
  const apply = (plan) =>
    enqueue(async () => {
      if (destroyed) return;
      if (
        plan?.schema !== "icarus-mod-plan/v1" ||
        !Array.isArray(plan.specs) ||
        !/^([a-f0-9]{64})$/.test(plan.revision)
      )
        throw new Error("Invalid local mod plan");
      if (plan.revision === revision) return;
      lastAttempt = plan.revision;
      try {
        const next = [];
        for (const spec of plan.specs) {
          if (
            !/^[a-z][a-z0-9-]*$/.test(spec.id) ||
            spec.apiVersion !== 1 ||
            !spec.url?.startsWith("data:text/javascript;base64,") ||
            !Array.isArray(spec.requires) ||
            spec.requires.some((id) => !next.some((x) => x.spec.id === id))
          )
            throw new Error("Invalid mod order / module URL");
          let code = new TextDecoder().decode(
            Uint8Array.from(atob(spec.url.split(",")[1]), (c) =>
              c.charCodeAt(0),
            ),
          );
          for (const ref of [...(spec.imports ?? [])].sort(
            (a, b) => b.start - a.start,
          )) {
            const dependency = next.find((x) => x.spec.id === ref.id);
            if (
              !dependency ||
              !spec.requires.includes(ref.id) ||
              !Number.isInteger(ref.start) ||
              ref.start < 0 ||
              !Number.isInteger(ref.end) ||
              ref.end <= ref.start ||
              ref.end > code.length ||
              !(
                ref.dynamic
                  ? [
                      JSON.stringify("icarus:" + ref.id),
                      "\'icarus:" + ref.id + "\'",
                    ]
                  : ["icarus:" + ref.id]
              ).includes(code.slice(ref.start, ref.end))
            )
              throw new Error("Invalid mod import reference");
            code =
              code.slice(0, ref.start) +
              (ref.dynamic
                ? JSON.stringify(dependency.moduleURL)
                : dependency.moduleURL) +
              code.slice(ref.end);
          }
          const key = code;
          let loaded = modules.get(key);
          if (!loaded) {
            const moduleURL = URL.createObjectURL(
              new Blob([code], { type: "text/javascript" }),
            );
            try {
              loaded = { moduleURL, namespace: await import(moduleURL) };
              modules.set(key, loaded);
            } catch (e) {
              URL.revokeObjectURL(moduleURL);
              throw e;
            }
          }
          const feature = loaded.namespace.default;
          if (
            feature?.id !== spec.id ||
            feature.apiVersion !== 1 ||
            typeof feature.mount !== "function" ||
            JSON.stringify(feature.requires ?? []) !==
              JSON.stringify(spec.requires)
          )
            throw new Error(
              `Mod ${spec.id} runtime contract differs from manifest`,
            );
          next.push({
            spec,
            moduleURL: loaded.moduleURL,
            feature,
            options: {
              ...spec.options,
              ...(window.icarusAdapters?.[spec.id] ?? {}),
            },
          });
        }
        const previous = [...active];
        const changed = new Set();
        for (const item of next) {
          const old = previous.find((x) => x.spec.id === item.spec.id);
          if (
            !old ||
            old.moduleURL !== item.moduleURL ||
            JSON.stringify(old.spec.options) !==
              JSON.stringify(item.spec.options) ||
            item.spec.requires.some((id) => changed.has(id))
          )
            changed.add(item.spec.id);
        }
        const removed = previous.filter(
          (item) =>
            !next.some((x) => x.spec.id === item.spec.id) ||
            changed.has(item.spec.id),
        );
        const added = [];
        const removeItems = async (items) => {
          for (const item of [...items].reverse()) {
            try {
              await icarus.remove(item.spec.id);
            } finally {
              active = active.filter((x) => x.spec.id !== item.spec.id);
            }
          }
        };
        try {
          await removeItems(removed);
          for (const item of next)
            if (changed.has(item.spec.id)) {
              await icarus.use(item.feature, item.options);
              active.push(item);
              added.push(item);
            }
          active = next.map((item) =>
            active.find((x) => x.spec.id === item.spec.id),
          );
        } catch (e) {
          try {
            await removeItems(added);
            for (const item of previous)
              if (!active.some((x) => x.spec.id === item.spec.id)) {
                await icarus.use(item.feature, item.options);
                active.push(item);
              }
            active = previous.map((item) =>
              active.find((x) => x.spec.id === item.spec.id),
            );
          } catch (rollback) {
            throw new AggregateError(
              [e, rollback],
              "Mod update and rollback failed",
            );
          }
          throw e;
        }
        revision = plan.revision;
        initial = plan;
        error = null;
        emit();
      } catch (e) {
        error = e.message;
        emit();
        throw e;
      }
    });
  const sync = async (force = false) => {
    const response = await fetch(
      `${service.baseUrl}/mods/${service.documentId}`,
      {
        headers: { Authorization: `Bearer ${service.token}` },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(5000)]),
      },
    );
    if (!response.ok)
      throw new Error(
        "Local service cannot provide mod plans; restart the Icarus service",
      );
    const plan = await response.json();
    if (plan && !destroyed && (force || plan.revision !== lastAttempt))
      await apply(plan);
    else if (plan?.revision === revision && error) {
      error = null;
      emit();
    }
  };
  const ready = apply(initial);
  let polling = false;
  const timer = setInterval(async () => {
    if (polling || destroyed) return;
    polling = true;
    try {
      await sync();
    } catch (e) {
      if (!destroyed) {
        error = e.message;
        emit();
      }
    } finally {
      polling = false;
    }
  }, 1500);
  return {
    ready,
    status,
    sync: () => sync(true),
    retry: () => sync(true),
    async destroy() {
      destroyed = true;
      clearInterval(timer);
      lifetime.abort();
      await busy;
      try {
        await removeAll();
      } finally {
        for (const item of modules.values())
          URL.revokeObjectURL(item.moduleURL);
        modules.clear();
      }
    },
  };
}
