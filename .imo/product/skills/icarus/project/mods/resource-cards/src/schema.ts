export type ServiceResource = {
  id?: string;
  kind: string;
  title: string;
  description?: string;
  fields: { label: string; value: string; href?: string }[];
  notice?: string;
  href?: string;
  linkLabel?: string;
  links?: { label: string; href: string }[];
  status?: {
    state: "ready" | "missing" | "partial" | "unknown";
    label: string;
    detail?: string;
  };
};
function isWebLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
export function isValidServiceResource(
  value: unknown,
): value is ServiceResource {
  const r = value as ServiceResource;
  const text = (v: unknown) => typeof v === "string" && !!v.trim();
  return (
    !!r &&
    text(r.kind) &&
    text(r.title) &&
    (r.id === undefined || text(r.id)) &&
    (r.description === undefined || text(r.description)) &&
    Array.isArray(r.fields) &&
    r.fields.length > 0 &&
    r.fields.every(
      (f) =>
        f &&
        text(f.label) &&
        text(f.value) &&
        (f.href === undefined || isWebLink(f.href)),
    ) &&
    (r.notice === undefined || typeof r.notice === "string") &&
    (r.href === undefined || isWebLink(r.href)) &&
    (r.linkLabel === undefined || (text(r.linkLabel) && !!r.href)) &&
    (r.links === undefined ||
      (Array.isArray(r.links) &&
        r.links.every((l) => l && text(l.label) && isWebLink(l.href)))) &&
    (r.status === undefined ||
      (!!r.status &&
        ["ready", "missing", "partial", "unknown"].includes(r.status.state) &&
        text(r.status.label) &&
        (r.status.detail === undefined || text(r.status.detail))))
  );
}
