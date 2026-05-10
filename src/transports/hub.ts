/**
 * Hub transport — WebSocket client connecting private nodes to a workspace hub.
 *
 * Private nodes use this to:
 *   - Register shared agents with the hub
 *   - Send/receive messages routed through the hub
 *   - Forward feed events and presence updates
 *   - Receive messages destined for local agents
 *
 * Config loaded from ~/.config/maw/workspaces/*.json:
 *   { id, hubUrl, token, sharedAgents }
 *
 * Opens one WebSocket per workspace. Reconnects automatically on disconnect.
 *
 * Protocol (Node → Hub):
 *   { type: "auth", token: "wst_...", nodeId: "white", sig, ts }
 *   { type: "heartbeat", timestamp }
 *   { type: "presence", agents: [{name, status}...] }
 *   { type: "feed", event: {...FeedEvent} }
 *   { type: "message", to: "mba:homekeeper", body, from: "white:neo" }
 *
 * Protocol (Hub → Node):
 *   { type: "auth-ok", workspaceId, agents: [...] }
 *   { type: "message", from, to, body }
 *   { type: "presence", agents: [...] }
 *   { type: "node-joined", nodeId }
 */

export type { WorkspaceConfig } from "./hub-config";
export { loadWorkspaceConfigs } from "./hub-config";
export { HubTransport } from "./hub-transport";
