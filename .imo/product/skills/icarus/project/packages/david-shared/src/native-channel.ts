const channels = new Map<string, any>();
export function registerNativeChannel(channel: any) {
  if (!channel) return () => {};
  channels.set(channel.baseUrl, channel);
  return () => {
    if (channels.get(channel.baseUrl) === channel)
      channels.delete(channel.baseUrl);
  };
}
/** Only David's transport imports this fetch binding; host fetch is never replaced. */
export async function fetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  for (const [base, channel] of channels)
    if (url.startsWith(base + "/")) {
      const r = await channel.request(url.slice(base.length), init);
      return new Response(r.body, {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      });
    }
  return globalThis.fetch(input, init);
}
