import { describe, expect, test } from "bun:test";
import { orchestrateStrictWake, type StrictOrchestratorDeps, type StrictWakeRequest } from "../../src/integration/strict-orchestrator";

function harness(sessions: Array<{ name: string; windows: Array<{ name: string; cwd?: string }> }> = []) {
  const events: string[] = [];
  const deps: StrictOrchestratorDeps = {
    listAll: async () => sessions,
    hasSession: async () => false,
    newSession: async (name, window, cwd) => { events.push(`new:${name}:${window}:${cwd}`); },
    paneCommand: async (target) => { events.push(`probe:${target}`); return "bash"; },
    send: async (target, value, cwd, readonly) => { events.push(`send:${target}:${value}:${cwd}:${String(!!readonly)}`); return "a".repeat(32); },
    waitReady: async (id) => { events.push(`ready:${id}`); },
    resolveRepo: async (request: StrictWakeRequest) => { events.push(`resolve:${String(request.incubate)}`); return request.repoPath ?? "/repo/new-oracle"; },
    command: (agent, cwd) => `SDA_CODEX_MCP_HOME='/private' codex:${agent}:${cwd}`,
  };
  return { deps, events };
}

describe("selected strict wake orchestrator", () => {
  test("launches an exact existing shell, waits, then dispatches the task", async () => {
    const { deps, events } = harness([{ name: "01-foo", windows: [{ name: "foo-oracle", cwd: "/repo/foo-oracle" }] }]);
    expect(await orchestrateStrictWake({ target: "foo-oracle", task: "do it", engine: "codex-*" }, deps)).toBe("01-foo:foo-oracle");
    expect(events.map(value => value.split(":")[0])).toEqual(["probe", "send", "ready", "send"]);
    expect(events.at(-1)).toContain(":do it:");
  });

  test("does not relaunch a live agent and sends its task once", async () => {
    const { deps, events } = harness([{ name: "01-foo", windows: [{ name: "foo-oracle", cwd: "/repo/foo-oracle" }] }]);
    deps.paneCommand = async () => "codex";
    await orchestrateStrictWake({ target: "foo-oracle", task: "once" }, deps);
    expect(events.filter(value => value.startsWith("send:"))).toHaveLength(1);
    expect(events.some(value => value.startsWith("ready:"))).toBe(false);
  });

  test("creates a canonical new session through the same closed route", async () => {
    const { deps, events } = harness();
    expect(await orchestrateStrictWake({ target: "new", repoPath: "/repo/new-oracle" }, deps)).toBe("new:new-oracle");
    expect(events[0]).toBe("resolve:undefined");
    expect(events[1]).toBe("new:new:new-oracle:/repo/new-oracle");
    expect(events.some(value => value.startsWith("ready:"))).toBe(true);
  });

  test("passes incubate authority only to the repository resolver", async () => {
    const { deps, events } = harness();
    await orchestrateStrictWake({ target: "missing", incubate: "org/repo" }, deps);
    expect(events[0]).toBe("resolve:org/repo");
    expect(events.find(value => value.startsWith("send:"))?.endsWith(":true")).toBe(true);
  });

  test("fails closed on ambiguous sessions, invalid input, and unresolved routes", async () => {
    const ambiguous = harness([{ name: "multi", windows: [{ name: "a", cwd: "/a" }, { name: "b", cwd: "/b" }] }]);
    await expect(orchestrateStrictWake({ target: "multi" }, ambiguous.deps)).rejects.toThrow("SDA-MCP-E-TMUX-AMBIGUOUS");
    await expect(orchestrateStrictWake({ target: "../bad" }, harness().deps)).rejects.toThrow("SDA-MCP-E-SCHEMA");
    const unresolved = harness(); unresolved.deps.resolveRepo = async () => { throw new Error("SDA-MCP-E-PATH"); };
    await expect(orchestrateStrictWake({ target: "missing" }, unresolved.deps)).rejects.toThrow("SDA-MCP-E-PATH");
    expect(unresolved.events).toEqual([]);
  });
});
