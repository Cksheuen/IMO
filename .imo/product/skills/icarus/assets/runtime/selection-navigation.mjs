/** Optional surfaces adapt navigation; native HTML selection/comments never depend on them. */
export function createSelectionNavigation({
  root,
  source,
  showBox,
  hideBox,
  onChange,
}) {
  const adapters = new Map();
  let timer;
  const register = (id, host, adapter) => {
    if (
      typeof id !== "string" ||
      !host ||
      typeof adapter.capture !== "function" ||
      typeof adapter.restore !== "function"
    )
      throw Error("Invalid selection adapter");
    const registration = { host, adapter };
    adapters.set(id, registration);
    onChange?.();
    return () => {
      if (adapters.get(id) === registration) {
        adapters.delete(id);
        onChange?.();
      }
    };
  };
  return {
    register,
    context(element) {
      for (const [id, { host, adapter }] of adapters)
        if (host.contains(element))
          return { adapter: id, state: adapter.capture(element) };
    },
    matches(selection) {
      const context = selection.context;
      return context
        ? Boolean(
            adapters.get(context.adapter)?.adapter.matches?.(context.state),
          )
        : true;
    },
    async locate(selection, capturedSource) {
      if (capturedSource?.sha256 !== source.sha256)
        throw Error("来源已变化，保留原选区供核对；请新增当前版本的选区");
      let scope = root;
      if (selection.context) {
        const registered = adapters.get(selection.context.adapter);
        if (!registered) throw Error("对应模块未加载，重新加载后可定位");
        scope = await registered.adapter.restore(selection.context.state);
        if (!scope) throw Error("原页面或节点已不存在");
      }
      const targets = [];
      for (const anchor of selection.anchors ?? []) {
        try {
          if (scope.matches?.(anchor)) targets.push(scope);
          targets.push(...scope.querySelectorAll(anchor));
        } catch {}
      }
      const target = targets.find((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(el).visibility !== "hidden"
        );
      });
      if (!target) throw Error("原选区锚点已失效，请核对保存的选区文字");
      target.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      showBox(target.getBoundingClientRect());
      clearTimeout(timer);
      timer = setTimeout(hideBox, 1800);
    },
    destroy() {
      clearTimeout(timer);
      adapters.clear();
      hideBox();
    },
  };
}
