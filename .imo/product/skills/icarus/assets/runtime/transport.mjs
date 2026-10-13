/** Required core channel. Every accepted comment is confirmed by a service read. */
export function createTransport({ baseUrl, documentId, token }, signal) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !/^\d+$/.test(url.port) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Icarus requires a loopback service");
  if (!/^[a-f0-9]{32}$/.test(documentId) || typeof token !== "string" || !token)
    throw new Error("Missing Icarus document channel");
  const endpoint = `${url.origin}/feedback/${documentId}`;
  let version = 0,
    operations = [],
    latest = null;
  const request = async (path, body) => {
    const response = await fetch(endpoint + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {
        status: response.status,
        conflict: data.conflict,
      });
    if (path === "/tasks") return data;
    if (
      data.doc?.schema !== "icarus-feedback/v1" ||
      !Array.isArray(data.doc.entries) ||
      !Number.isSafeInteger(data.version)
    )
      throw new Error("Invalid service response");
    if (latest && data.version < version) return latest;
    version = data.version;
    operations = data.operations ?? [];
    latest = data.doc;
    return latest;
  };
  const read = () => request("");
  return {
    read,
    tasks: () => request("/tasks"),
    requestTask: (body) => request("/tasks", body),
    async update(entryId, update) {
      await read();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await request("/updates", {
            expectedVersion: version,
            entryId,
            update,
          });
          break;
        } catch (error) {
          if (
            error.status !== 409 ||
            error.conflict !== "version-conflict" ||
            attempt === 2
          )
            throw error;
          await read();
        }
      }
      const doc = await read();
      if (!operations.some((r) => r.id === update.id && r.entryId === entryId))
        throw new Error("操作尚未通过回读确认，请重试");
      return doc;
    },
    async reply(entryId, reply) {
      await read();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await request("/replies", {
            expectedVersion: version,
            entryId,
            reply,
          });
          break;
        } catch (error) {
          if (error.status !== 409 || attempt === 2) throw error;
          await read();
        }
      }
      const doc = await read();
      const stored = doc.entries
        .find((e) => e.id === entryId)
        ?.replies?.find((r) => r.id === reply.id);
      if (
        !stored ||
        stored.body !== reply.body ||
        stored.author !== reply.author
      )
        throw new Error("回复尚未通过回读确认，请重试");
      return doc;
    },
    async add(entry) {
      await read();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await request("/entries", { expectedVersion: version, entry });
          break;
        } catch (error) {
          if (error.status !== 409 || attempt === 2) throw error;
          await read();
        }
      }
      const doc = await read();
      const stored = doc.entries.find((e) => e.id === entry.id);
      if (!stored || stored.comment !== entry.comment)
        throw new Error("Comment was not confirmed by reread");
      return doc;
    },
  };
}
