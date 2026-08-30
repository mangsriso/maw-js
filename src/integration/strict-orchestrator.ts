/** Closed Codex wake orchestration shared by normal maw and strict ingress. */
import { existsSync, realpathSync, statSync } from "fs";
import { basename } from "path";
import { buildCommandInDirFromConfig } from "../config/command";
import { loadConfigFresh } from "../config/load";
import { createIntegratedReadonlyAuthority, revokeIntegratedReadonly } from "../config/codex-trust";
import { ghqFind } from "../core/ghq";
import { canonicalSessionName } from "../core/fleet/session-name";
import { Tmux } from "../core/transport/tmux-class";
import { waitForIntegratedReadiness } from "./codex-delivery-plan";

export type StrictWakeRequest = {
  target: string;
  task?: string;
  engine?: "codex-*";
  incubate?: string | boolean;
  repoPath?: string;
};

type Session = { name: string; windows: Array<{ name: string; cwd?: string }> };

export type StrictOrchestratorDeps = {
  listAll: () => Promise<Session[]>;
  hasSession: (name: string) => Promise<boolean>;
  newSession: (name: string, window: string, cwd: string) => Promise<void>;
  paneCommand: (target: string) => Promise<string>;
  send: (target: string, text: string, cwd: string, readonly?: boolean) => Promise<string | undefined>;
  waitReady: (launchId: string) => Promise<void>;
  resolveRepo: (request: StrictWakeRequest) => Promise<string>;
  command: (agent: string, cwd: string) => string;
};

function exactTarget(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_./:@%+\-]{1,1024}$/.test(value) || value.includes("..")) {
    throw new Error("SDA-MCP-E-SCHEMA strict target invalid");
  }
  return value;
}

function exactRepo(path: string): string {
  if (!path.startsWith("/") || !existsSync(path)) throw new Error("SDA-MCP-E-PATH repository unavailable");
  const resolved = realpathSync(path), st = statSync(resolved);
  if (!st.isDirectory()) throw new Error("SDA-MCP-E-PATH repository is not a directory");
  return resolved;
}

function parseRepositoryTarget(target: string): { slug: string } | null {
  const url = target.match(/^(?:https?:\/\/|git@)github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/);
  if (url) return { slug: `${url[1]}/${url[2]}` };
  const slug = target.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return slug ? { slug: `${slug[1]}/${slug[2].replace(/\.git$/, "")}` } : null;
}

async function resolveRepoDefault(request: StrictWakeRequest): Promise<string> {
  if (request.repoPath) return exactRepo(request.repoPath);
  const parsed = parseRepositoryTarget(request.target);
  const query = parsed ? `/${parsed.slug}` : `/${request.target}`;
  let found = await ghqFind(query);
  if (!found && request.incubate) {
    const slug = typeof request.incubate === "string" ? request.incubate : parsed?.slug ?? request.target;
    if (!/^(?:github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) throw new Error("SDA-MCP-E-SCHEMA incubate slug invalid");
    const normalized = slug.startsWith("github.com/") ? slug : `github.com/${slug}`;
    const ghq = Bun.which("ghq");
    if (!ghq?.startsWith("/")) throw new Error("SDA-MCP-E-PATH pinned ghq unavailable");
    const result = Bun.spawnSync({ cmd: [ghq, "get", "-u", normalized], stdout: "ignore", stderr: "ignore", timeout: 120_000 });
    if (result.exitCode !== 0) throw new Error("SDA-MCP-E-RECOVERY incubate clone failed");
    found = await ghqFind(normalized);
  }
  if (!found) throw new Error("SDA-MCP-E-PATH target repository unresolved");
  return exactRepo(found);
}

function defaultDeps(): StrictOrchestratorDeps {
  const tmux = new Tmux();
  return {
    listAll: () => tmux.listAll(),
    hasSession: (name) => tmux.hasSession(name),
    newSession: async (name, window, cwd) => { await tmux.newSession(name, { window, cwd }); },
    paneCommand: async (target) => (await tmux.run("display-message", "-p", "-t", target, "#{pane_current_command}")).trim(),
    send: async (target, text, cwd, readonly = false) => {
      const authority = readonly ? createIntegratedReadonlyAuthority(target, cwd) : undefined;
      try {
        return await tmux.sendText(target, text, { requiredCwd: cwd, integratedReadonlyAuthority: authority });
      } finally {
        revokeIntegratedReadonly(authority);
      }
    },
    waitReady: waitForIntegratedReadiness,
    resolveRepo: resolveRepoDefault,
    command: (agent, cwd) => buildCommandInDirFromConfig(loadConfigFresh(), agent, cwd, "codex-*"),
  };
}

function liveMatches(sessions: Session[], target: string): Array<{ target: string; cwd: string }> {
  if (target.includes(":")) {
    const [sessionName, windowName] = target.split(":", 2);
    return sessions.filter(session => session.name === sessionName).flatMap(session =>
      session.windows.filter(window => window.name === windowName).map(window => ({ target: `${session.name}:${window.name}`, cwd: window.cwd ?? "" })),
    );
  }
  const sessionsByName = sessions.filter(session => session.name === target).flatMap(session => {
    if (session.windows.length !== 1) return [];
    const window = session.windows[0]!; return [{ target: `${session.name}:${window.name}`, cwd: window.cwd ?? "" }];
  });
  const windowsByName = sessions.flatMap(session => session.windows.filter(window => window.name === target)
    .map(window => ({ target: `${session.name}:${window.name}`, cwd: window.cwd ?? "" })));
  return [...sessionsByName, ...windowsByName].filter((item, index, all) => all.findIndex(other => other.target === item.target) === index);
}

function targetIsAmbiguousSession(sessions: Session[], target: string): boolean {
  return !target.includes(":") && sessions.some(session => session.name === target && session.windows.length !== 1);
}

export async function orchestrateStrictWake(
  request: StrictWakeRequest,
  deps: StrictOrchestratorDeps = defaultDeps(),
): Promise<string> {
  const requested = exactTarget(request.target);
  if (request.engine !== undefined && request.engine !== "codex-*") throw new Error("SDA-MCP-E-SCHEMA engine invalid");
  if (request.task !== undefined && (typeof request.task !== "string" || Buffer.byteLength(request.task) > 64 * 1024)) throw new Error("SDA-MCP-E-SCHEMA task invalid");
  const sessions = await deps.listAll();
  const matches = liveMatches(sessions, requested);
  if (matches.length > 1 || targetIsAmbiguousSession(sessions, requested)) throw new Error("SDA-MCP-E-TMUX-AMBIGUOUS target is not unique");
  let destination: string, cwd: string, agent: string, launch = true;
  if (matches.length === 1) {
    destination = matches[0]!.target; cwd = matches[0]!.cwd;
    if (!cwd.startsWith("/")) throw new Error("SDA-MCP-E-TMUX-AMBIGUOUS pane cwd unavailable");
    agent = destination.split(":", 2)[1]!;
    const current = await deps.paneCommand(destination);
    if (/^(?:codex|claude|gemini|node|bun)$/.test(current)) launch = false;
  } else {
    cwd = await deps.resolveRepo(request);
    agent = basename(cwd).replace(/-oracle$/, "");
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(agent)) throw new Error("SDA-MCP-E-SCHEMA agent name invalid");
    let session = canonicalSessionName(agent);
    if (await deps.hasSession(session)) throw new Error("SDA-MCP-E-TMUX-AMBIGUOUS session appeared during resolution");
    await deps.newSession(session, `${agent}-oracle`, cwd);
    destination = `${session}:${agent}-oracle`;
  }
  if (launch) {
    const command = deps.command(agent, cwd);
    if (!command.startsWith("SDA_CODEX_MCP_HOME='")) throw new Error("SDA-MCP-E-ROUTE integrated route unavailable");
    const launchId = await deps.send(destination, command, cwd, !!request.incubate);
    if (!launchId) throw new Error("SDA-MCP-E-DELIVERY launch identity absent");
    await deps.waitReady(launchId);
  }
  if (request.task) await deps.send(destination, request.task, cwd);
  return destination;
}
