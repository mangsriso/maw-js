// Workspace Hub API — ID generation, node tracking, feed management

import { randomBytes, randomUUID } from "crypto";
import type { Workspace, WorkspaceFeedEvent } from "./workspace-types";

// --- ID / Token Generation ---

export function generateWorkspaceId(): string {
  return `ws_${randomUUID().slice(0, 8)}`;
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function generateJoinCode(): string {
  return randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
}

// --- Node helpers ---

/** Touch a node's lastSeen timestamp */
export function touchNode(ws: Workspace, nodeId: string) {
  const node = ws.nodes.find(n => n.nodeId === nodeId);
  if (node) node.lastSeen = new Date().toISOString();
}

// --- Feed ---

const FEED_MAX = 200;

export function pushFeed(ws: Workspace, event: Omit<WorkspaceFeedEvent, "id">) {
  const full: WorkspaceFeedEvent = { ...event, id: randomUUID().slice(0, 8) };
  ws.feed.push(full);
  if (ws.feed.length > FEED_MAX) ws.feed.splice(0, ws.feed.length - FEED_MAX);
}
