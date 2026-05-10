/**
 * Workspace Hub API — multi-node workspace management.
 * Barrel re-export — implementation split across workspace-*.ts siblings.
 */

export { workspaceApi } from "./workspace-routes";
export type { Workspace, WorkspaceAgent, WorkspaceFeedEvent, WorkspaceNode } from "./workspace-types";
export { WORKSPACE_DIR } from "./workspace-storage";
export { wsSign, wsVerify } from "./workspace-auth";
