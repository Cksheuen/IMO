/** Trusted, locally bundled features only. JSON never contains executable code. */
export function createFeatureHost(base) {
  const active = new Map();
  let closed = false;
  let queue = Promise.resolve();
  const serialize = (task) => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };
  const dispose = async (entry) => {
    entry.abort.abort();
    const errors = [];
    for (const cleanup of entry.cleanup.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Feature cleanup failed");
  };
  return {
    list: () => [...active.keys()],
    use: (feature, options = {}) =>
      serialize(async () => {
        if (closed) throw new Error("Feature host destroyed");
        if (
          !feature ||
          feature.apiVersion !== 1 ||
          !/^[a-z][a-z0-9-]*$/.test(feature.id) ||
          typeof feature.mount !== "function"
        )
          throw new Error("Invalid feature contract");
        if (active.has(feature.id))
          throw new Error(`Already mounted: ${feature.id}`);
        const requires = feature.requires ?? [];
        if (!Array.isArray(requires) || requires.some((id) => !active.has(id)))
          throw new Error(`Missing dependencies: ${requires}`);
        const entry = {
          abort: new AbortController(),
          cleanup: [],
          requires: [...requires],
        };
        try {
          const cleanup = await feature.mount(
            Object.freeze({
              ...base,
              storage: base.createStorage?.(feature.id, entry.abort.signal),
              signal: entry.abort.signal,
              onCleanup: (fn) => {
                if (typeof fn !== "function")
                  throw new Error("cleanup must be a function");
                entry.cleanup.push(fn);
              },
            }),
            options,
          );
          if (cleanup !== undefined) {
            if (typeof cleanup !== "function")
              throw new Error("mount must return a disposer");
            entry.cleanup.push(cleanup);
          }
          active.set(feature.id, entry);
        } catch (error) {
          try {
            await dispose(entry);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Mount and rollback failed",
            );
          }
          throw error;
        }
      }),
    remove: (id) =>
      serialize(async () => {
        for (const [name, entry] of active)
          if (entry.requires.includes(id))
            throw new Error(`${id} required by ${name}`);
        const entry = active.get(id);
        if (!entry) return;
        active.delete(id);
        await dispose(entry);
      }),
    destroy: () =>
      serialize(async () => {
        closed = true;
        const errors = [];
        for (const [id, entry] of [...active].reverse()) {
          active.delete(id);
          try {
            await dispose(entry);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length)
          throw new AggregateError(errors, "Feature cleanup failed");
      }),
  };
}
