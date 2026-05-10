// Workspace Hub API — HMAC authentication

import { createHmac, timingSafeEqual } from "crypto";
import { workspaces } from "./workspace-storage";
import type { Workspace } from "./workspace-types";

const WINDOW_SEC = 300; // +/-5 min

export function wsSign(token: string, method: string, path: string, timestamp: number): string {
  return createHmac("sha256", token).update(`${method}:${path}:${timestamp}`).digest("hex");
}

export function wsVerify(token: string, method: string, path: string, timestamp: number, signature: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > WINDOW_SEC) return false;
  const expected = wsSign(token, method, path, timestamp);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Verify workspace HMAC from request headers. Returns workspace or null. */
export function authenticateWorkspace(
  workspaceId: string,
  method: string,
  path: string,
  headers: { sig?: string; ts?: string },
): Workspace | null {
  const ws = workspaces.get(workspaceId);
  if (!ws) return null;
  if (!headers.sig || !headers.ts) return null;
  const timestamp = parseInt(headers.ts, 10);
  if (isNaN(timestamp)) return null;
  if (!wsVerify(ws.token, method, path, timestamp, headers.sig)) return null;
  return ws;
}
