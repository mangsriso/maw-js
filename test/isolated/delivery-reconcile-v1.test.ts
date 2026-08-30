import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { dlopen, FFIType } from "bun:ffi";
import { tmpdir } from "os";
import { join } from "path";
import { reconcileDelivery, runDeliveryReconcile, validateDeliveryTerminal, type DeliveryObserver } from "../../src/integration/delivery";

const roots: string[] = [];
const oldHome = process.env.HOME;
const libc = dlopen("libc.so.6", { dup: { args: [FFIType.i32], returns: FFIType.i32 }, dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 }, flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const jcs = (value: unknown) => JSON.stringify(stable(value));
const hash = (domain: string, value: unknown) => createHash("sha256").update(`${domain}\0${typeof value === "string" ? value : jcs(value)}`).digest("hex");
function privateJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${jcs(value)}\n`); chmodSync(path, 0o600);
}
function fixture(id: string): { root: string; dir: string; state: string; pending: Record<string, any> } {
  const root = mkdtempSync(join(tmpdir(), "maw-delivery-reconcile-")); roots.push(root); process.env.HOME = root;
  const state = join(root, "state"), dir = join(state, "deliveries", id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const admission = join(state, "wake-admission.lock"); writeFileSync(admission, ""); chmodSync(admission, 0o600);
  const lock = statSync(admission);
  const pending = {
    protocol: 1, delivery_id: id, wake_id: "b".repeat(32), launch_id: "c".repeat(32),
    tmux_socket: join(root, "tmux.sock"), tmux_socket_sha256: hash("sda-tmux-socket-v1", join(root, "tmux.sock")),
    tmux_server_pid: 999999, tmux_server_start_ticks: 1, tmux_session_id: "$1", tmux_raw_session_number: "1", tmux_pane: "%7",
    execution_command_sha256: "d".repeat(64),
  };
  privateJson(join(dir, "pending.json"), pending);
  privateJson(join(root, ".config/sda-script/codex-mcp-bootstrap-v1.json"), { protocol: 1, delivery_root: join(state, "deliveries"), state_root: state, admission_lock: admission, admission_lock_device: Number(lock.dev), admission_lock_inode: Number(lock.ino) });
  return { root, dir, state, pending };
}
function prepared(dir: string, id: string, pending: Record<string, any>): Record<string, any> {
  const record = { protocol: 1, delivery_id: id, state: "send-prepared", pending_sha256: hash("sda-delivery-pending-v1", pending), execution_command_sha256: pending.execution_command_sha256, tmux_payload_sha256: "e".repeat(64), prepared_unix_ns: Date.now() * 1_000_000 };
  privateJson(join(dir, "send-prepared.json"), record); return record;
}
function expectNoTerminalPublication(dir: string): void {
  for (const name of ["nonexecution-proof.json", "cancelled.json", "failed-before-start.json", "started.json", "terminal.json"]) {
    expect(existsSync(join(dir, name))).toBe(false);
  }
}
afterEach(() => {
  process.env.HOME = oldHome;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("protocol-v1 authenticated non-execution reconciliation", () => {
  test("pending-only not-sent proof publishes the sole cancelled terminal and replays", async () => {
    const id = "1".repeat(32), { dir, state } = fixture(id);
    expect(await reconcileDelivery(id, async () => { throw new Error("observer must not run"); }, false)).toBe("cancelled");
    expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
    expect(JSON.parse(await Bun.file(join(dir, "terminal.json")).text()).terminal).toBe("cancelled.json");
    expect(await reconcileDelivery(id, async () => { throw new Error("observer must not run"); }, false)).toBe("already-terminal");
  });

  test("public reconciliation command requires and authenticates the inherited fd15 admission lease", async () => {
    const id = "5".repeat(32), { root, dir, state } = fixture(id);
    const fd = openSync(join(state, "wake-admission.lock"), constants.O_RDWR);
    expect(libc.symbols.flock(fd, 2 | 4)).toBe(0);
    const saved = libc.symbols.dup(15);
    expect(libc.symbols.dup2(fd, 15)).toBe(15);
    try { expect(await runDeliveryReconcile(["delivery-reconcile", "--protocol", "1", "--id", id])).toBe(0); }
    finally {
      if (saved >= 0) { libc.symbols.dup2(saved, 15); closeSync(saved); } else { try { closeSync(15); } catch {} }
      closeSync(fd);
    }
    expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
    expect(root.startsWith("/tmp/")).toBe(true);
  });

  test("public reconciliation rejects fd15 with the right inode but no flock", async () => {
    const id = "8".repeat(32), { dir, state } = fixture(id);
    const fd = openSync(join(state, "wake-admission.lock"), constants.O_RDWR);
    const saved = libc.symbols.dup(15);
    expect(libc.symbols.dup2(fd, 15)).toBe(15);
    try { expect(await runDeliveryReconcile(["delivery-reconcile", "--protocol", "1", "--id", id])).toBe(75); }
    finally {
      if (saved >= 0) { libc.symbols.dup2(saved, 15); closeSync(saved); } else { try { closeSync(15); } catch {} }
      closeSync(fd);
    }
    expectNoTerminalPublication(dir);
  });

  test("public reconciliation rejects a missing fd15", async () => {
    const id = "a".repeat(32), { dir } = fixture(id);
    const saved = libc.symbols.dup(15);
    try {
      try { closeSync(15); } catch {}
      expect(await runDeliveryReconcile(["delivery-reconcile", "--protocol", "1", "--id", id])).toBe(75);
    } finally {
      if (saved >= 0) { libc.symbols.dup2(saved, 15); closeSync(saved); }
    }
    expectNoTerminalPublication(dir);
  });

  test("public reconciliation rejects fd15 bound to a different locked inode", async () => {
    const id = "9".repeat(32), { root, dir } = fixture(id);
    const other = join(root, "other.lock"); writeFileSync(other, ""); chmodSync(other, 0o600);
    const fd = openSync(other, constants.O_RDWR); expect(libc.symbols.flock(fd, 2 | 4)).toBe(0);
    const saved = libc.symbols.dup(15); expect(libc.symbols.dup2(fd, 15)).toBe(15);
    try { expect(await runDeliveryReconcile(["delivery-reconcile", "--protocol", "1", "--id", id])).toBe(75); }
    finally {
      if (saved >= 0) { libc.symbols.dup2(saved, 15); closeSync(saved); } else { try { closeSync(15); } catch {} }
      closeSync(fd);
    }
    expectNoTerminalPublication(dir);
  });

  test("send-prepared plus two pane/scope absence observations publishes failed-before-start", async () => {
    const id = "2".repeat(32), { dir, state, pending } = fixture(id); prepared(dir, id, pending);
    let calls = 0;
    const observer: DeliveryObserver = async () => { calls++; return { pane_present: false, scope_state: "absent" }; };
    expect(await reconcileDelivery(id, observer, false)).toBe("failed-before-start");
    expect(calls).toBe(2); expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
    const proof = JSON.parse(await Bun.file(join(dir, "nonexecution-proof.json")).text());
    expect(proof.kind).toBe("pane-retired");
    expect(proof.observations[1].observed_unix_ns - proof.observations[0].observed_unix_ns).toBeGreaterThanOrEqual(500_000_000);
  });

  test("matching pre-exec failure plus two empty-scope observations publishes failed-before-start", async () => {
    const id = "3".repeat(32), { dir, state, pending } = fixture(id); const send = prepared(dir, id, pending);
    const executing = { protocol: 1, delivery_id: id, state: "executing", pending_sha256: send.pending_sha256, send_prepared_sha256: hash("sda-delivery-send-prepared-v1", send), helper_pid: 11, helper_start_ticks: 22, systemd_unit: `sda-maw-delivery-${id}.scope`, cgroup_path: "/unit", cgroup_device: 1, cgroup_inode: 2, inherited_path_sha256: "f".repeat(64) };
    privateJson(join(dir, "executing.json"), executing);
    privateJson(join(dir, "failure-event.json"), { protocol: 1, delivery_id: id, state: "failure-event", pending_sha256: send.pending_sha256, executing_sha256: hash("sda-delivery-executing-v1", executing), phase: "before-command-exec", helper_pid: 11, helper_start_ticks: 22, code: "SDA-MCP-E-ABI" });
    expect(await reconcileDelivery(id, async () => ({ pane_present: true, scope_state: "empty" }), false)).toBe("failed-before-start");
    expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
    expect(JSON.parse(await Bun.file(join(dir, "nonexecution-proof.json")).text()).kind).toBe("child-failed");
  });

  test("collected executing helper without an event converges after two exact observations", async () => {
    const id = "b".repeat(32), { dir, state, pending } = fixture(id); const send = prepared(dir, id, pending);
    const executing = { protocol: 1, delivery_id: id, state: "executing", pending_sha256: send.pending_sha256, send_prepared_sha256: hash("sda-delivery-send-prepared-v1", send), helper_pid: 999999, helper_start_ticks: 22, systemd_unit: `sda-maw-delivery-${id}.scope`, cgroup_path: "/unit", cgroup_device: 1, cgroup_inode: 2, inherited_path_sha256: "f".repeat(64) };
    privateJson(join(dir, "executing.json"), executing);
    privateJson(join(state, "wakes", pending.wake_id, `${pending.launch_id}.launch.json`), { protocol: 1, wake_id: pending.wake_id, launch_id: pending.launch_id, repo_cwd: dir });
    expect(await reconcileDelivery(id, async () => ({ pane_present: true, scope_state: "absent" }), false)).toBe("failed-before-start");
    expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
    expect(JSON.parse(await Bun.file(join(dir, "failure-event.json")).text()).phase).toBe("child-exited-before-start-proof");
  });

  test("crash after immutable nonexecution proof resumes without new observations", async () => {
    const id = "6".repeat(32), { dir, state, pending } = fixture(id); prepared(dir, id, pending);
    expect(await reconcileDelivery(id, async () => ({ pane_present: false, scope_state: "absent" }), false)).toBe("failed-before-start");
    const proofBefore = readFileSync(join(dir, "nonexecution-proof.json"));
    unlinkSync(join(dir, "terminal.json")); unlinkSync(join(dir, "failed-before-start.json"));
    let calls = 0;
    expect(await reconcileDelivery(id, async () => { calls++; throw new Error("persisted proof must be reused"); }, false)).toBe("failed-before-start");
    expect(calls).toBe(0);
    expect(readFileSync(join(dir, "nonexecution-proof.json"))).toEqual(proofBefore);
    expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
  });

  test("recovery publishes started from an authenticated live proof if the helper was collected", async () => {
    const id = "7".repeat(32), { dir, state, pending } = fixture(id); const send = prepared(dir, id, pending);
    const executing = { protocol: 1, delivery_id: id, state: "executing", pending_sha256: send.pending_sha256, send_prepared_sha256: hash("sda-delivery-send-prepared-v1", send), helper_pid: 11, helper_start_ticks: 22, systemd_unit: `sda-maw-delivery-${id}.scope`, cgroup_path: "/unit", cgroup_device: 1, cgroup_inode: 2, inherited_path_sha256: "f".repeat(64) };
    privateJson(join(dir, "executing.json"), executing);
    const wakeDir = join(state, "wakes", pending.wake_id), launchPath = join(wakeDir, `${pending.launch_id}.launch.json`);
    privateJson(launchPath, { protocol: 1, wake_id: pending.wake_id, launch_id: pending.launch_id, repo_cwd: dir });
    const proofPath = join(wakeDir, `${pending.launch_id}.native-start.json`);
    const statText = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const startTicks = Number(statText.slice(statText.lastIndexOf(")") + 2).split(" ")[19]);
    privateJson(proofPath, { protocol: 1, wake_id: pending.wake_id, launch_id: pending.launch_id, state: "native-start-ready", launch_record_sha256: createHash("sha256").update(readFileSync(launchPath)).digest("hex"), native_sha256: "a".repeat(64), pid: process.pid, start_ticks: startTicks });
    expect(await reconcileDelivery(id, async () => { throw new Error("observer must not run"); }, false)).toBe("already-terminal");
    expect(validateDeliveryTerminal(dir, id, state)).toBe(true);
    expect(JSON.parse(await Bun.file(join(dir, "started.json")).text()).proof_path).toBe(proofPath);
    expect(JSON.parse(await Bun.file(join(dir, "terminal.json")).text()).terminal).toBe("started.json");
    privateJson(join(dir, "nonexecution-proof.json"), { protocol: 1, delivery_id: id, state: "nonexecution-proof" });
    expect(() => validateDeliveryTerminal(dir, id, state)).toThrow("competes with nonexecution proof");
  });

  test("ambiguous pane reuse remains nonterminal and publishes no proof", async () => {
    const id = "4".repeat(32), { dir, pending } = fixture(id); prepared(dir, id, pending);
    await expect(reconcileDelivery(id, async () => ({ pane_present: true, scope_state: "absent" }), false)).rejects.toThrow("pane-retired proof invalid");
    expect(existsSync(join(dir, "nonexecution-proof.json"))).toBe(false);
    expect(existsSync(join(dir, "terminal.json"))).toBe(false);
  });
});
