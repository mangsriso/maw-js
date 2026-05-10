import { cfgTimeout } from "../../config";
import { curlFetch } from "../../sdk";
import { resolveWorkspaceId, reportNoWorkspaceId, loadWorkspace, loadAllWorkspaces, saveWorkspace } from "./workspace-store";

/** maw workspace ls */
export async function cmdWorkspaceLs() {
  const workspaces = loadAllWorkspaces();

  if (workspaces.length === 0) {
    console.log("\x1b[90mNo workspaces configured.\x1b[0m");
    console.log("\x1b[90m  maw workspace create <name>   Create a new workspace\x1b[0m");
    console.log("\x1b[90m  maw workspace join <code>     Join with invite code\x1b[0m");
    return;
  }

  console.log(`\n\x1b[36;1mWorkspaces\x1b[0m  \x1b[90m${workspaces.length} joined\x1b[0m\n`);

  for (const ws of workspaces) {
    const statusDot = ws.lastStatus === "connected"
      ? "\x1b[32m\u25cf\x1b[0m"
      : "\x1b[31m\u25cf\x1b[0m";
    const agentCount = ws.sharedAgents.length;
    const agentLabel = agentCount === 0
      ? "\x1b[90mno agents shared\x1b[0m"
      : `${agentCount} agent${agentCount !== 1 ? "s" : ""} shared`;

    console.log(`  ${statusDot}  \x1b[37;1m${ws.name}\x1b[0m  \x1b[90m(${ws.id})\x1b[0m`);
    console.log(`     \x1b[36mHub:\x1b[0m     ${ws.hubUrl}`);
    console.log(`     \x1b[36mAgents:\x1b[0m  ${agentLabel}`);
    if (ws.sharedAgents.length > 0) {
      console.log(`     \x1b[90m         ${ws.sharedAgents.join(", ")}\x1b[0m`);
    }
    console.log(`     \x1b[90mJoined:  ${ws.joinedAt}\x1b[0m`);
  }
  console.log();
}

/** maw workspace invite [workspace-id] */
export async function cmdWorkspaceInvite(workspaceId?: string) {
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

  const res = await curlFetch(`${ws.hubUrl}/api/workspace/${ws.id}/status`, { timeout: cfgTimeout("workspace") });

  if (!res.ok) {
    console.error(`\x1b[31m\u274c\x1b[0m failed to fetch invite info: ${res.data?.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  const joinCode = res.data?.joinCode || ws.joinCode;
  if (!joinCode) {
    console.error("\x1b[31m\u274c\x1b[0m no join code available for this workspace");
    process.exit(1);
  }

  console.log(`\n\x1b[36;1m${ws.name}\x1b[0m  \x1b[90mInvite\x1b[0m\n`);
  console.log(`  \x1b[36mJoin code:\x1b[0m  ${joinCode}`);
  if (res.data?.expiry) {
    console.log(`  \x1b[36mExpires:\x1b[0m    ${res.data.expiry}`);
  }
  console.log(`\n  \x1b[90mTo join:\x1b[0m  maw workspace join ${joinCode} --hub ${ws.hubUrl}`);
  console.log();
}

/** maw workspace status */
export async function cmdWorkspaceStatus() {
  const workspaces = loadAllWorkspaces();

  if (workspaces.length === 0) {
    console.log("\x1b[90mNo workspaces configured.\x1b[0m");
    return;
  }

  console.log(`\n\x1b[36;1mWorkspace Status\x1b[0m  \x1b[90m${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""}\x1b[0m\n`);

  const results = await Promise.all(
    workspaces.map(async (ws) => {
      const start = Date.now();
      try {
        const res = await curlFetch(`${ws.hubUrl}/api/workspace/${ws.id}/status`, { timeout: cfgTimeout("workspace") });
        const ms = Date.now() - start;
        if (res.ok) {
          ws.lastStatus = "connected";
          saveWorkspace(ws);
          return {
            ws,
            ok: true,
            ms,
            agentCount: res.data?.agentCount ?? 0,
            nodeCount: res.data?.nodeCount ?? 0,
          };
        }
        ws.lastStatus = "disconnected";
        saveWorkspace(ws);
        return { ws, ok: false, ms, agentCount: 0, nodeCount: 0 };
      } catch {
        ws.lastStatus = "disconnected";
        saveWorkspace(ws);
        return { ws, ok: false, ms: Date.now() - start, agentCount: 0, nodeCount: 0 };
      }
    })
  );

  let online = 0;
  for (const r of results) {
    if (r.ok) online++;
    const dot = r.ok ? "\x1b[32m\u25cf\x1b[0m" : "\x1b[31m\u25cf\x1b[0m";
    const status = r.ok
      ? `\x1b[32mconnected\x1b[0m  \x1b[90m${r.ms}ms \u00b7 ${r.agentCount} agent${r.agentCount !== 1 ? "s" : ""} \u00b7 ${r.nodeCount} node${r.nodeCount !== 1 ? "s" : ""}\x1b[0m`
      : `\x1b[31mdisconnected\x1b[0m  \x1b[90m${r.ms}ms\x1b[0m`;

    console.log(`  ${dot}  \x1b[37;1m${r.ws.name}\x1b[0m  ${status}`);
    console.log(`     \x1b[90m${r.ws.hubUrl}\x1b[0m`);
  }

  console.log(`\n\x1b[90m${online}/${workspaces.length} connected\x1b[0m\n`);
}
