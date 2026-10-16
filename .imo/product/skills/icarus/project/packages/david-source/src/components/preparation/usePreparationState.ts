import { useCallback, useSyncExternalStore } from "react";
type Values = Readonly<Record<string, string | boolean>>;
const empty: Values = {};
const cache = new Map<string, Values>();
const eventName = "david:preparation-change";
function read(key: string): Values {
  if (cache.has(key)) return cache.get(key)!;
  let values: Values = empty;
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (data && typeof data === "object" && !Array.isArray(data))
      values = Object.fromEntries(
        Object.entries(data).filter(
          ([, value]) =>
            typeof value === "boolean" || typeof value === "string",
        ),
      );
  } catch {
    /* A blocked storage backend still permits editing in this tab. */
  }
  cache.set(key, values);
  return values;
}
export function usePreparationState(key: string) {
  const subscribe = useCallback(
    (changed: () => void) => {
      const local = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) changed();
      };
      const storage = (event: StorageEvent) => {
        if (event.key === key) {
          cache.delete(key);
          changed();
        }
      };
      window.addEventListener(eventName, local);
      window.addEventListener("storage", storage);
      return () => {
        window.removeEventListener(eventName, local);
        window.removeEventListener("storage", storage);
      };
    },
    [key],
  );
  const get = useCallback(() => read(key), [key]);
  const values = useSyncExternalStore(subscribe, get, () => empty);
  const update = (id: string, value: string | boolean) => {
    const next = { ...read(key), [id]: value };
    cache.set(key, next);
    let persisted = true;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      persisted = false;
    }
    window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
    return persisted;
  };
  return { values, update };
}
