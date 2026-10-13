export function args(argv, booleans = []) {
  const positional = [],
    opts = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) positional.push(item);
    else {
      const key = item.slice(2);
      if (!key || Object.hasOwn(opts, key))
        throw new Error("Repeated or invalid option");
      opts[key] = booleans.includes(key) ? true : argv[++i];
      if (opts[key] === undefined || String(opts[key]).startsWith("--"))
        throw new Error("Missing value for --" + key);
    }
  }
  return { positional, opts };
}
export const list = (value) =>
  value
    ? String(value)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
export function known(opts, keys) {
  for (const key of Object.keys(opts))
    if (!keys.includes(key)) throw new Error("Unknown option --" + key);
}
