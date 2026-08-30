import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { tmpdir } from "os";
import {
  commandCas,
  parseCommandCasRequest,
  parseJsonStrict,
  mutateConfigTransactional,
  replaceWholeConfigTransactional,
} from "../../src/config/transaction";

const roots: string[] = [];

function fixture(initial: Record<string, unknown>): string {
  const root = join(tmpdir(), `maw-cas-${crypto.randomUUID()}`);
  roots.push(root);
  mkdirSync(root, { mode: 0o775 });
  const path = join(root, "maw.config.json");
  writeFileSync(path, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o664 });
  chmodSync(path, 0o664);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("compiled maw-control remains standalone after copying away from the checkout", () => {
  const built = join(process.cwd(), "dist/maw-control");
  expect(existsSync(built)).toBe(true);
  const builtMtime = statSync(built).mtimeMs;
  for (const source of ["src/integration/maw-control.ts", "src/integration/delivery.ts", "src/config/transaction.ts", "src/config/command-cas.ts"]) {
    expect(builtMtime).toBeGreaterThanOrEqual(statSync(join(process.cwd(), source)).mtimeMs);
  }
  const path = fixture({ commands: { "codex-*": "old" }, retained: true });
  const standalone = join(dirname(path), "maw-control");
  copyFileSync(built, standalone);
  chmodSync(standalone, 0o500);
  const result = spawnSync(standalone, ["command-cas", "--protocol", "1", "--stdin-json"], {
    input: '{"protocol":1,"name":"codex-*","expected":{"present":true,"value":"old"},"desired":{"present":true,"value":"new"}}\n',
    encoding: "utf8",
    env: { ...process.env, MAW_HOME: "", MAW_CONFIG_DIR: dirname(path), MAW_TEST_MODE: "1", PATH: "/nonexistent" },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).result).toBe("updated");
});

describe("protocol-v1 command CAS", () => {
  test("updates only codex-* from an exact present state and preserves mode/unrelated keys", () => {
    const path = fixture({ future: { retained: true }, commands: { default: "claude", "codex-*": "old" } });
    const result = commandCas(path, {
      protocol: 1,
      name: "codex-*",
      expected: { present: true, value: "old" },
      desired: { present: true, value: "new value with spaces ' and *" },
    });
    expect(result.result).toBe("updated");
    expect(result.before_sha256).not.toBe(result.after_sha256);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      future: { retained: true },
      commands: { default: "claude", "codex-*": "new value with spaces ' and *" },
    });
    expect(statSync(path).mode & 0o777).toBe(0o664);
  });

  test("desired wins idempotently and stale/unrelated current conflicts without a write", () => {
    const path = fixture({ commands: { "codex-*": "target" } });
    expect(commandCas(path, {
      protocol: 1, name: "codex-*",
      expected: { present: true, value: "stale" }, desired: { present: true, value: "target" },
    }).result).toBe("unchanged");
    const before = readFileSync(path);
    expect(commandCas(path, {
      protocol: 1, name: "codex-*",
      expected: { present: false }, desired: { present: true, value: "other" },
    }).result).toBe("conflict");
    expect(readFileSync(path)).toEqual(before);
  });

  test("supports absent desired and fresh sequential writers preserve both updates", () => {
    const path = fixture({ commands: { "codex-*": "old", default: "claude" }, node: "one" });
    mutateConfigTransactional(path, fresh => ({ ...fresh, node: "two" }));
    expect(commandCas(path, {
      protocol: 1, name: "codex-*",
      expected: { present: true, value: "old" }, desired: { present: false },
    }).result).toBe("updated");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ commands: { default: "claude" }, node: "two" });
  });

  test("rejects malformed, duplicate, unknown-field, and unsupported requests", () => {
    expect(() => parseJsonStrict('{"a":1,"a":2}')).toThrow(/duplicate/);
    expect(() => parseCommandCasRequest('{"protocol":1,"name":"codex-*","expected":{"present":false},"desired":{"present":false},"extra":1}')).toThrow(/unknown/);
    expect(() => parseCommandCasRequest('{"protocol":2,"name":"codex-*","expected":{"present":false},"desired":{"present":false}}')).toThrow(/unsupported/);
    expect(() => parseCommandCasRequest('{')).toThrow(/invalid CAS request/);
    expect(() => parseJsonStrict('{"n":9007199254740992}')).toThrow(/inexact/);
    expect(parseJsonStrict('{"n":0.1}')).toEqual({ n: 0.1 });
    expect(() => parseJsonStrict('{"n":0.10000000000000001}')).toThrow(/inexact/);
    expect(() => parseJsonStrict('{"n":1e-999}')).toThrow(/inexact/);
    expect(() => parseCommandCasRequest('{"protocol":1,"name":"codex-*","expected":{"present":false},"desired":{"present":true,"value":""}}')).toThrow(/invalid fields/);
    const malformed = fixture({ commands: { "codex-*": 7 } });
    expect(() => commandCas(malformed, { protocol: 1, name: "codex-*", expected: { present: false }, desired: { present: false } })).toThrow(/string/);
    const malformedCommands = fixture({ commands: null });
    expect(() => commandCas(malformedCommands, { protocol: 1, name: "codex-*", expected: { present: false }, desired: { present: false } })).toThrow(/commands is not an object/);
    expect(() => parseCommandCasRequest(`{"protocol":1,"name":"codex-*","expected":{"present":false},"desired":{"present":false},"x":"${"x".repeat(20_000)}"}`)).toThrow(/invalid CAS request/);
  });

  test("forced whole-config initialization explicitly repairs malformed JSON", () => {
    const path = fixture({ retained: true });
    for (const malformed of ["{malformed\n", "[]\n", '"string"\n', "null\n"]) {
      writeFileSync(path, malformed);
      expect(() => replaceWholeConfigTransactional(path, { repaired: true }, { overwrite: false })).toThrow();
      replaceWholeConfigTransactional(path, { repaired: true }, { overwrite: true });
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ repaired: true });
    }
  });

  test("rejects a symlink config and symlink ancestor", () => {
    const path = fixture({ ok: true });
    const link = `${path}.link`;
    require("fs").symlinkSync(path, link);
    expect(() => commandCas(link, { protocol: 1, name: "codex-*", expected: { present: false }, desired: { present: false } })).toThrow(/safely open|unsafe/);
    const ancestor = join(dirname(path), "ancestor-link");
    require("fs").symlinkSync(dirname(path), ancestor);
    expect(() => commandCas(join(ancestor, "maw.config.json"), { protocol: 1, name: "codex-*", expected: { present: false }, desired: { present: false } })).toThrow(/ancestor/);
  });

  test("two independent writers serialize under flock without losing unrelated updates", async () => {
    const path = fixture({ commands: { "codex-*": "old" }, retained: true });
    const barrier = join(dirname(path), "barrier"); mkdirSync(barrier);
    const moduleUrl = new URL("../../src/config/transaction.ts", import.meta.url).href;
    const source = `
      const { mutateConfigTransactional, setConfigTransactionTestHookForTests } = await import(${JSON.stringify(moduleUrl)});
      const { existsSync, writeFileSync } = await import("fs"); const { join } = await import("path");
      const wait = (path) => { while (!existsSync(path)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); };
      const root = process.argv[4], id = process.argv[5];
      setConfigTransactionTestHookForTests(stage => { writeFileSync(join(root, stage + "-" + id), ""); wait(join(root, stage === "before-lock" ? "go" : "release")); });
      mutateConfigTransactional(process.argv[1], fresh => ({ ...fresh, [process.argv[2]]: process.argv[3] }));`;
    const first = Bun.spawn([process.execPath, "-e", source, path, "writerA", "one", barrier, "a"], { stdout: "pipe", stderr: "pipe" });
    const second = Bun.spawn([process.execPath, "-e", source, path, "writerB", "two", barrier, "b"], { stdout: "pipe", stderr: "pipe" });
    const markers = (prefix: string) => readdirSync(barrier).filter(name => name.startsWith(prefix));
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5_000;
      while (!predicate()) { if (Date.now() > deadline) throw new Error("barrier timeout"); await Bun.sleep(10); }
    };
    await waitFor(() => markers("before-lock-").length === 2);
    writeFileSync(join(barrier, "go"), "");
    await waitFor(() => markers("after-read-").length >= 1);
    await Bun.sleep(100);
    // A removed/broken flock lets both processes cross the after-read barrier
    // before release and deterministically fails this assertion.
    expect(markers("after-read-")).toHaveLength(1);
    writeFileSync(join(barrier, "release"), "");
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    const value = JSON.parse(readFileSync(path, "utf8"));
    expect(value).toMatchObject({ retained: true, writerA: "one", writerB: "two" });
    expect(commandCas(path, { protocol: 1, name: "codex-*", expected: { present: true, value: "stale" }, desired: { present: true, value: "new" } }).result).toBe("conflict");
  });
});
