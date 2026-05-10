// Workspace Hub API — shared types

export interface WorkspaceAgent {
  name: string;
  nodeId: string;
  status?: string;
  capabilities?: string[];
  updatedAt: string;
}

export interface WorkspaceFeedEvent {
  id: string;
  nodeId: string;
  type: string;
  message: string;
  ts: number;
}

export interface WorkspaceNode {
  nodeId: string;
  joinedAt: string;
  lastSeen: string;
}

export interface Workspace {
  id: string;
  name: string;
  token: string;
  joinCode: string;
  joinCodeExpiresAt: number;
  createdAt: string;
  creatorNodeId: string;
  nodes: WorkspaceNode[];
  agents: WorkspaceAgent[];
  feed: WorkspaceFeedEvent[];
}
