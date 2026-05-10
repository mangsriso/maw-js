/**
 * POST /api/proxy — generic HTTP proxy for REST access to HTTP-LAN peers.
 * Barrel re-export — implementation split across proxy-*.ts siblings.
 * See original file header for full architecture notes.
 */

export { proxyApi } from "./proxy-routes";
export { parseProxySignature } from "./proxy-auth";
export { isReadOnlyMethod, isKnownMethod, isPathProxyable, isProxyShellPeerAllowed } from "./proxy-trust";
export { resolveProxyPeerUrl } from "./proxy-relay";
