import { loadConfig } from "../../config";
import { curlFetch } from "../../sdk";
import { configPath, resolveHubUrl, resolveWorkspaceId, reportNoWorkspaceId, loadWorkspace, saveWorkspace } from "./workspace-store";
import type { WorkspaceConfig } from "./workspace-store";

/** maw workspace create <name> [--hub <url>] */
export async function cmdWorkspaceCreate(name: string, hubUrl?: string) {
  const hub = resolveHubUrl(hubUrl);
  if (!hub) {
    console.error("\x1b[31m\u274c\x1b[0m no hub URL — pass --hub <url> or configure a peer");
    process.exit(1);
  }

  console.log(`\x1b[36mcreating\x1b[0m workspace "${name}" on ${hub}...`);

  const config = loadConfig();
  const res = await curlFetch(`${hub}/api/workspace/create`, {
    method: "POST",
    body: JSON.stringify({ name, nodeId: config.node ?? "local" }),
  });

  if (!res.ok || !res.data?.id) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to create workspace: ${res.data?.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  const ws: WorkspaceConfig = {
    id: res.data.id,
    name: res.data.name || name,
    hubUrl: hub,
    joinCode: res.data.joinCode,
    sharedAgents: [],
    joinedAt: new Date().toISOString(),
    lastStatus: "connected",
  };
  saveWorkspace(ws);

  console.log(`\x1b[32m\u2705\x1b[0m workspace created`);
  console.log(`  \x1b[36mID:\x1b[0m        ${ws.id}`);
  console.log(`  \x1b[36mName:\x1b[0m      ${ws.name}`);
  console.log(`  \x1b[36mHub:\x1b[0m       ${ws.hubUrl}`);
  if (ws.joinCode) {
    console.log(`  \x1b[36mJoin code:\x1b[0m ${ws.joinCode}`);
  }
  console.log(`\n\x1b[90mConfig saved to ${configPath(ws.id)}\x1b[0m`);
}

/** maw workspace join <code> [--hub <url>] */
export async function cmdWorkspaceJoin(code: string, hubUrl?: string) {
  const hub = resolveHubUrl(hubUrl);
  if (!hub) {
    console.error("\x1b[31m\u274c\x1b[0m no hub URL — pass --hub <url> or configure a peer");
    process.exit(1);
  }

  console.log(`\x1b[36mjoining\x1b[0m workspace with code "${code}" on ${hub}...`);

  const config = loadConfig();
  const res = await curlFetch(`${hub}/api/workspace/join`, {
    method: "POST",
    body: JSON.stringify({ code, node: config.node ?? "local" }),
  });

  if (!res.ok || !res.data?.id) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to join workspace: ${res.data?.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  const ws: WorkspaceConfig = {
    id: res.data.id,
    name: res.data.name || "unknown",
    hubUrl: hub,
    joinCode: code,
    sharedAgents: [],
    joinedAt: new Date().toISOString(),
    lastStatus: "connected",
  };
  saveWorkspace(ws);

  console.log(`\x1b[32m\u2705\x1b[0m joined workspace`);
  console.log(`  \x1b[36mName:\x1b[0m    ${ws.name}`);
  console.log(`  \x1b[36mID:\x1b[0m      ${ws.id}`);
  if (res.data.agents?.length) {
    console.log(`  \x1b[36mAgents:\x1b[0m  ${res.data.agents.length} available`);
    for (const a of res.data.agents) {
      console.log(`    \x1b[90m\u2022\x1b[0m ${a.name || a}`);
    }
  }
  console.log(`\n\x1b[90mConfig saved to ${configPath(ws.id)}\x1b[0m`);
}

/** maw workspace leave [workspace-id] */
export async function cmdWorkspaceLeave(workspaceId?: string) {
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

  console.log(`\x1b[36mleaving\x1b[0m workspace "${ws.name}"...`);

  const config = loadConfig();
  const res = await curlFetch(`${ws.hubUrl}/api/workspace/${ws.id}/leave`, {
    method: "POST",
    body: JSON.stringify({ node: config.node ?? "local" }),
  });

  if (!res.ok) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to leave workspace: ${res.data?.error || `HTTP ${res.status}`}`);
    // Still remove local config — hub might be unreachable
    console.log("\x1b[33m\u26a0\x1b[0m removing local config anyway...");
  }

  // Remove local workspace config (soft-delete: rename with .left suffix)
  const src = configPath(ws.id);
  const dest = configPath(ws.id + ".left");
  try {
    const { renameSync } = require("fs");
    renameSync(src, dest);
  } catch {
    // If rename fails, just delete
    try {
      const { unlinkSync } = require("fs");
      unlinkSync(src);
    } catch {}
  }

  console.log(`\x1b[32m\u2705\x1b[0m left workspace "${ws.name}"`);
  console.log(`\x1b[90m  config archived to ${dest}\x1b[0m`);
}
