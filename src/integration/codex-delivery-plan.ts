/** Central strict planner for the frozen protocol-v1 maw Codex route. */
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from "fs";
import { dirname, join } from "path";
import { createHash, randomBytes } from "crypto";
import { dlopen, FFIType } from "bun:ffi";
import { consumeIntegratedReadonly, restoreIntegratedReadonly } from "../config/codex-trust";
import { parseJsonStrict } from "../config/transaction";
import { CONFIG_FILE } from "../core/paths";

/** @internal fail-closed boundary shared with focused regression tests. */
export function requireIntegratedReadonlyAuthority(requested: string | undefined, consumed: boolean): boolean {
  if (requested !== undefined && !consumed) throw new Error("SDA-MCP-E-AUTH readonly launch authority mismatch");
  return consumed;
}

export const INTEGRATED_ROUTE = /^SDA_CODEX_MCP_HOME='(\/[A-Za-z0-9._/-]+)' PATH='\1\/bin':"\$\{PATH-\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin\}" codex -a never -s workspace-write$/;
const ffi = dlopen("libc.so.6", {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  dup: { args: [FFIType.i32], returns: FFIType.i32 },
  dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});
const DELIVERY_ENV = new Set([
  "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG", "TZ",
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "SSH_AUTH_SOCK",
  "DBUS_SESSION_BUS_ADDRESS", "TMPDIR", "TMP", "TEMP", "NO_COLOR", "FORCE_COLOR",
  "PATH", "TMUX", "TMUX_PANE",
]);
function closedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (DELIVERY_ENV.has(key) || /^LC_[A-Z_]+$/.test(key))) env[key] = value;
  }
  return env;
}
const sha = (domain: string, bytes: Uint8Array | string) => createHash("sha256").update(`${domain}\0`).update(bytes).digest("hex");
const rawSha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const canonical = (value: Record<string, unknown>) => Buffer.from(`${JSON.stringify(stable(value))}\n`);

function jsonFile(path: string): Record<string, any> {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || !st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600) throw new Error("unsafe integration record");
  const value = parseJsonStrict(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("record shape");
  return value as Record<string, any>;
}
function trustSnapshot(home: string): string {
  const path = join(home, ".codex/config.toml");
  if (!existsSync(path)) return rawSha(Buffer.alloc(0));
  const st = lstatSync(path);
  if (st.isSymbolicLink() || !st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600) throw new Error("SDA-MCP-E-TRUST trust config unsafe");
  return rawSha(readFileSync(path));
}
function writeNew(path: string, value: Record<string, unknown>): Buffer {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const raw = canonical(value);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < raw.length) {
      const written = writeSync(fd, raw, offset, raw.length - offset);
      if (written <= 0) throw new Error("SDA-MCP-E-IO short immutable write");
      offset += written;
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  if (!readFileSync(path).equals(raw)) throw new Error("SDA-MCP-E-IO immutable write verification failed");
  const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
  return raw;
}
function exactConfig(command: string): Buffer {
  const fd = openSync(CONFIG_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const node = fstatSync(fd);
    if (!node.isFile() || node.uid !== process.getuid?.()) throw new Error("SDA-MCP-E-CAS config unsafe");
    const raw = readFileSync(fd);
    const config = parseJsonStrict(raw.toString("utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)
        || (config as any).commands?.["codex-*"] !== command) throw new Error("SDA-MCP-E-CAS configured route changed");
    return raw;
  } finally { closeSync(fd); }
}
function rpc(port: string, args: string[], input?: Record<string, unknown>, integrationHome?: string): Record<string, any> {
  const env = closedEnvironment();
  if (integrationHome) env.SDA_CODEX_MCP_HOME = integrationHome;
  const result = Bun.spawnSync({ cmd: [port, ...args], stdin: input ? canonical(input) : undefined, stdout: "pipe", stderr: "pipe", env, timeout: 15_000 });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).split(/\s/, 1)[0] || "port failed");
  const value = parseJsonStrict(new TextDecoder().decode(result.stdout).trim());
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("port response invalid");
  return value as Record<string, any>;
}

async function guardianReady(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const next = await Promise.race([
        reader.read(),
        Bun.sleep(5_000).then(() => { throw new Error("SDA-MCP-E-DELIVERY guardian ready timeout"); }),
      ]);
      if (next.done) throw new Error("SDA-MCP-E-DELIVERY guardian exited before readiness");
      const chunk = Buffer.from(next.value); size += chunk.length;
      if (size > 64) throw new Error("SDA-MCP-E-DELIVERY guardian acknowledgement too large");
      chunks.push(chunk);
      const value = Buffer.concat(chunks);
      const newline = value.indexOf(0x0a);
      if (newline >= 0) {
        if (newline !== value.length - 1 || value.toString("utf8") !== "SDA-MCP-GUARDIAN-READY-v1\n") throw new Error("SDA-MCP-E-DELIVERY guardian ready acknowledgement invalid");
        return;
      }
    }
  } finally { reader.releaseLock(); }
}

export async function planIntegratedDelivery(
  target: string, command: string,
  tmuxProbe: (target: string) => Promise<{ socket: string; serverPid: number; serverStartTicks: number; session: string; pane: string; cwd: string; tmuxEnv: string }>,
  readonlyAuthority?: string,
): Promise<{ payload: string; launchId: string; guardian: Subprocess; authorizeDispatch: () => Promise<void>; abort: () => Promise<void>; readiness: Promise<void> } | null> {
  const match = command.match(INTEGRATED_ROUTE);
  if (!match) return null;
  const integrationHome = match[1]!;
  const home = process.env.HOME;
  if (!home?.startsWith("/")) throw new Error("SDA-MCP-E-PATH HOME invalid");
  const bootstrap = jsonFile(join(home, ".config/sda-script/codex-mcp-bootstrap-v1.json"));
  const admissionFd = openSync(bootstrap.admission_lock, constants.O_RDWR | constants.O_NOFOLLOW);
  const admission = fstatSync(admissionFd);
  if (!admission.isFile() || (admission.mode & 0o777) !== 0o600 || Number(admission.dev) !== bootstrap.admission_lock_device || Number(admission.ino) !== bootstrap.admission_lock_inode) { closeSync(admissionFd); throw new Error("SDA-MCP-E-ABI admission identity drift"); }
  try {
    for (const [path, device, inode, digest] of [[bootstrap.maw_control, bootstrap.maw_control_device, bootstrap.maw_control_inode, bootstrap.maw_control_sha256], [bootstrap.helper_runtime, bootstrap.helper_runtime_device, bootstrap.helper_runtime_inode, bootstrap.helper_runtime_sha256]] as [string, number, number, string][]) {
      const node = lstatSync(path);
      if (node.isSymbolicLink() || !node.isFile() || Number(node.dev) !== device || Number(node.ino) !== inode || rawSha(readFileSync(path)) !== digest || (node.mode & 0o022)) throw new Error("SDA-MCP-E-ABI helper identity drift");
    }
  } catch (error) { closeSync(admissionFd); throw error; }
  let admitted = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (ffi.symbols.flock(admissionFd, 2 | 4) === 0) { admitted = true; break; }
    await Bun.sleep(50);
  }
  if (!admitted) { closeSync(admissionFd); throw new Error("SDA-MCP-E-LOCK admission timeout"); }
  const wakeId = randomBytes(16).toString("hex"), launchId = randomBytes(16).toString("hex");
  let readonly = false;
  let paneCwd = "";
  try {
    const configRaw = exactConfig(command);
    const pane = await tmuxProbe(target);
    paneCwd = pane.cwd;
    const port = join(integrationHome, "bin/codex");
    readonly = requireIntegratedReadonlyAuthority(
      readonlyAuthority,
      consumeIntegratedReadonly(readonlyAuthority, target, pane.cwd),
    );
    const preflight = rpc(port, ["--sda-preflight", "--protocol", "1", "--mode", readonly ? "readonly" : "ensure", "--wake-id", wakeId, "--launch-id", launchId, "--cwd", pane.cwd], undefined, integrationHome);
    if (!["non-git", "unregistered", "registered-exact"].includes(preflight.classification)) throw new Error("SDA-MCP-E-SCHEMA preflight classification invalid");
    const trust = preflight.classification === "registered-exact"
      ? rpc(port, ["--sda-trust", "--protocol", "1", "--mode", readonly ? "readonly" : "ensure", "--repo-root", pane.cwd], undefined, integrationHome)
      : (() => { const digest = trustSnapshot(home); return { trust_changed: false, trust_pre_sha256: digest, trust_post_sha256: digest, trust_pre_present: existsSync(join(home, ".codex/config.toml")) }; })();
    const commitRequest = { protocol: 1, wake_id: wakeId, launch_id: launchId, prepared_receipt_sha256: preflight.prepared_receipt_sha256, trust_changed: trust.trust_changed, trust_pre_sha256: trust.trust_pre_sha256, trust_post_sha256: trust.trust_post_sha256, trust_pre_present: trust.trust_pre_present };
    const stateRoot = bootstrap.state_root;
    const socketHash = sha("sda-tmux-socket-v1", pane.socket);
    const deliveryId = randomBytes(16).toString("hex");
    const execution = `SDA_CODEX_MCP_WAKE_ID='${wakeId}' SDA_CODEX_MCP_LAUNCH_ID='${launchId}' ${command}`;
    const pending = { protocol: 1, delivery_id: deliveryId, wake_id: wakeId, launch_id: launchId, tmux_socket: pane.socket, tmux_socket_sha256: socketHash, tmux_server_pid: pane.serverPid, tmux_server_start_ticks: pane.serverStartTicks, tmux_session_id: pane.session, tmux_raw_session_number: pane.session.slice(1), tmux_pane: pane.pane, tmux_env_sha256: sha("sda-delivery-env-tmux-v1", pane.tmuxEnv), tmux_pane_env_sha256: sha("sda-delivery-env-tmux-pane-v1", pane.pane), pane_cwd: pane.cwd, helper_path: bootstrap.maw_control, helper_device: bootstrap.maw_control_device, helper_inode: bootstrap.maw_control_inode, helper_sha256: bootstrap.maw_control_sha256, helper_runtime_path: bootstrap.helper_runtime, helper_runtime_sha256: bootstrap.helper_runtime_sha256, maw_config_sha256: rawSha(configRaw), configured_command: command, configured_command_sha256: sha("sda-delivery-configured-command-v1", command), execution_command_sha256: sha("sda-delivery-execution-command-v1", execution), admission_lock_device: bootstrap.admission_lock_device, admission_lock_inode: bootstrap.admission_lock_inode, created_unix_ns: Date.now() * 1_000_000 };
    const dir = join(bootstrap.delivery_root, deliveryId);
    const pendingRaw = writeNew(join(dir, "pending.json"), pending);
    let committedReceiptSha256 = "";
    try {
      rpc(port, ["--sda-commit-trust", "--protocol", "1", "--stdin-json"], commitRequest, integrationHome);
      const committedRaw = readFileSync(join(stateRoot, "wakes", wakeId, `${launchId}.committed.json`));
      committedReceiptSha256 = rawSha(committedRaw);
      const bindRequest = { protocol: 1, wake_id: wakeId, launch_id: launchId, committed_receipt_sha256: committedReceiptSha256, tmux_socket: pane.socket, tmux_socket_sha256: socketHash, tmux_server_pid: pane.serverPid, tmux_server_start_ticks: pane.serverStartTicks, tmux_pane: pane.pane, repo_cwd: pane.cwd, rewake_argv: ["wake", target, "--engine", "codex-*"] };
      rpc(port, ["--sda-bind-dispatch", "--protocol", "1", "--stdin-json"], bindRequest, integrationHome);
    } catch (error) {
      let terminalSha = "";
      if (committedReceiptSha256) {
        try {
          const { reconcileDelivery } = await import("./delivery");
          await reconcileDelivery(deliveryId, async () => { throw new Error("not-sent must not observe runtime"); }, false);
          terminalSha = rawSha(readFileSync(join(dir, "terminal.json")));
        } catch { throw new Error("SDA-MCP-E-TRUST-REMEDIATE delivery compensation failed"); }
      }
      const abortRequest = { ...commitRequest, committed_receipt_sha256: committedReceiptSha256, ...(terminalSha ? { delivery_id: deliveryId, delivery_terminal_sha256: terminalSha } : {}) };
      try {
        rpc(port, ["--sda-abort-trust", "--protocol", "1", "--stdin-json"], abortRequest, integrationHome);
      } catch {
        throw new Error("SDA-MCP-E-TRUST-REMEDIATE receipt compensation failed");
      }
      throw error;
    }
    const payload = `'${bootstrap.maw_control}' delivery-exec --protocol 1 --id '${deliveryId}'`;
    const stdio: any[] = ["ignore", "pipe", "pipe"];
    while (stdio.length < 15) stdio.push("ignore"); stdio.push("inherit");
    let saved15 = -2;
    let guardian: Subprocess | undefined;
    try {
      saved15 = admissionFd === 15 ? -1 : ffi.symbols.dup(15);
      if (ffi.symbols.dup2(admissionFd, 15) !== 15) throw new Error("SDA-MCP-E-ABI guardian lease dup failed");
      guardian = Bun.spawn({ cmd: [bootstrap.maw_control, "delivery-guardian", "--protocol", "1", "--id", deliveryId], env: closedEnvironment(), stdio });
      await guardianReady(guardian.stdout as ReadableStream<Uint8Array>);
    } catch (error) {
      if (guardian) {
        guardian.kill();
        await guardian.exited;
      }
      const { reconcileDelivery } = await import("./delivery");
      await reconcileDelivery(deliveryId, async () => { throw new Error("not-sent must not observe runtime"); }, false);
      const terminalRaw = readFileSync(join(dir, "terminal.json"));
      rpc(port, ["--sda-abort-trust", "--protocol", "1", "--stdin-json"], { ...commitRequest, committed_receipt_sha256: committedReceiptSha256, delivery_id: deliveryId, delivery_terminal_sha256: rawSha(terminalRaw) }, integrationHome);
      throw error;
    } finally {
      if (saved15 >= 0) { ffi.symbols.dup2(saved15, 15); closeSync(saved15); } else if (saved15 === -1) { try { closeSync(15); } catch {} }
    }
    // The guardian now owns the only task-side duplicate.  Closing the
    // planner's descriptor lets the lease release exactly when terminal proof
    // appears, even in a long-lived maw server.
    if (admissionFd !== 15) closeSync(admissionFd);
    // Once send-prepared exists, an exception from tmux is ambiguous.  The
    // contract deliberately keeps the delivery nonterminal and the guardian
    // lease held until an authenticated execution or non-execution proof is
    // published by recovery tooling.
    const readiness = waitForDeliveryReadiness(dir, deliveryId, wakeId, launchId);
    let authorized = false;
    const cancelBeforeSend = async (): Promise<void> => {
      if (authorized) return;
      guardian!.kill();
      await guardian!.exited;
      const { reconcileDelivery } = await import("./delivery");
      await reconcileDelivery(deliveryId, async () => { throw new Error("not-sent must not observe runtime"); }, false);
      const terminalRaw = readFileSync(join(dir, "terminal.json"));
      rpc(port, ["--sda-abort-trust", "--protocol", "1", "--stdin-json"], { ...commitRequest, committed_receipt_sha256: committedReceiptSha256, delivery_id: deliveryId, delivery_terminal_sha256: rawSha(terminalRaw) }, integrationHome);
    };
    const authorizeDispatch = async (): Promise<void> => {
      if (authorized) return;
      try {
        const current = exactConfig(command);
        if (rawSha(current) !== pending.maw_config_sha256) throw new Error("SDA-MCP-E-CAS configured route bytes changed");
        writeNew(join(dir, "send-prepared.json"), { protocol: 1, delivery_id: deliveryId, state: "send-prepared", pending_sha256: sha("sda-delivery-pending-v1", pendingRaw.subarray(0, pendingRaw.length - 1)), execution_command_sha256: pending.execution_command_sha256, tmux_payload_sha256: sha("sda-delivery-tmux-payload-v1", payload), prepared_unix_ns: Date.now() * 1_000_000 });
        authorized = true;
      } catch (error) {
        await cancelBeforeSend();
        throw error;
      }
    };
    return { payload, launchId, guardian: guardian!, authorizeDispatch, abort: cancelBeforeSend, readiness };
  } catch (error) {
    if (readonly && readonlyAuthority && paneCwd) restoreIntegratedReadonly(readonlyAuthority, target, paneCwd);
    try {
      const directory = join(bootstrap.state_root, "wakes", wakeId);
      if (existsSync(directory) && !existsSync(join(directory, `${launchId}.launch.json`)) && !existsSync(join(directory, `${launchId}.aborted.json`))) {
        writeNew(join(directory, `${launchId}.aborted.json`), { protocol: 1, wake_id: wakeId, launch_id: launchId, state: "aborted", code: "SDA-MCP-E-DELIVERY" });
      }
    } catch {}
    ffi.symbols.flock(admissionFd, 8); closeSync(admissionFd); throw error;
  }
}

const readinessByLaunch = new Map<string, Promise<void>>();

function authenticatedRecord(path: string): { value: Record<string, any>; raw: Buffer } {
  const raw = readFileSync(path);
  const value = jsonFile(path);
  return { value, raw };
}

async function waitForDeliveryReadiness(dir: string, deliveryId: string, wakeId: string, launchId: string): Promise<void> {
  const terminalPath = join(dir, "terminal.json");
  for (let attempt = 0; attempt < 2400; attempt++) {
    if (existsSync(terminalPath)) {
      const { value: pointer } = authenticatedRecord(terminalPath);
      if (pointer.protocol !== 1 || pointer.delivery_id !== deliveryId || typeof pointer.terminal !== "string" || !/^(started|cancelled|failed-before-start)\.json$/.test(pointer.terminal)) throw new Error("SDA-MCP-E-DELIVERY terminal pointer invalid");
      const terminalPathResolved = join(dir, pointer.terminal);
      const { value: terminal } = authenticatedRecord(terminalPathResolved);
      const terminalKind = pointer.terminal.slice(0, -5);
      const terminalRaw = canonical(terminal);
      if (sha(`sda-delivery-${terminalKind}-v1`, terminalRaw.subarray(0, terminalRaw.length - 1)) !== pointer.terminal_sha256
          || terminal.delivery_id !== deliveryId) throw new Error("SDA-MCP-E-DELIVERY terminal authentication failed");
      if (pointer.terminal !== "started.json") throw new Error(`SDA-MCP-E-DELIVERY ${terminal.state ?? "failed"}`);
      if (!['adapter-start', 'native-start'].includes(terminal.proof_kind)) throw new Error("SDA-MCP-E-DELIVERY start proof invalid");
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error("SDA-MCP-E-DELIVERY readiness timeout");
}

export function registerIntegratedReadiness(launchId: string, readiness: Promise<void>): void {
  readinessByLaunch.set(launchId, readiness);
  // Keep an already-settled proof available for the prompt-stage caller. The
  // consumer removes its exact launch entry; a bounded TTL covers launches
  // that never have a stage-two prompt.
  const expiry = setTimeout(() => { if (readinessByLaunch.get(launchId) === readiness) readinessByLaunch.delete(launchId); }, 10 * 60_000);
  expiry.unref?.();
  void readiness.catch(() => {});
}

export async function waitForIntegratedReadiness(launchId: string): Promise<void> {
  const readiness = readinessByLaunch.get(launchId);
  if (!readiness) throw new Error("SDA-MCP-E-DELIVERY readiness proof absent");
  try { await readiness; }
  finally { if (readinessByLaunch.get(launchId) === readiness) readinessByLaunch.delete(launchId); }
}
