import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { runDeliveryExec } from "../../src/integration/delivery";

const roots: string[] = [];
const hash = (domain: string, value: string) => createHash("sha256").update(`${domain}\0${value}`).digest("hex");
const sorted = (value: Record<string, unknown>) => JSON.stringify(value, Object.keys(value).sort());
const privateJson = (path: string, value: unknown) => { writeFileSync(path, `${JSON.stringify(value)}\n`); chmodSync(path, 0o600); };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("verified delivery executes exact private command once through memfd", async () => {
  const root = mkdtempSync(join(tmpdir(), "maw-delivery-v1-")); roots.push(root);
  const deliveryRoot = join(root, "state/deliveries");
  const id = "a".repeat(32), wake = "b".repeat(32), launch = "c".repeat(32);
  const dir = join(deliveryRoot, id);
  mkdirSync(join(root, ".config/sda-script"), { recursive: true, mode: 0o700 });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmux = "/tmp/tmux.sock,123,1", pane = "%7";
  const command = `SDA_CODEX_MCP_WAKE_ID='${wake}' SDA_CODEX_MCP_LAUNCH_ID='${launch}' /usr/bin/true`;
  const pending = { protocol: 1, delivery_id: id, wake_id: wake, launch_id: launch, configured_command: "/usr/bin/true", execution_command_sha256: hash("sda-delivery-execution-command-v1", command), tmux_socket: "/tmp/tmux.sock", tmux_server_pid: 123, tmux_raw_session_number: "1", tmux_session_id: "$1", tmux_pane: pane, tmux_env_sha256: hash("sda-delivery-env-tmux-v1", tmux), tmux_pane_env_sha256: hash("sda-delivery-env-tmux-pane-v1", pane), pane_cwd: root };
  privateJson(join(dir, "pending.json"), pending);
  const prepared = { protocol: 1, delivery_id: id, pending_sha256: hash("sda-delivery-pending-v1", sorted(pending)) };
  privateJson(join(dir, "send-prepared.json"), prepared);
  const claimDir = join(root, "state/wakes", wake); mkdirSync(claimDir, { recursive: true, mode: 0o700 });
  const launchPath = join(claimDir, `${launch}.launch.json`);
  privateJson(launchPath, { protocol: 1, wake_id: wake, launch_id: launch, repo_cwd: root });
  const statText = readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const startTicks = Number(statText.slice(statText.lastIndexOf(")") + 2).split(" ")[19]);
  privateJson(join(claimDir, `${launch}.native-start.json`), { protocol: 1, wake_id: wake, launch_id: launch, state: "native-start-ready", launch_record_sha256: createHash("sha256").update(readFileSync(launchPath)).digest("hex"), native_sha256: "d".repeat(64), pid: process.pid, start_ticks: startTicks });
  privateJson(join(root, ".config/sda-script/codex-mcp-bootstrap-v1.json"), { delivery_root: deliveryRoot, state_root: join(root, "state") });
  const old = { HOME: process.env.HOME, TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE, SDA_CODEX_MCP_DELIVERY_SCOPE: process.env.SDA_CODEX_MCP_DELIVERY_SCOPE, MAW_TEST_MODE: process.env.MAW_TEST_MODE };
  process.env.HOME = root; process.env.TMUX = tmux; process.env.TMUX_PANE = pane; process.env.SDA_CODEX_MCP_DELIVERY_SCOPE = id; process.env.MAW_TEST_MODE = "1";
  try {
    expect(await runDeliveryExec(["delivery-exec", "--protocol", "1", "--id", id])).toBe(0);
    const failedId = "d".repeat(32), failedLaunch = "e".repeat(32), failedDir = join(deliveryRoot, failedId);
    mkdirSync(failedDir, { recursive: true, mode: 0o700 });
    const failedCommand = `SDA_CODEX_MCP_WAKE_ID='${wake}' SDA_CODEX_MCP_LAUNCH_ID='${failedLaunch}' /usr/bin/true`;
    const failedPending = { ...pending, delivery_id: failedId, launch_id: failedLaunch, execution_command_sha256: hash("sda-delivery-execution-command-v1", failedCommand) };
    privateJson(join(failedDir, "pending.json"), failedPending);
    privateJson(join(failedDir, "send-prepared.json"), { protocol: 1, delivery_id: failedId, pending_sha256: hash("sda-delivery-pending-v1", sorted(failedPending)) });
    process.env.SDA_CODEX_MCP_DELIVERY_SCOPE = failedId;
    expect(await runDeliveryExec(["delivery-exec", "--protocol", "1", "--id", failedId])).toBe(78);
    expect(JSON.parse(readFileSync(join(failedDir, "failure-event.json"), "utf8")).phase).toBe("child-exited-before-start-proof");
    expect(await Bun.file(join(failedDir, "terminal.json")).exists()).toBe(false);
  }
  finally { for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value; }
});
