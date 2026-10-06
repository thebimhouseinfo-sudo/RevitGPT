function requestId(body) {
  if (!body || typeof body !== "object" || !("id" in body)) return null;
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

export function isServerDiscoverRequest(body) {
  return Boolean(body && typeof body === "object" && body.method === "server/discover");
}

export function buildLegacyDiscoverFallback(body) {
  if (!isServerDiscoverRequest(body)) return null;
  return {
    jsonrpc: "2.0",
    id: requestId(body),
    error: {
      code: -32601,
      message: 'method not found: "server/discover"'
    }
  };
}
