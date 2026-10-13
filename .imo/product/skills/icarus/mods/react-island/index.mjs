/** React is supplied by the host adapter; zero React imports in the kernel. */
export const reactIsland = {
  id: "react-island",
  apiVersion: 1,
  mount(
    { root, onCleanup },
    {
      createRoot,
      React,
      component,
      props = {},
      selector = "[data-icarus-component]",
    } = {},
  ) {
    if (!createRoot || !React || !component)
      throw new Error("Supply React, createRoot and a real component");
    const target = root.querySelector(selector);
    if (!target) throw new Error(`Missing component slot: ${selector}`);
    const container = document.createElement("div");
    container.dataset.icarusFeature = "react-island";
    target.append(container);
    onCleanup(() => container.remove());
    const reactRoot = createRoot(container);
    onCleanup(() => reactRoot.unmount());
    reactRoot.render(React.createElement(component, props));
  },
};

export default reactIsland;
