// Barrel — re-exports everything from the workspace sub-modules.
// Other files (plugins/workspace/index.ts, tests) import from here unchanged.

export type { WorkspaceConfig } from "./workspace-store";
export { normalizeWorkspace } from "./workspace-store";

export { cmdWorkspaceCreate, cmdWorkspaceJoin, cmdWorkspaceLeave } from "./workspace-lifecycle";
export { cmdWorkspaceShare, cmdWorkspaceUnshare, cmdWorkspaceAgents } from "./workspace-agents";
export { cmdWorkspaceLs, cmdWorkspaceInvite, cmdWorkspaceStatus } from "./workspace-query";
