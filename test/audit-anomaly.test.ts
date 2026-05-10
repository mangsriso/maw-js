/**
 * Tests for logAnomaly — AnomalyEntry schema and silent-fail behavior.
 *
 * logAnomaly accepts an optional filePath (third arg) for test isolation so
 * tests don't write to the real ~/.config/maw/audit.jsonl.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { logAnomaly } from "../src/core/fleet/audit";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "maw-anomaly-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("logAnomaly — AnomalyEntry schema", () => {
  it("writes a JSON line with the correct schema fields", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "test-audit.jsonl");

    logAnomaly(
      "view-attach-via-view-name",
      {
        input: { agent: "mawjs-view", windowHint: undefined, clean: false },
        context: { resolvedSession: "mawjs-view", action: "attach-existing-view" },
      },
      filePath,
    );

    expect(existsSync(filePath)).toBe(true);
    const line = readFileSync(filePath, "utf-8").trim();
    const entry = JSON.parse(line);

    expect(entry.kind).toBe("anomaly");
    expect(entry.event).toBe("view-attach-via-view-name");
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts).getTime()).toBeLessThanOrEqual(Date.now());
    expect(typeof entry.user).toBe("string");
    expect(entry.user.length).toBeGreaterThan(0);
    expect(typeof entry.pid).toBe("number");
    expect(typeof entry.cwd).toBe("string");
    expect(entry.input).toBeDefined();
    expect(entry.context).toBeDefined();
    expect(entry.context.action).toBe("attach-existing-view");
    expect(entry.context.resolvedSession).toBe("mawjs-view");
  });

  it("silent-fails on bad file path — does not throw", () => {
    expect(() => {
      logAnomaly(
        "test-event",
        { input: { x: 1 } },
        "/nonexistent/deep/path/that/cannot/exist/audit.jsonl",
      );
    }).not.toThrow();
  });

  it("defaults input and context to empty objects when not provided", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "test-audit.jsonl");

    logAnomaly("minimal-event", {}, filePath);

    const line = readFileSync(filePath, "utf-8").trim();
    const entry = JSON.parse(line);
    expect(entry.input).toEqual({});
    expect(entry.context).toEqual({});
    expect(entry.kind).toBe("anomaly");
    expect(entry.event).toBe("minimal-event");
  });

  it("appends multiple entries (one per call)", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "test-audit.jsonl");

    logAnomaly("event-1", { input: { n: 1 } }, filePath);
    logAnomaly("event-2", { input: { n: 2 } }, filePath);

    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe("event-1");
    expect(JSON.parse(lines[1]).event).toBe("event-2");
  });
});
