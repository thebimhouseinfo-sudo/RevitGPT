import { randomUUID } from "node:crypto";

/**
 * A bridge returning HTTP 400 is reachable, but not ready. Native RevitGPT
 * requires X-Request-ID even for GET /health; Python MCP already sends it.
 * Keep this probe independent from full Revit MCP startup and model authority.
 */
export async function probeBridgeHealth(bridgeUrl, {
  fetchImpl = fetch,
  requestIdFactory = randomUUID,
  timeoutMs = 2000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(bridgeUrl.replace(/\/$/, "") + "/health", {
      headers: { "X-Request-ID": requestIdFactory() },
      signal: controller.signal
    });
    if (!response.ok) return { available: false, status: response.status };
    const body = await response.json().catch(() => ({}));
    // Native wraps {data:{status:"ok"}}; the legacy handler used {status:"ok"}.
    if ((body?.data?.status ?? body?.status) !== "ok") {
      return { available: false, status: response.status, error: "Bridge health payload is not ready." };
    }
    return { available: true, body };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}
