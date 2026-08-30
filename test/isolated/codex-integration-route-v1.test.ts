import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { INTEGRATED_ROUTE, requireIntegratedReadonlyAuthority } from "../../src/integration/codex-delivery-plan";
import { consumeIntegratedReadonly, createIntegratedReadonlyAuthority, restoreIntegratedReadonly, verifyCodexTrust } from "../../src/config/codex-trust";
import { sendPromptAfterIntegratedReady, snapshotRestoreReadonlyPolicy } from "../../src/commands/shared/wake-cmd";
import { decodeTmuxProbeFields, encodeTmuxProbeFields, requireStrictPaneCwd, Tmux } from "../../src/core/transport/tmux-class";

const route = "SDA_CODEX_MCP_HOME='/tmp/i' PATH='/tmp/i/bin':\"${PATH-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}\" codex -a never -s workspace-write";

describe("protocol-v1 integrated route and readonly authority", () => {
  test("matches only the exact whole command and leaves prefix prompts literal", () => {
    expect(INTEGRATED_ROUTE.test(route)).toBe(true);
    for (const suffix of [" ", " ; id", "\nwhoami", " prompt text"]) expect(INTEGRATED_ROUTE.test(route + suffix)).toBe(false);
  });

  test("reserved route prefix with a suffix fails closed before any tmux send", async () => {
    const transport = new Tmux();
    let sends = 0;
    (transport as any).run = async () => { sends++; return ""; };
    await expect(transport.sendText("s:0", `${route};id`)).rejects.toThrow("SDA-MCP-E-ROUTE");
    expect(sends).toBe(0);
  });

  test("tmux identity probe framing preserves delimiter and newline bytes", () => {
    const fields = ["/tmp/socket|||name", "123", "$4", "%7", "/repo/a|||b\nchild", "456"];
    expect(decodeTmuxProbeFields(encodeTmuxProbeFields(fields), fields.length)).toEqual(fields);
    expect(() => decodeTmuxProbeFields(Buffer.from("4:abc"), 1)).toThrow("probe frame truncated");
    expect(() => decodeTmuxProbeFields(Buffer.from("1:a1:b"), 1)).toThrow("probe frame trailing bytes");
  });

  test("strict route requires the requested cwd to equal the observed pane cwd", () => {
    expect(() => requireStrictPaneCwd("/repo/a", "/repo/b")).toThrow("pane cwd mismatch");
    expect(() => requireStrictPaneCwd("/repo/a", "/repo/a")).not.toThrow();
    expect(() => requireStrictPaneCwd(undefined, "/repo/a")).not.toThrow();
  });

  test("readonly authority is single-use and bound to exact launch identity", () => {
    const first = createIntegratedReadonlyAuthority("s:0", "/repo/a");
    const second = createIntegratedReadonlyAuthority("s:0", "/repo/a");
    expect(consumeIntegratedReadonly(first, "s:1", "/repo/a")).toBe(false);
    expect(consumeIntegratedReadonly(first, "s:0", "/repo/a")).toBe(true);
    expect(consumeIntegratedReadonly(first, "s:0", "/repo/a")).toBe(false);
    expect(consumeIntegratedReadonly(second, "s:0", "/repo/a")).toBe(true);
    restoreIntegratedReadonly(second, "s:0", "/repo/a");
    expect(consumeIntegratedReadonly(second, "s:0", "/repo/a")).toBe(true);
  });

  test("a supplied but absent or mismatched readonly authority fails closed", () => {
    expect(() => requireIntegratedReadonlyAuthority("f".repeat(32), false)).toThrow("SDA-MCP-E-AUTH");
    expect(requireIntegratedReadonlyAuthority(undefined, false)).toBe(false);
    expect(requireIntegratedReadonlyAuthority("f".repeat(32), true)).toBe(true);
  });

  test("snapshot restore ensures normally and is readonly only for incubate", () => {
    expect(snapshotRestoreReadonlyPolicy(undefined)).toBe(false);
    expect(snapshotRestoreReadonlyPolicy(false)).toBe(false);
    expect(snapshotRestoreReadonlyPolicy(true)).toBe(true);
  });

  test("trust verification parses the exact TOML table rather than matching comments", () => {
    const root = mkdtempSync(join(tmpdir(), "maw-trust-parser-"));
    const codex = join(root, ".codex"); mkdirSync(codex);
    try {
      writeFileSync(join(codex, "config.toml"), '# [projects."/repo"]\n# trust_level = "trusted"\n');
      expect(verifyCodexTrust("/repo", codex)).toBe(false);
      writeFileSync(join(codex, "config.toml"), '[projects."/repo"]\ntrust_level = "trusted"\n');
      expect(verifyCodexTrust("/repo", codex)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  for (const path of ["fresh", "existing", "new-window"]) test(`${path} prompt is stage two and never reaches the shell before readiness`, async () => {
    const order: string[] = [];
    await sendPromptAfterIntegratedReady("s:0", "a".repeat(32), "literal prompt", async () => { order.push("ready"); }, async (_target, text) => { order.push(`send:${text}`); });
    expect(order).toEqual(["ready", "send:literal prompt"]);
    order.length = 0;
    await expect(sendPromptAfterIntegratedReady("s:0", "b".repeat(32), "must-not-send", async () => { order.push("failed"); throw new Error("not ready"); }, async () => { order.push("sent"); })).rejects.toThrow("not ready");
    expect(order).toEqual(["failed"]);
  });
});
