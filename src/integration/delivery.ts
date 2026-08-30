/** Durable protocol-v1 in-pane delivery helper used by compiled maw-control. */
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync, fsyncSync, constants } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { dlopen, FFIType } from "bun:ffi";
import { parseJsonStrict } from "../config/transaction";

const ID = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{64}$/;
const DELIVERY_ENV = new Set([
  "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG", "TZ",
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "SSH_AUTH_SOCK",
  "DBUS_SESSION_BUS_ADDRESS", "TMPDIR", "TMP", "TEMP", "NO_COLOR", "FORCE_COLOR",
  "PATH", "TMUX", "TMUX_PANE",
]);
const libc = dlopen("libc.so.6", {
  memfd_create: { args: [FFIType.cstring, FFIType.u32], returns: FFIType.i32 },
  dup: { args: [FFIType.i32], returns: FFIType.i32 },
  dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});
const hash = (domain: string, value: string) => createHash("sha256").update(`${domain}\0${value}`).digest("hex");
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const jcs = (value: unknown) => JSON.stringify(stable(value));
const shaFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function closedEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (DELIVERY_ENV.has(key) || /^LC_[A-Z_]+$/.test(key))) env[key] = value;
  }
  return { ...env, ...extra };
}

function processStartTicks(): number {
  return processStartTicksFor(process.pid);
}

function processStartTicksFor(pid: number): number {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = text.lastIndexOf(")");
  return Number(text.slice(end + 2).split(" ")[19]);
}

function proofProcessIsLive(pid: number, startTicks: number): boolean {
  try { return processStartTicksFor(pid) === startTicks; } catch { return false; }
}

function cgroupIdentity(unit: string): { path: string; device: number; inode: number } {
  const line = readFileSync("/proc/self/cgroup", "utf8").trim();
  const path = line.split(":", 3)[2] ?? "";
  if (!path.startsWith("/") || !path.includes(`/${unit}`)) throw new Error("scope cgroup mismatch");
  const st = statSync(join("/sys/fs/cgroup", path));
  return { path, device: Number(st.dev), inode: Number(st.ino) };
}

function safeJson(path: string): Record<string, any> {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || !st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600) throw new Error("unsafe record");
  // Durable protocol-v1 records froze nanosecond timestamps as JSON numbers.
  // Config parsing remains exact/safe-integer only; this compatibility carve-
  // out applies solely to authenticated protocol records.
  const value = parseJsonStrict(readFileSync(path, "utf8"), { allowUnsafeIntegers: true });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid record");
  return value as Record<string, any>;
}

function writeNew(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const raw = Buffer.from(`${jcs(value)}\n`);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < raw.length) {
      const written = writeSync(fd, raw, offset, raw.length - offset);
      if (written <= 0) throw new Error("short immutable write");
      offset += written;
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  if (!readFileSync(path).equals(raw)) throw new Error("immutable write verification failed");
  const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function startProof(stateRoot: string, pending: Record<string, any>): { kind: "adapter-start" | "native-start"; path: string; raw: Buffer } | null {
  if (existsSync(join(stateRoot, "deliveries", pending.delivery_id, "nonexecution-proof.json"))) throw new Error("start proof competes with nonexecution proof");
  const wakeDir = join(stateRoot, "wakes", pending.wake_id);
  const launchPath = join(wakeDir, `${pending.launch_id}.launch.json`);
  const launchRaw = readFileSync(launchPath); safeJson(launchPath);
  const launchSha = createHash("sha256").update(launchRaw).digest("hex");
  const adapterPath = join(wakeDir, `${pending.launch_id}.adapter-start.json`);
  if (existsSync(adapterPath)) {
    const raw = readFileSync(adapterPath), proof = safeJson(adapterPath);
    const workerPath = join(stateRoot, "workers", `${pending.launch_id}.json`);
    const workerRaw = readFileSync(workerPath), worker = safeJson(workerPath);
    if (proof.protocol !== 1 || proof.wake_id !== pending.wake_id || proof.launch_id !== pending.launch_id
        || proof.state !== "adapter-start-ready" || proof.launch_record_sha256 !== launchSha
        || proof.worker_sha256 !== createHash("sha256").update(workerRaw).digest("hex")
        || worker.protocol !== 1 || worker.wake_id !== pending.wake_id || worker.launch_id !== pending.launch_id
        || worker.state !== "native-start-ready" || worker.launch_record_sha256 !== launchSha
        || worker.pid !== proof.pid || worker.start_ticks !== proof.start_ticks
        || worker.native_sha256 !== proof.native_sha256) throw new Error("adapter start proof mismatch");
    return proofProcessIsLive(proof.pid, proof.start_ticks) ? { kind: "adapter-start", path: adapterPath, raw } : null;
  }
  const nativePath = join(wakeDir, `${pending.launch_id}.native-start.json`);
  if (existsSync(nativePath)) {
    const raw = readFileSync(nativePath), proof = safeJson(nativePath);
    if (proof.protocol !== 1 || proof.wake_id !== pending.wake_id || proof.launch_id !== pending.launch_id
        || proof.state !== "native-start-ready" || proof.launch_record_sha256 !== launchSha
        || !SHA.test(proof.native_sha256) || !Number.isSafeInteger(proof.pid) || proof.pid < 1
        || !Number.isSafeInteger(proof.start_ticks) || proof.start_ticks < 1) throw new Error("native start proof mismatch");
    return proofProcessIsLive(proof.pid, proof.start_ticks) ? { kind: "native-start", path: nativePath, raw } : null;
  }
  return null;
}

/** @internal authenticated proof probe used by isolated regression tests. */
export function validateStartProofForTest(stateRoot: string, pending: Record<string, any>): string | null {
  return startProof(stateRoot, pending)?.kind ?? null;
}

function writeOrVerify(path: string, value: Record<string, unknown>): void {
  if (existsSync(path)) {
    if (jcs(safeJson(path)) !== jcs(value)) throw new Error("immutable record collision");
    return;
  }
  writeNew(path, value);
}

function validateAdmissionLease(bootstrap: Record<string, any>): void {
  // /proc/self/fd/15 is necessarily a procfs symlink; follow it to attest the
  // inherited open-file description against the write-once lock inode.
  const lock = statSync("/proc/self/fd/15");
  if (!lock.isFile() || (lock.mode & 0o777) !== 0o600
      || Number(lock.dev) !== bootstrap.admission_lock_device
      || Number(lock.ino) !== bootstrap.admission_lock_inode) throw new Error("admission lease invalid");
  const probe = openSync(bootstrap.admission_lock, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const node = fstatSync(probe);
    if (Number(node.dev) !== bootstrap.admission_lock_device || Number(node.ino) !== bootstrap.admission_lock_inode) throw new Error("admission lock identity drift");
    // A different open-file description must be excluded, while the inherited
    // fd15 description must be able to renew/convert its own exclusive lease.
    if (libc.symbols.flock(probe, 2 | 4) === 0) {
      libc.symbols.flock(probe, 8);
      throw new Error("admission fd has no live flock lease");
    }
    if (libc.symbols.flock(15, 2 | 4) !== 0) throw new Error("admission inherited lease unavailable");
  } finally { closeSync(probe); }
}

type DeliveryObservation = { observed_unix_ns: number; pane_present: boolean; scope_state: "absent" | "empty" };
export type DeliveryObserver = (pending: Record<string, any>, executing?: Record<string, any>) => Promise<Omit<DeliveryObservation, "observed_unix_ns">>;

function validatePrepared(pending: Record<string, any>, prepared: Record<string, any>): string {
  const pendingSha = hash("sda-delivery-pending-v1", jcs(pending));
  if (prepared.protocol !== 1 || prepared.delivery_id !== pending.delivery_id || prepared.state !== "send-prepared"
      || prepared.pending_sha256 !== pendingSha || prepared.execution_command_sha256 !== pending.execution_command_sha256) {
    throw new Error("send-prepared chain mismatch");
  }
  return pendingSha;
}

function validateExecuting(prepared: Record<string, any>, executing: Record<string, any>): string {
  const executingSha = hash("sda-delivery-executing-v1", jcs(executing));
  if (executing.protocol !== 1 || executing.delivery_id !== prepared.delivery_id || executing.state !== "executing"
      || executing.pending_sha256 !== prepared.pending_sha256
      || executing.send_prepared_sha256 !== hash("sda-delivery-send-prepared-v1", jcs(prepared))) {
    throw new Error("executing chain mismatch");
  }
  return executingSha;
}

function validateNonexecutionProof(
  pending: Record<string, any>, prepared: Record<string, any> | undefined,
  executing: Record<string, any> | undefined, proof: Record<string, any>,
): void {
  const pendingSha = hash("sda-delivery-pending-v1", jcs(pending));
  const preparedSha = prepared ? hash("sda-delivery-send-prepared-v1", jcs(prepared)) : "";
  const executingSha = executing ? hash("sda-delivery-executing-v1", jcs(executing)) : "";
  if (proof.protocol !== 1 || proof.delivery_id !== pending.delivery_id || proof.state !== "nonexecution-proof"
      || proof.pending_sha256 !== pendingSha || proof.send_prepared_sha256 !== preparedSha
      || proof.executing_sha256 !== executingSha || proof.tmux_socket_sha256 !== pending.tmux_socket_sha256
      || proof.tmux_server_pid !== pending.tmux_server_pid || proof.tmux_server_start_ticks !== pending.tmux_server_start_ticks
      || proof.tmux_pane !== pending.tmux_pane || typeof proof.code !== "string" || !/^SDA-MCP-E-[A-Z0-9-]+$/.test(proof.code)) {
    throw new Error("nonexecution proof mismatch");
  }
  const observations = proof.observations;
  if (!Array.isArray(observations)) throw new Error("observations invalid");
  if (proof.kind === "not-sent") {
    if (prepared || executing || proof.failure_event_sha256 !== "" || proof.systemd_unit !== ""
        || proof.cgroup_path !== "" || observations.length !== 0) throw new Error("not-sent proof invalid");
    return;
  }
  if (!prepared || observations.length !== 2
      || !Number.isInteger(observations[0]?.observed_unix_ns)
      || !Number.isInteger(observations[1]?.observed_unix_ns)
      || observations[1].observed_unix_ns - observations[0].observed_unix_ns < 500_000_000) {
    throw new Error("observation fence invalid");
  }
  if (proof.kind === "pane-retired") {
    if (executing || proof.failure_event_sha256 !== "" || proof.systemd_unit !== `sda-maw-delivery-${pending.delivery_id}.scope`
        || proof.cgroup_path !== "" || observations.some((item: any) => item.pane_present !== false || !["absent", "empty"].includes(item.scope_state))) {
      throw new Error("pane-retired proof invalid");
    }
    return;
  }
  if (proof.kind === "child-failed") {
    if (!executing || proof.systemd_unit !== executing.systemd_unit || proof.cgroup_path !== executing.cgroup_path
        || observations.some((item: any) => !["absent", "empty"].includes(item.scope_state))) throw new Error("child-failed proof invalid");
    const failure = safeJson(join(dirname(proof.proof_path ?? ""), "failure-event.json"));
    if (failure.protocol !== 1 || failure.delivery_id !== pending.delivery_id || failure.state !== "failure-event"
        || failure.pending_sha256 !== pendingSha || failure.executing_sha256 !== executingSha
        || !["before-command-exec", "child-exited-before-start-proof"].includes(failure.phase)
        || proof.failure_event_sha256 !== hash("sda-delivery-failure-event-v1", jcs(failure))) throw new Error("failure event mismatch");
    return;
  }
  throw new Error("unknown nonexecution proof kind");
}

export function validateDeliveryTerminal(dir: string, id: string, stateRoot: string): boolean {
  const pointer = safeJson(join(dir, "terminal.json"));
  if (pointer.protocol !== 1 || pointer.delivery_id !== id
      || !["started.json", "cancelled.json", "failed-before-start.json"].includes(pointer.terminal)) throw new Error("unsupported terminal transition");
  const terminals = ["started.json", "cancelled.json", "failed-before-start.json"].filter(name => existsSync(join(dir, name)));
  if (terminals.length !== 1 || terminals[0] !== pointer.terminal) throw new Error("terminal collision");
  const pending = safeJson(join(dir, "pending.json"));
  if (pending.protocol !== 1 || pending.delivery_id !== id) throw new Error("pending mismatch");
  if (pointer.terminal === "started.json") {
    const prepared = safeJson(join(dir, "send-prepared.json")); validatePrepared(pending, prepared);
    const executing = safeJson(join(dir, "executing.json")); validateExecuting(prepared, executing);
    const started = safeJson(join(dir, "started.json"));
    if (started.protocol !== 1 || started.delivery_id !== id || started.state !== "started"
        || started.pending_sha256 !== prepared.pending_sha256
        || started.executing_sha256 !== hash("sda-delivery-executing-v1", jcs(executing))
        || pointer.terminal_sha256 !== hash("sda-delivery-started-v1", jcs(started))) throw new Error("started chain mismatch");
    const proof = startProof(stateRoot, pending);
    if (!proof || started.proof_kind !== proof.kind || started.proof_path !== proof.path
        || started.proof_sha256 !== createHash("sha256").update(proof.raw).digest("hex")) throw new Error("start proof mismatch");
    return true;
  }
  const terminal = safeJson(join(dir, pointer.terminal));
  const prepared = existsSync(join(dir, "send-prepared.json")) ? safeJson(join(dir, "send-prepared.json")) : undefined;
  if (prepared) validatePrepared(pending, prepared);
  const executing = existsSync(join(dir, "executing.json")) ? safeJson(join(dir, "executing.json")) : undefined;
  if (executing) {
    if (!prepared) throw new Error("executing without preparation");
    validateExecuting(prepared, executing);
  }
  const proofPath = join(dir, "nonexecution-proof.json");
  if (terminal.proof_path !== proofPath) throw new Error("nonexecution locator mismatch");
  const proof = safeJson(proofPath);
  // The path is carried into validation only to locate the sibling immutable
  // failure event; it is not persisted in the exact proof schema.
  validateNonexecutionProof(pending, prepared, executing, { ...proof, proof_path: proofPath });
  const terminalName = pointer.terminal.slice(0, -5);
  const expectedState = pointer.terminal === "cancelled.json" ? "cancelled" : "failed-before-start";
  if (terminal.protocol !== 1 || terminal.delivery_id !== id || terminal.state !== expectedState
      || terminal.pending_sha256 !== hash("sda-delivery-pending-v1", jcs(pending))
      || terminal.send_prepared_sha256 !== (prepared ? hash("sda-delivery-send-prepared-v1", jcs(prepared)) : "")
      || terminal.executing_sha256 !== (executing ? hash("sda-delivery-executing-v1", jcs(executing)) : "")
      || terminal.nonexecution_proof_sha256 !== hash("sda-delivery-nonexecution-proof-v1", jcs(proof))
      || terminal.code !== proof.code
      || pointer.terminal_sha256 !== hash(`sda-delivery-${terminalName}-v1`, jcs(terminal))) throw new Error("nonexecution terminal mismatch");
  if ((expectedState === "cancelled") !== (proof.kind === "not-sent")) throw new Error("terminal/proof kind mismatch");
  return true;
}

function recoverStartedPointer(dir: string, id: string, stateRoot: string): void {
  const pending = safeJson(join(dir, "pending.json"));
  if (pending.protocol !== 1 || pending.delivery_id !== id) throw new Error("pending mismatch");
  const prepared = safeJson(join(dir, "send-prepared.json")); validatePrepared(pending, prepared);
  const executing = safeJson(join(dir, "executing.json")); validateExecuting(prepared, executing);
  const started = safeJson(join(dir, "started.json"));
  if (started.protocol !== 1 || started.delivery_id !== id || started.state !== "started"
      || started.pending_sha256 !== prepared.pending_sha256
      || started.executing_sha256 !== hash("sda-delivery-executing-v1", jcs(executing))
      || !["adapter-start", "native-start"].includes(started.proof_kind)) throw new Error("started chain mismatch");
  const proof = startProof(stateRoot, pending);
  if (!proof || started.proof_kind !== proof.kind || started.proof_path !== proof.path
      || started.proof_sha256 !== createHash("sha256").update(proof.raw).digest("hex")) throw new Error("start proof mismatch");
  writeOrVerify(join(dir, "terminal.json"), {
    protocol: 1, delivery_id: id, terminal: "started.json",
    terminal_sha256: hash("sda-delivery-started-v1", jcs(started)),
  });
}

export async function runDeliveryExec(args: string[]): Promise<number> {
  if (args.join("\0") !== ["delivery-exec", "--protocol", "1", "--id", args[4] ?? ""].join("\0") || !ID.test(args[4] ?? "")) {
    process.stderr.write("SDA-MCP-E-ABI invalid delivery arguments\n"); return 78;
  }
  const id = args[4]!;
  let deliveryDir = "";
  let pendingSha = "";
  let executingSha = "";
  let childSpawned = false;
  let spawnedChild: Subprocess | undefined;
  let spawnedChildExitCode: number | null = null;
  try {
    const home = process.env.HOME;
    if (!home?.startsWith("/")) throw new Error("HOME invalid");
    const bootstrap = safeJson(join(home, ".config/sda-script/codex-mcp-bootstrap-v1.json"));
    const unit = `sda-maw-delivery-${id}.scope`;
    if (process.env.SDA_CODEX_MCP_DELIVERY_SCOPE !== id) {
      const control = realpathSync(process.execPath);
      if (control !== realpathSync(bootstrap.maw_control) || shaFile(control) !== bootstrap.maw_control_sha256) throw new Error("control identity mismatch");
      const child = Bun.spawnSync({
        cmd: ["/usr/bin/systemd-run", "--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, control, ...args],
        env: closedEnvironment({ SDA_CODEX_MCP_DELIVERY_SCOPE: id }), stdio: ["inherit", "inherit", "inherit"], timeout: 30_000,
      });
      return child.exitCode;
    }
    const cgroup = process.env.MAW_TEST_MODE === "1" ? { path: `/${unit}`, device: 1, inode: 1 } : cgroupIdentity(unit);
    const dir = join(bootstrap.delivery_root, id); deliveryDir = dir;
    const pending = safeJson(join(dir, "pending.json"));
    const prepared = safeJson(join(dir, "send-prepared.json"));
    pendingSha = prepared.pending_sha256;
    if (pending.protocol !== 1 || pending.delivery_id !== id || prepared.pending_sha256 !== hash("sda-delivery-pending-v1", jcs(pending))) throw new Error("chain mismatch");
    if (!ID.test(pending.wake_id) || !ID.test(pending.launch_id) || !SHA.test(pending.execution_command_sha256)) throw new Error("ids invalid");
    if (process.env.TMUX_PANE !== pending.tmux_pane || hash("sda-delivery-env-tmux-v1", process.env.TMUX ?? "") !== pending.tmux_env_sha256 || hash("sda-delivery-env-tmux-pane-v1", process.env.TMUX_PANE ?? "") !== pending.tmux_pane_env_sha256) throw new Error("tmux identity mismatch");
    const expectedTmux = `${pending.tmux_socket},${pending.tmux_server_pid},${pending.tmux_raw_session_number}`;
    if (process.env.TMUX !== expectedTmux || pending.tmux_session_id !== `$${pending.tmux_raw_session_number}`) throw new Error("raw tmux identity mismatch");
    if (process.env.MAW_TEST_MODE !== "1") {
      if (processStartTicksFor(pending.tmux_server_pid) !== pending.tmux_server_start_ticks) throw new Error("tmux server reused");
      const liveSession = Bun.spawnSync({ cmd: ["/usr/bin/tmux", "-S", pending.tmux_socket, "display-message", "-p", "-t", pending.tmux_pane, "#{session_id}"], stdout: "pipe", stderr: "pipe", timeout: 10_000 });
      const livePane = Bun.spawnSync({ cmd: ["/usr/bin/tmux", "-S", pending.tmux_socket, "display-message", "-p", "-t", pending.tmux_pane, "#{pane_id}"], stdout: "pipe", stderr: "pipe", timeout: 10_000 });
      if (liveSession.exitCode !== 0 || livePane.exitCode !== 0 || new TextDecoder().decode(liveSession.stdout).trim() !== pending.tmux_session_id || new TextDecoder().decode(livePane.stdout).trim() !== pending.tmux_pane) throw new Error("live tmux pane mismatch");
    }
    const command = `SDA_CODEX_MCP_WAKE_ID='${pending.wake_id}' SDA_CODEX_MCP_LAUNCH_ID='${pending.launch_id}' ${pending.configured_command}`;
    if (hash("sda-delivery-execution-command-v1", command) !== pending.execution_command_sha256) throw new Error("command hash mismatch");
    const inheritedPathSha256 = hash("sda-delivery-env-path-v1", process.env.PATH ?? "");
    const executing = { protocol: 1, delivery_id: id, state: "executing", pending_sha256: prepared.pending_sha256, send_prepared_sha256: hash("sda-delivery-send-prepared-v1", jcs(prepared)), helper_pid: process.pid, helper_start_ticks: processStartTicks(), systemd_unit: unit, cgroup_path: cgroup.path, cgroup_device: cgroup.device, cgroup_inode: cgroup.inode, inherited_path_sha256: inheritedPathSha256 };
    writeNew(join(dir, "executing.json"), executing);
    executingSha = hash("sda-delivery-executing-v1", jcs(executing));
    const script = Buffer.from(`exec 13<&- 14<&-\n${command}\n`);
    const name = Buffer.from("sda-delivery\0");
    const fd = libc.symbols.memfd_create(name, 0);
    if (fd < 0) throw new Error("memfd failed");
    // Positional write preserves the inherited file offset at zero so the
    // child can read the memfd from its beginning.
    let scriptOffset = 0;
    while (scriptOffset < script.length) {
      const written = writeSync(fd, script, scriptOffset, script.length - scriptOffset, scriptOffset);
      if (written <= 0) throw new Error("short private command write");
      scriptOffset += written;
    }
    const stdio: any[] = ["inherit", "inherit", "inherit"];
    while (stdio.length < 13) stdio.push("ignore");
    stdio.push("inherit");
    // argv contains only this fixed public prelude.  Private command bytes are
    // read completely from the memfd, then both integration fds are closed
    // before evaluation and before the configured child is resolved.
    const prelude = `IFS= read -r -d '' _s < /proc/self/fd/13 || :; exec 13<&- 14<&-; eval "$_s"`;
    // Bun's numeric stdio entries do not dup an arbitrary source fd to the
    // requested target.  Place the verified memfd at the fixed ABI number for
    // the fork window, inherit that number, then restore the helper's table.
    const saved13 = fd === 13 ? -1 : libc.symbols.dup(13);
    if (libc.symbols.dup2(fd, 13) !== 13) throw new Error("memfd dup failed");
    try {
      spawnedChild = Bun.spawn({
        cmd: ["/bin/bash", "--noprofile", "--norc", "-p", "-c", prelude], cwd: pending.pane_cwd,
        env: closedEnvironment({ SDA_CODEX_MCP_DELIVERY_ID: id, SDA_CODEX_MCP_EXECUTING_SHA256: executingSha, SDA_CODEX_MCP_PANE_PATH_SHA256: inheritedPathSha256 }),
        stdio,
      });
      childSpawned = true;
      // Bun does not guarantee that the synchronous `exitCode` property is
      // refreshed until the exit promise is observed. Attach the observer at
      // spawn time so a fast child cannot be mistaken for a live child until
      // the 120-second proof deadline.
      void spawnedChild.exited.then(code => { spawnedChildExitCode = code; });
    } finally {
      if (saved13 >= 0) { libc.symbols.dup2(saved13, 13); closeSync(saved13); } else { try { closeSync(13); } catch {} }
      if (fd !== 13) { try { closeSync(fd); } catch {} }
    }
    const proofPaths = [join(bootstrap.state_root, "wakes", pending.wake_id, `${pending.launch_id}.adapter-start.json`), join(bootstrap.state_root, "wakes", pending.wake_id, `${pending.launch_id}.native-start.json`)];
    let childExitObservedAt = 0;
    for (let attempt = 0; attempt < 2400; attempt++) {
      if (proofPaths.some(path => existsSync(path))) {
        const proof = startProof(bootstrap.state_root, pending);
        if (proof) {
          const started = { protocol: 1, delivery_id: id, state: "started", pending_sha256: prepared.pending_sha256, executing_sha256: executingSha, proof_kind: proof.kind, proof_path: proof.path, proof_sha256: createHash("sha256").update(proof.raw).digest("hex") };
          writeNew(join(dir, "started.json"), started);
          writeNew(join(dir, "terminal.json"), { protocol: 1, delivery_id: id, terminal: "started.json", terminal_sha256: hash("sda-delivery-started-v1", jcs(started)) });
          return 0;
        }
      }
      if (spawnedChildExitCode !== null) {
        if (!childExitObservedAt) childExitObservedAt = Date.now();
        // Two exact, separated observations close the collected-before-proof
        // race without allowing a stale proof file to authorize `started`.
        const exitFenceMs = 510;
        if (Date.now() - childExitObservedAt >= exitFenceMs) {
          writeOrVerify(join(dir, "failure-event.json"), { protocol: 1, delivery_id: id, state: "failure-event", pending_sha256: pendingSha, executing_sha256: executingSha, phase: "child-exited-before-start-proof", helper_pid: process.pid, helper_start_ticks: processStartTicks(), child_exit_code: spawnedChildExitCode, code: "SDA-MCP-E-DELIVERY-CHILD-FAILED" });
          throw new Error(`child exited before start proof (${spawnedChildExitCode})`);
        }
      }
      await Bun.sleep(50);
    }
    throw new Error("claim timeout");
  } catch (error) {
    if (childSpawned && spawnedChild && spawnedChildExitCode === null) {
      try { spawnedChild.kill(); spawnedChildExitCode = await spawnedChild.exited; } catch {}
    }
    if (deliveryDir && pendingSha && executingSha && !existsSync(join(deliveryDir, "terminal.json")) && !existsSync(join(deliveryDir, "failure-event.json"))) {
      try {
        writeNew(join(deliveryDir, "failure-event.json"), {
          protocol: 1, delivery_id: id, state: "failure-event",
          pending_sha256: pendingSha, executing_sha256: executingSha,
          phase: childSpawned ? "child-exited-before-start-proof" : "before-command-exec",
          helper_pid: process.pid, helper_start_ticks: processStartTicks(),
          ...(childSpawned ? { child_exit_code: spawnedChildExitCode ?? 78 } : {}),
          code: childSpawned ? "SDA-MCP-E-DELIVERY-CHILD-FAILED" : "SDA-MCP-E-ABI",
        });
      } catch {}
    }
    if (process.env.MAW_TEST_MODE === "1") process.stderr.write(`[delivery-test] ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("SDA-MCP-E-ABI delivery validation failed\n"); return 78;
  }
}

function liveScopeState(executing: Record<string, any> | undefined, unit: string): "absent" | "empty" {
  const result = Bun.spawnSync({
    cmd: ["/usr/bin/systemctl", "--user", "show", unit, "--property=LoadState", "--property=ActiveState", "--property=ControlGroup"],
    stdout: "pipe", stderr: "pipe", env: closedEnvironment(), timeout: 10_000,
  });
  if (result.exitCode !== 0) throw new Error("scope observation unavailable");
  const fields = Object.fromEntries(new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean).map(line => {
    const index = line.indexOf("="); return index < 0 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
  }));
  if (fields.LoadState === "not-found") return "absent";
  const cgroupPath = fields.ControlGroup || executing?.cgroup_path || "";
  if (!cgroupPath.startsWith("/")) {
    if (fields.ActiveState === "inactive" || fields.ActiveState === "failed") return "absent";
    throw new Error("scope cgroup unknown");
  }
  const full = join("/sys/fs/cgroup", cgroupPath);
  if (!existsSync(full)) {
    if (fields.ActiveState === "inactive" || fields.ActiveState === "failed") return "absent";
    throw new Error("scope cgroup disappeared ambiguously");
  }
  const st = statSync(full);
  if (executing && (cgroupPath !== executing.cgroup_path || Number(st.dev) !== executing.cgroup_device || Number(st.ino) !== executing.cgroup_inode)) {
    throw new Error("scope identity mismatch");
  }
  const populated = readFileSync(join(full, "cgroup.events"), "utf8").split("\n").find(line => line.startsWith("populated "));
  if (populated !== "populated 0") throw new Error("scope remains populated");
  return "empty";
}

const liveDeliveryObserver: DeliveryObserver = async (pending, executing) => {
  let panePresent = false;
  const proc = `/proc/${pending.tmux_server_pid}/stat`;
  if (existsSync(proc)) {
    if (processStartTicksFor(pending.tmux_server_pid) !== pending.tmux_server_start_ticks) throw new Error("tmux server pid reused");
    const sessionResult = Bun.spawnSync({ cmd: ["/usr/bin/tmux", "-S", pending.tmux_socket, "display-message", "-p", "-t", pending.tmux_pane, "#{session_id}"], stdout: "pipe", stderr: "pipe", env: closedEnvironment(), timeout: 10_000 });
    const paneResult = Bun.spawnSync({ cmd: ["/usr/bin/tmux", "-S", pending.tmux_socket, "display-message", "-p", "-t", pending.tmux_pane, "#{pane_id}"], stdout: "pipe", stderr: "pipe", env: closedEnvironment(), timeout: 10_000 });
    if (sessionResult.exitCode === 0 && paneResult.exitCode === 0) {
      if (new TextDecoder().decode(sessionResult.stdout).trim() !== pending.tmux_session_id || new TextDecoder().decode(paneResult.stdout).trim() !== pending.tmux_pane) throw new Error("tmux pane identity changed");
      panePresent = true;
    } else {
      const error = `${new TextDecoder().decode(sessionResult.stderr)}${new TextDecoder().decode(paneResult.stderr)}`;
      if (!/can't find pane|can't find session|no server running/i.test(error)) throw new Error("tmux pane observation unavailable");
    }
  } else if (existsSync(pending.tmux_socket)) {
    throw new Error("tmux socket remains after unproven server exit");
  }
  return { pane_present: panePresent, scope_state: liveScopeState(executing, executing?.systemd_unit ?? `sda-maw-delivery-${pending.delivery_id}.scope`) };
};

export async function reconcileDelivery(
  id: string, observer: DeliveryObserver = liveDeliveryObserver, requireLease = true,
): Promise<"cancelled" | "failed-before-start" | "already-terminal"> {
  if (!ID.test(id)) throw new Error("delivery id invalid");
  const home = process.env.HOME;
  if (!home?.startsWith("/")) throw new Error("HOME invalid");
  const bootstrap = safeJson(join(home, ".config/sda-script/codex-mcp-bootstrap-v1.json"));
  if (requireLease) validateAdmissionLease(bootstrap);
  const dir = join(bootstrap.delivery_root, id);
  if (existsSync(join(dir, "terminal.json"))) {
    validateDeliveryTerminal(dir, id, bootstrap.state_root);
    return "already-terminal";
  }
  const existingTerminals = ["started.json", "cancelled.json", "failed-before-start.json"].filter(name => existsSync(join(dir, name)));
  if (existingTerminals.length > 1) throw new Error("terminal collision");
  if (existingTerminals[0] === "started.json") {
    recoverStartedPointer(dir, id, bootstrap.state_root);
    validateDeliveryTerminal(dir, id, bootstrap.state_root);
    return "already-terminal";
  }
  const pending = safeJson(join(dir, "pending.json"));
  if (pending.protocol !== 1 || pending.delivery_id !== id) throw new Error("pending mismatch");
  const pendingSha = hash("sda-delivery-pending-v1", jcs(pending));
  const preparedPath = join(dir, "send-prepared.json"), executingPath = join(dir, "executing.json");
  const proofPath = join(dir, "nonexecution-proof.json");
  const persistedProof = existsSync(proofPath) ? safeJson(proofPath) : undefined;
  if (existingTerminals.length === 1 && !persistedProof) throw new Error("terminal lacks nonexecution proof");
  let proof: Record<string, any>;
  let terminalName: "cancelled.json" | "failed-before-start.json";
  let prepared: Record<string, any> | undefined;
  let executing: Record<string, any> | undefined;
  if (!existsSync(preparedPath)) {
    if (existsSync(executingPath) || existsSync(join(dir, "failure-event.json")) || existsSync(join(dir, "started.json"))) throw new Error("pending-only chain contaminated");
    proof = persistedProof ?? { protocol: 1, delivery_id: id, state: "nonexecution-proof", kind: "not-sent", pending_sha256: pendingSha, send_prepared_sha256: "", executing_sha256: "", failure_event_sha256: "", tmux_socket_sha256: pending.tmux_socket_sha256, tmux_server_pid: pending.tmux_server_pid, tmux_server_start_ticks: pending.tmux_server_start_ticks, tmux_pane: pending.tmux_pane, systemd_unit: "", cgroup_path: "", observations: [], code: "SDA-MCP-E-DELIVERY-CANCELLED" };
    terminalName = "cancelled.json";
  } else {
    prepared = safeJson(preparedPath); validatePrepared(pending, prepared);
    const preparedSha = hash("sda-delivery-send-prepared-v1", jcs(prepared));
    executing = existsSync(executingPath) ? safeJson(executingPath) : undefined;
    let failureSha = "";
    let fencedObservations: DeliveryObservation[] | undefined;
    if (executing) {
      const executingSha = validateExecuting(prepared, executing);
      const failurePath = join(dir, "failure-event.json");
      if (!existsSync(failurePath)) {
        // The in-scope helper may be collected between authenticating a live
        // start proof and publishing started.json. Recovery can complete that
        // exact transition while the proof PID/start-time identity is live.
        const liveProof = startProof(bootstrap.state_root, pending);
        if (liveProof) {
          const started = { protocol: 1, delivery_id: id, state: "started", pending_sha256: pendingSha, executing_sha256: executingSha, proof_kind: liveProof.kind, proof_path: liveProof.path, proof_sha256: createHash("sha256").update(liveProof.raw).digest("hex") };
          writeOrVerify(join(dir, "started.json"), started);
          writeOrVerify(join(dir, "terminal.json"), { protocol: 1, delivery_id: id, terminal: "started.json", terminal_sha256: hash("sda-delivery-started-v1", jcs(started)) });
          validateDeliveryTerminal(dir, id, bootstrap.state_root);
          return "already-terminal";
        }
        // If no live start identity exists, two authenticated observations of
        // an empty/absent exact scope prove the helper was collected. Publish
        // the missing failure event before constructing the terminal chain.
        fencedObservations = [];
        for (let index = 0; index < 2; index++) {
          const observed = await observer(pending, executing);
          if (!["absent", "empty"].includes(observed.scope_state)) throw new Error("scope remains populated");
          fencedObservations.push({ observed_unix_ns: Date.now() * 1_000_000, ...observed });
          if (index === 0) await Bun.sleep(510);
        }
        writeOrVerify(failurePath, { protocol: 1, delivery_id: id, state: "failure-event", pending_sha256: pendingSha, executing_sha256: executingSha, phase: "child-exited-before-start-proof", helper_pid: executing.helper_pid, helper_start_ticks: executing.helper_start_ticks, child_exit_code: 78, code: "SDA-MCP-E-DELIVERY-CHILD-FAILED" });
      }
      const failure = safeJson(failurePath);
      if (failure.protocol !== 1 || failure.delivery_id !== id || failure.state !== "failure-event"
          || failure.pending_sha256 !== pendingSha || failure.executing_sha256 !== executingSha
          || !["before-command-exec", "child-exited-before-start-proof"].includes(failure.phase)) throw new Error("failure event mismatch");
      failureSha = hash("sda-delivery-failure-event-v1", jcs(failure));
    } else if (existsSync(join(dir, "failure-event.json"))) throw new Error("failure without executing");
    if (persistedProof) {
      proof = persistedProof;
    } else {
      const observations: DeliveryObservation[] = fencedObservations ?? [];
      if (!fencedObservations) {
        for (let index = 0; index < 2; index++) {
          const observed = await observer(pending, executing);
          observations.push({ observed_unix_ns: Date.now() * 1_000_000, ...observed });
          // Unix-nanosecond values are represented as JSON numbers in the frozen
          // ABI.  Leave margin for their millisecond clock/IEEE-754 precision.
          if (index === 0) await Bun.sleep(510);
        }
      }
      proof = { protocol: 1, delivery_id: id, state: "nonexecution-proof", kind: executing ? "child-failed" : "pane-retired", pending_sha256: pendingSha, send_prepared_sha256: preparedSha, executing_sha256: executing ? hash("sda-delivery-executing-v1", jcs(executing)) : "", failure_event_sha256: failureSha, tmux_socket_sha256: pending.tmux_socket_sha256, tmux_server_pid: pending.tmux_server_pid, tmux_server_start_ticks: pending.tmux_server_start_ticks, tmux_pane: pending.tmux_pane, systemd_unit: executing?.systemd_unit ?? `sda-maw-delivery-${id}.scope`, cgroup_path: executing?.cgroup_path ?? "", observations, code: executing ? "SDA-MCP-E-DELIVERY-CHILD-FAILED" : "SDA-MCP-E-DELIVERY-PANE-RETIRED" };
    }
    terminalName = "failed-before-start.json";
  }
  if (persistedProof) terminalName = proof.kind === "not-sent" ? "cancelled.json" : "failed-before-start.json";
  if (existingTerminals.length === 1 && existingTerminals[0] !== terminalName) throw new Error("terminal/proof collision");
  validateNonexecutionProof(pending, prepared, executing, { ...proof, proof_path: proofPath });
  writeOrVerify(proofPath, proof);
  // Reopen and validate the immutable proof before it can authorize a terminal.
  const reopenedProof = safeJson(proofPath);
  prepared = existsSync(preparedPath) ? safeJson(preparedPath) : undefined;
  executing = existsSync(executingPath) ? safeJson(executingPath) : undefined;
  validateNonexecutionProof(pending, prepared, executing, { ...reopenedProof, proof_path: proofPath });
  const terminal = { protocol: 1, delivery_id: id, state: terminalName === "cancelled.json" ? "cancelled" : "failed-before-start", pending_sha256: pendingSha, send_prepared_sha256: prepared ? hash("sda-delivery-send-prepared-v1", jcs(prepared)) : "", executing_sha256: executing ? hash("sda-delivery-executing-v1", jcs(executing)) : "", proof_path: proofPath, nonexecution_proof_sha256: hash("sda-delivery-nonexecution-proof-v1", jcs(reopenedProof)), code: reopenedProof.code };
  writeOrVerify(join(dir, terminalName), terminal);
  writeOrVerify(join(dir, "terminal.json"), { protocol: 1, delivery_id: id, terminal: terminalName, terminal_sha256: hash(`sda-delivery-${terminalName.slice(0, -5)}-v1`, jcs(terminal)) });
  validateDeliveryTerminal(dir, id, bootstrap.state_root);
  return terminalName === "cancelled.json" ? "cancelled" : "failed-before-start";
}

export async function runDeliveryReconcile(args: string[]): Promise<number> {
  if (args.join("\0") !== ["delivery-reconcile", "--protocol", "1", "--id", args[4] ?? ""].join("\0") || !ID.test(args[4] ?? "")) {
    process.stderr.write("SDA-MCP-E-ABI invalid reconciliation arguments\n"); return 78;
  }
  try { await reconcileDelivery(args[4]!); return 0; }
  catch { process.stderr.write("SDA-MCP-E-TMUX-AMBIGUOUS delivery remains nonterminal\n"); return 75; }
}

export async function runDeliveryGuardian(args: string[]): Promise<number> {
  if (args.join("\0") !== ["delivery-guardian", "--protocol", "1", "--id", args[4] ?? ""].join("\0") || !ID.test(args[4] ?? "")) {
    process.stderr.write("SDA-MCP-E-ABI invalid guardian arguments\n"); return 78;
  }
  try {
    const home = process.env.HOME;
    if (!home?.startsWith("/")) throw new Error("HOME invalid");
    const bootstrap = safeJson(join(home, ".config/sda-script/codex-mcp-bootstrap-v1.json"));
    validateAdmissionLease(bootstrap);
    process.stdout.write("SDA-MCP-GUARDIAN-READY-v1\n");
    const dir = join(bootstrap.delivery_root, args[4]!);
    const terminal = join(dir, "terminal.json");
    for (;;) {
      if (existsSync(join(dir, "executing.json"))) {
        try {
          await reconcileDelivery(args[4]!);
          if (existsSync(terminal) && validateDeliveryTerminal(dir, args[4]!, bootstrap.state_root)) return 0;
        } catch {
          // Scope/pane state can still be transitioning. Keep the lease and
          // retry; reconciliation itself enforces the two-observation fence.
        }
      }
      if (existsSync(terminal)) {
        try {
          if (validateDeliveryTerminal(dir, args[4]!, bootstrap.state_root)) return 0;
        } catch {
          // Invalid/ambiguous proof is intentionally nonterminal.  Retain the
          // inherited shared admission lease for operator reconciliation.
        }
      }
      await Bun.sleep(250);
    }
  } catch {
    process.stderr.write("SDA-MCP-E-ABI guardian validation failed\n"); return 78;
  }
}
