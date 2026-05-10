import { loadConfig, cfgTimeout } from "../../config";
import { curlFetch } from "../../sdk";
import { resolveWorkspaceId, reportNoWorkspaceId, loadWorkspace, saveWorkspace } from "./workspace-store";

/** maw workspace share <agent...> [--workspace <id>] */
export async function cmdWorkspaceShare(agents: string[], workspaceId?: string) {
  const id = resolveWorkspaceId(workspaceId);
  if (!id) {
    reportNoWorkspaceId();
    process.exit(1);
  }

  const ws = loadWorkspace(id);
  if (!ws) {
    console.error(`\x1b[31m\u274c\x1b[0m workspace not found: ${id}`);
    process.exit(1);
  }

  console.log(`\x1b[36msharing\x1b[0m ${agents.length} agent(s) to workspace "${ws.name}"...`);

  const config = loadConfig();
  const res = await curlFetch(`${ws.hubUrl}/api/workspace/${ws.id}/agents`, {
    method: "POST",
    body: JSON.stringify({ action: "share", agents, node: config.node ?? "local" }),
  });

  if (!res.ok) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to share agents: ${res.data?.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  // Update local config
  const newAgents = new Set([...ws.sharedAgents, ...agents]);
  ws.sharedAgents = [...newAgents];
  saveWorkspace(ws);

  console.log(`\x1b[32m\u2705\x1b[0m shared ${agents.length} agent(s)`);
  for (const a of agents) {
    console.log(`  \x1b[32m+\x1b[0m ${a}`);
  }
  console.log(`\x1b[90m  total shared: ${ws.sharedAgents.length}\x1b[0m`);
}

/** maw workspace unshare <agent...> [--workspace <id>] */
export async function cmdWorkspaceUnshare(agents: string[], workspaceId?: string) {
  const id = resolveWorkspaceId(workspaceId);
  if (!id) {
    reportNoWorkspaceId();
    process.exit(1);
  }

  const ws = loadWorkspace(id);
  if (!ws) {
    console.error(`\x1b[31m\u274c\x1b[0m workspace not found: ${id}`);
    process.exit(1);
  }

  console.log(`\x1b[36mremoving\x1b[0m ${agents.length} agent(s) from workspace "${ws.name}"...`);

  const config = loadConfig();
  const res = await curlFetch(`${ws.hubUrl}/api/workspace/${ws.id}/agents`, {
    method: "POST",
    body: JSON.stringify({ action: "unshare", agents, node: config.node ?? "local" }),
  });

  if (!res.ok) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to unshare agents: ${res.data?.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  // Update local config
  const removeSet = new Set(agents);
  ws.sharedAgents = ws.sharedAgents.filter(a => !removeSet.has(a));
  saveWorkspace(ws);

  console.log(`\x1b[32m\u2705\x1b[0m removed ${agents.length} agent(s)`);
  for (const a of agents) {
    console.log(`  \x1b[31m-\x1b[0m ${a}`);
  }
  console.log(`\x1b[90m  total shared: ${ws.sharedAgents.length}\x1b[0m`);
}

/** maw workspace agents [workspace-id] */
export async function cmdWorkspaceAgents(workspaceId?: string) {
  const id = resolveWorkspaceId(workspaceId);
  if (!id) {
    reportNoWorkspaceId();
    process.exit(1);
  }

  const ws = loadWorkspace(id);
  if (!ws) {
    console.error(`\x1b[31m\u274c\x1b[0m workspace not found: ${id}`);
    process.exit(1);
  }

  console.log(`\x1b[36mfetching\x1b[0m agents for workspace "${ws.name}"...`);

  const res = await curlFetch(`${ws.hubUrl}/api/workspace/${ws.id}/agents`, { timeout: cfgTimeout("workspace") });

  if (!res.ok) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to fetch agents: ${res.data?.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  const nodes: Record<string, string[]> = res.data?.nodes || {};
  const nodeNames = Object.keys(nodes);

  if (nodeNames.length === 0) {
    console.log("\x1b[90mNo agents in workspace yet.\x1b[0m");
    console.log("\x1b[90m  maw workspace share <agent...>  Share your agents\x1b[0m");
    return;
  }

  console.log(`\n\x1b[36;1m${ws.name}\x1b[0m  \x1b[90mAgents by node\x1b[0m\n`);

  let totalAgents = 0;
  for (const node of nodeNames) {
    const agents = nodes[node] || [];
    totalAgents += agents.length;
    console.log(`  \x1b[37;1m${node}\x1b[0m  \x1b[90m(${agents.length} agent${agents.length !== 1 ? "s" : ""})\x1b[0m`);
    for (const a of agents) {
      console.log(`    \x1b[90m\u25cf\x1b[0m ${a}`);
    }
  }

  console.log(`\n\x1b[90m${totalAgents} total agents across ${nodeNames.length} node${nodeNames.length !== 1 ? "s" : ""}\x1b[0m\n`);
}
