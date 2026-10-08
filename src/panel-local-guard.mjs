// Only a native local process (not a browser-origin request) may pair
// or claim a one-click read-only lease using its one-time code/bearer.
export function isLocalPanelRequest({ remoteAddress, host, origin, referer, contentType }, port) {
  return ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(String(remoteAddress || "")) &&
    host === "127.0.0.1:" + port &&
    !origin && !referer &&
    typeof contentType === "string" &&
    /^application\/json(?:\s*;|$)/i.test(contentType);
}
