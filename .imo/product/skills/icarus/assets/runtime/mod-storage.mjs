/** Generic document/mod storage; no David schema or executable backend extensions. */
export function modStorage(service, id, signal) {
  const request = async (body) => {
    const response = await fetch(
      `${service.baseUrl}/mod-data/${service.documentId}/${id}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${service.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error || "Mod data failed"), {
        status: response.status,
      });
    return result;
  };
  return {
    read: () => request(),
    write: (value, version) => request({ expectedVersion: version, value }),
    async update(fn) {
      for (let i = 0; i < 3; i++) {
        const state = await request();
        try {
          return await request({
            expectedVersion: state.version,
            value: await fn(structuredClone(state.value)),
          });
        } catch (e) {
          if (e.status !== 409 || i === 2) throw e;
        }
      }
    },
  };
}
