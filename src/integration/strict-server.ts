/** Minimal immutable strict ingress used by the protocol-v1 handover chain. */
import { createHash } from "crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "fs";
import { join } from "path";
import { parseJsonStrict } from "../config/transaction";
import { Tmux } from "../core/transport/tmux-class";
import { orchestrateStrictWake } from "./strict-orchestrator";

const SHA = /^[0-9a-f]{64}$/;
const HANDOVER = /^h-\d{8}T\d{6}Z-[0-9a-f]{16}$/;
const INSTALL = /^i-\d{8}T\d{6}Z-[0-9a-f]{16}$/;
const SERVER = /^ms-[0-9a-f]{32}$/;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const jcs = (value: unknown) => JSON.stringify(stable(value));
const domainHash = (name: string, value: unknown) => createHash("sha256").update(`sda-${name}-v1\0${jcs(value)}`).digest("hex");
const rawHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function canonicalFileDomainHash(name: string, path: string): string {
  const raw = readFileSync(path);
  const body = raw.length && raw[raw.length - 1] === 0x0a ? raw.subarray(0, -1) : raw;
  return createHash("sha256").update(`sda-${name}-v1\0`).update(body).digest("hex");
}
function processStartTicks(): number {
  const text = readFileSync(`/proc/${process.pid}/stat`, "utf8"), end = text.lastIndexOf(")");
  return Number(text.slice(end + 2).split(" ")[19]);
}
function safeJson(path: string): Record<string, any> {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || !st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600) throw new Error("unsafe strict record");
  const value = parseJsonStrict(readFileSync(path, "utf8"), { allowUnsafeIntegers: true });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("strict record shape");
  return value as Record<string, any>;
}

async function strictBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isInteger(length) || length < 0 || length > 64 * 1024) throw new Error("request bound");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 64 * 1024) throw new Error("request bound");
  const value = parseJsonStrict(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const strictTmux = new Tmux();

function strictTarget(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:@%+-]{1,512}$/.test(value)) throw new Error("target invalid");
  return value;
}

async function strictPaneCwd(target: string): Promise<string> {
  const cwd = (await strictTmux.run("display-message", "-p", "-t", target, "#{pane_current_path}" )).replace(/\n$/, "");
  if (!cwd.startsWith("/") || cwd.includes("\0")) throw new Error("pane cwd invalid");
  return cwd;
}

export async function runStrictServer(args: string[]): Promise<number> {
  const expected = ["strict-server", "serve", "--protocol", "1", "--server-record", args[5] ?? "", "--server-record-sha256", args[7] ?? "", "--state-root", args[9] ?? "", "--handover-id", args[11] ?? "", "--handover-final-sha256", args[13] ?? "", "--install-id", args[15] ?? "", "--listener", args[17] ?? ""];
  if (args.join("\0") !== expected.join("\0") || !args[5]?.startsWith("/") || !SHA.test(args[7] ?? "")
      || !args[9]?.startsWith("/") || !HANDOVER.test(args[11] ?? "") || !SHA.test(args[13] ?? "")
      || !INSTALL.test(args[15] ?? "") || !/^tcp:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,4})$/.test(args[17] ?? "")) {
    process.stderr.write("SDA-MCP-E-ABI invalid strict-server arguments\n"); return 78;
  }
  try {
    const recordPath = args[5]!, record = safeJson(recordPath);
    if (!SERVER.test(record.id) || domainHash("strict-server-record", record) !== args[7]) throw new Error("server record hash mismatch");
    const executable = realpathSync(process.execPath), executableStat = statSync(executable);
    if (realpathSync(record.artifact.path) !== executable || record.artifact.device !== Number(executableStat.dev)
        || record.artifact.inode !== Number(executableStat.ino) || record.artifact.sha256 !== rawHash(executable)) throw new Error("strict artifact mismatch");
    const cwd = statSync(process.cwd());
    if (record.launch_cwd.path !== process.cwd() || record.launch_cwd.device !== Number(cwd.dev)
        || record.launch_cwd.inode !== Number(cwd.ino) || (cwd.mode & 0o777) !== 0o700) throw new Error("strict cwd mismatch");
    const finalPath = join(args[9]!, "handover", args[11]!, "final.json");
    const final = safeJson(finalPath);
    if (domainHash("handover-final", final) !== args[13]) throw new Error("handover final mismatch");
    const listener = new URL(args[17]!); const pid = process.pid, startTicks = processStartTicks();
    const abi = { protocol: 1, state: "abi", pid, start_ticks: startTicks, listener: args[17], strict_server_id: record.id, strict_server_record_sha256: args[7], artifact_sha256: record.artifact.sha256, maw_commit: record.maw_commit, maw_tree: record.maw_tree, source_closure_sha256: record.source_closure_sha256, handler_abi: record.handler_abi, bootstrap_protocol: record.bootstrap_protocol, fresh_command_read: record.fresh_command_read, runtime_plugins: record.runtime_plugins, runtime_autoload: record.runtime_autoload };
    const selected = (): boolean => {
      const handoverRoot = join(args[9]!, "handover", args[11]!);
      const pointer = safeJson(join(handoverRoot, "selection-current.json"));
      const selectionPath = join(handoverRoot, "strict-selections", `${pointer.selection_id}.json`);
      const selection = safeJson(selectionPath);
      // Cross-runtime Unix-nanosecond integers exceed JavaScript's exact
      // numeric range.  Authority hashes therefore use the already validated
      // canonical record bytes rather than re-serializing parsed numbers.
      if (pointer.selection_sha256 !== canonicalFileDomainHash("handover-strict-selection", selectionPath)
          || selection.pid !== pid || selection.start_ticks !== startTicks || selection.strict_server_id !== record.id
          || selection.strict_server_record_sha256 !== args[7] || selection.listener !== args[17]
          || selection.handover_final_sha256 !== args[13]) return false;
      const install = safeJson(join(args[9]!, "installs", `${args[15]}.strict.json`));
      return ["strict-bound", "complete"].includes(install.state) && install.strict_selection_id === pointer.selection_id
        && install.strict_selection_sha256 === pointer.selection_sha256 && install.strict_server_pid === pid
        && install.strict_server_start_ticks === startTicks && install.handover_final_sha256 === args[13];
    };
    Bun.serve({ hostname: "127.0.0.1", port: Number(listener.port), async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/integration/abi" && request.method === "GET") return Response.json(abi);
      try {
        // Selection is reopened for every request.  A stale/dead/superseded
        // process never reaches config, wake, tmux, or plugin authority.
        if (!selected()) throw new Error("stale selection");
        if (url.pathname === "/healthz" && request.method === "GET") {
          return Response.json({ protocol: 1, ok: true, selection: "current" });
        }
        if (url.pathname === "/api/status" && request.method === "GET") {
          return Response.json({ protocol: 1, ok: true, selection: "current", handler_abi: "strict-wake-v1" });
        }
        if (url.pathname === "/api/wake" && request.method === "POST") {
          const body = await strictBody(request);
          if (!exactKeys(body, ["target", "task", "engine", "incubate", "repo_path"])) return Response.json({ ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 400 });
          if (body.engine !== undefined && body.engine !== "codex-*") return Response.json({ ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 400 });
          if (body.incubate !== undefined && typeof body.incubate !== "string" && typeof body.incubate !== "boolean") return Response.json({ ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 400 });
          if (body.repo_path !== undefined && typeof body.repo_path !== "string") return Response.json({ ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 400 });
          const resolved = await orchestrateStrictWake({ target: body.target as string, task: body.task as string | undefined, engine: body.engine as "codex-*" | undefined, incubate: body.incubate as string | boolean | undefined, repoPath: body.repo_path as string | undefined });
          return Response.json({ ok: true, target: resolved });
        }
        if (url.pathname === "/api/send" && request.method === "POST") {
          const body = await strictBody(request);
          if (!exactKeys(body, ["target", "text", "message", "wake"])) return Response.json({ ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 400 });
          const target = typeof body.target === "string" ? body.target : "";
          const message = typeof body.text === "string" ? body.text : typeof body.message === "string" ? body.message : "";
          if (!target || target.length > 512 || !message || Buffer.byteLength(message) > 64 * 1024 || (body.wake !== undefined && typeof body.wake !== "boolean")) return Response.json({ ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 400 });
          const destination = strictTarget(target);
          try {
            const cwd = await strictPaneCwd(destination);
            await strictTmux.sendText(destination, message, { requiredCwd: cwd });
          } catch {
            return Response.json({ ok: false, code: "SDA-MCP-E-TMUX-AMBIGUOUS" }, { status: 409 });
          }
          return Response.json({ ok: true, target: destination });
        }
        return Response.json({ protocol: 1, ok: false, code: "SDA-MCP-E-SCHEMA" }, { status: 404 });
      } catch {
        return Response.json({ protocol: 1, ok: false, code: "SDA-MCP-E-RECOVERY" }, { status: 503 });
      }
    } });
    await new Promise(() => {});
    return 0;
  } catch {
    process.stderr.write("SDA-MCP-E-ABI strict-server validation failed\n"); return 78;
  }
}
