const themes = {
  paper: {
    ink: "#33291f",
    muted: "#786a5b",
    paper: "#efe2c7",
    card: "#fffaf0",
    line: "#d4bd96",
    accent: "#a6532b",
  },
  dark: {
    ink: "#e5e7eb",
    muted: "#9ca3af",
    paper: "#111827",
    card: "#1f2937",
    line: "#4b5563",
    accent: "#fbbf24",
  },
};
export default {
  id: "review-theme",
  apiVersion: 1,
  requires: [],
  mount({ onCleanup }: any, { theme = "paper", tokens = {} }: any = {}) {
    const selected = (themes as any)[theme];
    if (!selected) throw new Error("Unknown review theme");
    const values = { ...selected, ...tokens };
    for (const [key, value] of Object.entries(values))
      if (
        !/^[a-z][a-z-]*$/.test(key) ||
        typeof value !== "string" ||
        !/^#[0-9a-f]{3,8}$/i.test(value)
      )
        throw new Error("Theme tokens must be CSS color hex values");
    const style = document.createElement("style");
    style.dataset.icarusModStyle = "review-theme";
    style.textContent =
      "[data-icarus-david-root]{" +
      Object.entries(values)
        .map(([k, v]) => "--" + k + ":" + v + "!important")
        .join(";") +
      "}";
    document.head.append(style);
    onCleanup(() => style.remove());
  },
};
