// Workspace Hub API — Elysia route definitions

import { Elysia, t } from "elysia";
import { loadAll, workspaces, persist, findByJoinCode } from "./workspace-storage";
import { authenticateWorkspace } from "./workspace-auth";
import { generateWorkspaceId, generateToken, generateJoinCode, touchNode, pushFeed } from "./workspace-helpers";
import type { Workspace } from "./workspace-types";

export const workspaceApi = new Elysia()
  .onBeforeHandle(() => { loadAll(); });

/** Helper: authenticate workspace from request context */
function authWorkspace(
  params: { id: string },
  request: Request,
  headers: Record<string, string | undefined>,
): { ws: Workspace } | { error: string } {
  const workspaceId = params.id;
  const url = new URL(request.url);
  const ws = authenticateWorkspace(workspaceId, request.method, url.pathname, {
    sig: headers["x-maw-signature"],
    ts: headers["x-maw-timestamp"],
  });
  if (!ws) return { error: "workspace auth failed" };
  return { ws };
}

/**
 * POST /workspace/create
 * Body: { name, nodeId }
 * Returns: { id, token, joinCode, joinCodeExpiresAt }
 */
workspaceApi.post("/workspace/create", async ({ body, set }) => {
  if (!body.name || !body.nodeId) {
    set.status = 400; return { error: "name and nodeId are required" };
  }

  const id = generateWorkspaceId();
  const token = generateToken();
  const joinCode = generateJoinCode();
  const now = new Date().toISOString();
  const joinCodeExpiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h

  const ws: Workspace = {
    id, name: body.name, token, joinCode, joinCodeExpiresAt,
    createdAt: now, creatorNodeId: body.nodeId,
    nodes: [{ nodeId: body.nodeId, joinedAt: now, lastSeen: now }],
    agents: [], feed: [],
  };

  workspaces.set(id, ws);
  persist(ws);
  pushFeed(ws, { nodeId: body.nodeId, type: "workspace.created", message: `Workspace "${body.name}" created`, ts: Date.now() });
  persist(ws);

  return { id, token, joinCode, joinCodeExpiresAt };
}, {
  body: t.Object({ name: t.Optional(t.String()), nodeId: t.Optional(t.String()) }),
});

/**
 * POST /workspace/join
 * Body: { code, nodeId }
 * Returns: { workspaceId, token, name }
 */
workspaceApi.post("/workspace/join", async ({ body, set }) => {
  if (!body.code || !body.nodeId) {
    set.status = 400; return { error: "code and nodeId are required" };
  }

  const ws = findByJoinCode(body.code.toUpperCase());
  if (!ws) {
    set.status = 404; return { error: "invalid or expired join code" };
  }

  if (!ws.nodes.find(n => n.nodeId === body.nodeId)) {
    const now = new Date().toISOString();
    ws.nodes.push({ nodeId: body.nodeId, joinedAt: now, lastSeen: now });
    pushFeed(ws, { nodeId: body.nodeId, type: "node.joined", message: `Node "${body.nodeId}" joined`, ts: Date.now() });
  }

  persist(ws);
  return { workspaceId: ws.id, token: ws.token, name: ws.name };
}, {
  body: t.Object({ code: t.Optional(t.String()), nodeId: t.Optional(t.String()) }),
});

/**
 * POST /workspace/:id/agents
 * Body: { name, nodeId, status?, capabilities? }
 */
workspaceApi.post("/workspace/:id/agents", async ({ params, body, headers, request, set }) => {
  const auth = authWorkspace(params, request, headers);
  if ("error" in auth) { set.status = 401; return { error: auth.error }; }
  const ws = auth.ws;

  if (!body.name || !body.nodeId) {
    set.status = 400; return { error: "name and nodeId are required" };
  }

  const now = new Date().toISOString();
  const existing = ws.agents.find(a => a.name === body.name && a.nodeId === body.nodeId);

  if (existing) {
    existing.status = body.status || existing.status;
    existing.capabilities = body.capabilities || existing.capabilities;
    existing.updatedAt = now;
  } else {
    ws.agents.push({
      name: body.name, nodeId: body.nodeId,
      status: body.status || "registered",
      capabilities: body.capabilities || [],
      updatedAt: now,
    });
    pushFeed(ws, { nodeId: body.nodeId, type: "agent.registered", message: `Agent "${body.name}" registered from ${body.nodeId}`, ts: Date.now() });
  }

  touchNode(ws, body.nodeId);
  persist(ws);
  return { ok: true, agents: ws.agents.length };
}, {
  params: t.Object({ id: t.String() }),
  body: t.Object({
    name: t.Optional(t.String()), nodeId: t.Optional(t.String()),
    status: t.Optional(t.String()), capabilities: t.Optional(t.Array(t.String())),
  }),
});

/**
 * GET /workspace/:id/agents
 */
workspaceApi.get("/workspace/:id/agents", ({ params, headers, request, set }) => {
  const auth = authWorkspace(params, request, headers);
  if ("error" in auth) { set.status = 401; return { error: auth.error }; }
  const ws = auth.ws;
  return { agents: ws.agents, total: ws.agents.length };
}, {
  params: t.Object({ id: t.String() }),
});

/**
 * GET /workspace/:id/status
 */
workspaceApi.get("/workspace/:id/status", ({ params, headers, request, set }) => {
  const auth = authWorkspace(params, request, headers);
  if ("error" in auth) { set.status = 401; return { error: auth.error }; }
  const ws = auth.ws;

  const fiveMinAgo = Date.now() - 5 * 60_000;
  const healthyNodes = ws.nodes.filter(n => new Date(n.lastSeen).getTime() > fiveMinAgo);

  return {
    id: ws.id, name: ws.name, createdAt: ws.createdAt,
    nodes: ws.nodes, nodeCount: ws.nodes.length,
    healthyNodeCount: healthyNodes.length,
    agentCount: ws.agents.length, feedCount: ws.feed.length,
  };
}, {
  params: t.Object({ id: t.String() }),
});

/**
 * GET /workspace/:id/feed
 * Query: ?limit=50
 */
workspaceApi.get("/workspace/:id/feed", ({ params, query, headers, request, set }) => {
  const auth = authWorkspace(params, request, headers);
  if ("error" in auth) { set.status = 401; return { error: auth.error }; }
  const ws = auth.ws;
  const limit = Math.min(200, +(query.limit || "50"));
  const events = ws.feed.slice(-limit).reverse();
  return { events, total: events.length };
}, {
  params: t.Object({ id: t.String() }),
  query: t.Object({ limit: t.Optional(t.String()) }),
});

/**
 * POST /workspace/:id/message
 * Body: { from, to?, text }
 */
workspaceApi.post("/workspace/:id/message", async ({ params, body, headers, request, set }) => {
  const auth = authWorkspace(params, request, headers);
  if ("error" in auth) { set.status = 401; return { error: auth.error }; }
  const ws = auth.ws;

  if (!body.from || !body.text) {
    set.status = 400; return { error: "from and text are required" };
  }

  const target = body.to ? ` -> ${body.to}` : "";
  pushFeed(ws, { nodeId: body.from, type: "message", message: `[${body.from}${target}] ${body.text}`, ts: Date.now() });
  persist(ws);
  return { ok: true };
}, {
  params: t.Object({ id: t.String() }),
  body: t.Object({
    from: t.Optional(t.String()), to: t.Optional(t.String()), text: t.Optional(t.String()),
  }),
});
