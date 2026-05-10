/**
 * plugin/registry-semver.ts — minimal semver helpers (satisfies + formatSdkMismatchError).
 *
 * Pure logic, zero external imports; the Bun mock.module gotcha catalog is
 * N/A here (no seams to mock, no os.homedir() caching, no fs). Every
 * assertion exercises the real comparator on string inputs and the real
 * string formatter. Matches the triggers-cron.test.ts template shape.
 */
import { describe, test, expect } from "bun:test";
import {
  satisfies,
  formatSdkMismatchError,
} from "../../src/plugin/registry-semver";

// ─── satisfies: invalid inputs ──────────────────────────────────────────────

describe("satisfies() — invalid inputs", () => {
  test("non-semver version returns false", () => {
    expect(satisfies("not-a-version", "*")).toBe(false);
    expect(satisfies("1.2", "*")).toBe(false);
    expect(satisfies("1", "*")).toBe(false);
    expect(satisfies("", "*")).toBe(false);
  });

  test("non-semver version returns false even against bare-equal range", () => {
    expect(satisfies("garbage", "1.2.3")).toBe(false);
  });

  test("non-parseable range (after stripping operator) returns false", () => {
    expect(satisfies("1.2.3", "^not-a-version")).toBe(false);
    expect(satisfies("1.2.3", "~bad")).toBe(false);
    expect(satisfies("1.2.3", ">=abc")).toBe(false);
    expect(satisfies("1.2.3", "abc")).toBe(false);
  });

  test("range with only operator and no version returns false", () => {
    // ">=" alone: regex captures rest="" → parseCore fails.
    expect(satisfies("1.2.3", ">=")).toBe(false);
  });
});

// ─── satisfies: wildcard and whitespace ─────────────────────────────────────

describe("satisfies() — wildcard and whitespace", () => {
  test("'*' matches any valid version", () => {
    expect(satisfies("0.0.0", "*")).toBe(true);
    expect(satisfies("1.2.3", "*")).toBe(true);
    expect(satisfies("999.999.999", "*")).toBe(true);
  });

  test("leading/trailing whitespace in version is tolerated", () => {
    expect(satisfies("  1.2.3  ", "1.2.3")).toBe(true);
  });

  test("leading/trailing whitespace in range is tolerated", () => {
    expect(satisfies("1.2.3", "  *  ")).toBe(true);
    expect(satisfies("1.2.3", "  ^1.0.0  ")).toBe(true);
  });
});

// ─── satisfies: pre-release / build metadata ────────────────────────────────

describe("satisfies() — pre-release and build metadata", () => {
  test("pre-release suffix on version is stripped before compare", () => {
    expect(satisfies("1.2.3-alpha.1", "1.2.3")).toBe(true);
    expect(satisfies("1.2.3-rc.5", "^1.2.3")).toBe(true);
  });

  test("build metadata suffix on version is stripped before compare", () => {
    expect(satisfies("1.2.3+build.7", "1.2.3")).toBe(true);
  });

  test("both pre-release and build metadata together", () => {
    expect(satisfies("1.2.3-beta.2+exp.sha.5114f85", "1.2.3")).toBe(true);
  });

  test("pre-release in target range is also stripped", () => {
    expect(satisfies("1.2.3", "^1.2.3-alpha")).toBe(true);
  });
});

// ─── satisfies: bare (exact) range ──────────────────────────────────────────

describe("satisfies() — bare (exact) range", () => {
  test("bare version matches the same core exactly", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
  });

  test("bare version does not match a different patch", () => {
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "1.2.3")).toBe(false);
  });

  test("bare version does not match a different minor/major", () => {
    expect(satisfies("1.3.3", "1.2.3")).toBe(false);
    expect(satisfies("2.2.3", "1.2.3")).toBe(false);
  });
});

// ─── satisfies: caret (^) range ─────────────────────────────────────────────

describe("satisfies() — caret (^) range", () => {
  // Major >= 1: lock major, allow minor/patch up.
  test("^1.2.3 matches same major at or above the floor", () => {
    expect(satisfies("1.2.3", "^1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "^1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "^1.2.3")).toBe(true);
    expect(satisfies("1.99.99", "^1.2.3")).toBe(true);
  });

  test("^1.2.3 rejects below the floor", () => {
    expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
    expect(satisfies("1.1.99", "^1.2.3")).toBe(false);
    expect(satisfies("0.9.9", "^1.2.3")).toBe(false);
  });

  test("^1.2.3 rejects a different major even if higher", () => {
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("2.2.3", "^1.2.3")).toBe(false);
  });

  // 0.x: lock minor, allow patch up.
  test("^0.2.3 matches same 0.minor at or above floor", () => {
    expect(satisfies("0.2.3", "^0.2.3")).toBe(true);
    expect(satisfies("0.2.4", "^0.2.3")).toBe(true);
    expect(satisfies("0.2.99", "^0.2.3")).toBe(true);
  });

  test("^0.2.3 rejects a different 0.minor", () => {
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfies("0.1.99", "^0.2.3")).toBe(false);
  });

  test("^0.2.3 rejects a non-zero major", () => {
    expect(satisfies("1.2.3", "^0.2.3")).toBe(false);
  });

  test("^0.2.3 rejects below the floor patch", () => {
    expect(satisfies("0.2.2", "^0.2.3")).toBe(false);
  });

  // 0.0.x: exact.
  test("^0.0.5 matches only the exact 0.0.5", () => {
    expect(satisfies("0.0.5", "^0.0.5")).toBe(true);
  });

  test("^0.0.5 rejects any other patch (even higher)", () => {
    expect(satisfies("0.0.6", "^0.0.5")).toBe(false);
    expect(satisfies("0.0.4", "^0.0.5")).toBe(false);
  });

  test("^0.0.5 rejects any non-zero minor or major", () => {
    expect(satisfies("0.1.5", "^0.0.5")).toBe(false);
    expect(satisfies("1.0.5", "^0.0.5")).toBe(false);
  });
});

// ─── satisfies: tilde (~) range ─────────────────────────────────────────────

describe("satisfies() — tilde (~) range", () => {
  test("~1.2.3 matches same major.minor at or above floor", () => {
    expect(satisfies("1.2.3", "~1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "~1.2.3")).toBe(true);
    expect(satisfies("1.2.99", "~1.2.3")).toBe(true);
  });

  test("~1.2.3 rejects below the floor", () => {
    expect(satisfies("1.2.2", "~1.2.3")).toBe(false);
    expect(satisfies("1.1.99", "~1.2.3")).toBe(false);
  });

  test("~1.2.3 rejects a different minor (even higher)", () => {
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("1.3.3", "~1.2.3")).toBe(false);
  });

  test("~1.2.3 rejects a different major", () => {
    expect(satisfies("2.2.3", "~1.2.3")).toBe(false);
    expect(satisfies("0.2.3", "~1.2.3")).toBe(false);
  });
});

// ─── satisfies: comparison operators ────────────────────────────────────────

describe("satisfies() — >= operator", () => {
  test(">=1.2.3 matches equal", () => {
    expect(satisfies("1.2.3", ">=1.2.3")).toBe(true);
  });

  test(">=1.2.3 matches greater (patch, minor, major)", () => {
    expect(satisfies("1.2.4", ">=1.2.3")).toBe(true);
    expect(satisfies("1.3.0", ">=1.2.3")).toBe(true);
    expect(satisfies("2.0.0", ">=1.2.3")).toBe(true);
  });

  test(">=1.2.3 rejects less", () => {
    expect(satisfies("1.2.2", ">=1.2.3")).toBe(false);
    expect(satisfies("0.99.99", ">=1.2.3")).toBe(false);
  });
});

describe("satisfies() — <= operator", () => {
  test("<=1.2.3 matches equal", () => {
    expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
  });

  test("<=1.2.3 matches less (patch, minor, major)", () => {
    expect(satisfies("1.2.2", "<=1.2.3")).toBe(true);
    expect(satisfies("1.1.99", "<=1.2.3")).toBe(true);
    expect(satisfies("0.9.9", "<=1.2.3")).toBe(true);
  });

  test("<=1.2.3 rejects greater", () => {
    expect(satisfies("1.2.4", "<=1.2.3")).toBe(false);
    expect(satisfies("2.0.0", "<=1.2.3")).toBe(false);
  });
});

describe("satisfies() — > operator", () => {
  test("> matches strictly greater", () => {
    expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
    expect(satisfies("2.0.0", ">1.2.3")).toBe(true);
  });

  test("> rejects equal", () => {
    expect(satisfies("1.2.3", ">1.2.3")).toBe(false);
  });

  test("> rejects less", () => {
    expect(satisfies("1.2.2", ">1.2.3")).toBe(false);
  });
});

describe("satisfies() — < operator", () => {
  test("< matches strictly less", () => {
    expect(satisfies("1.2.2", "<1.2.3")).toBe(true);
    expect(satisfies("0.9.9", "<1.2.3")).toBe(true);
  });

  test("< rejects equal", () => {
    expect(satisfies("1.2.3", "<1.2.3")).toBe(false);
  });

  test("< rejects greater", () => {
    expect(satisfies("1.2.4", "<1.2.3")).toBe(false);
  });
});

// ─── satisfies: comparator ordering across components ───────────────────────

describe("satisfies() — comparator orders major > minor > patch", () => {
  test("major dominates minor and patch", () => {
    expect(satisfies("2.0.0", ">1.99.99")).toBe(true);
    expect(satisfies("1.99.99", ">2.0.0")).toBe(false);
  });

  test("minor dominates patch", () => {
    expect(satisfies("1.3.0", ">1.2.99")).toBe(true);
    expect(satisfies("1.2.99", ">1.3.0")).toBe(false);
  });

  test("patch tiebreaks within same major.minor", () => {
    expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
    expect(satisfies("1.2.3", ">1.2.4")).toBe(false);
  });
});

// ─── formatSdkMismatchError ─────────────────────────────────────────────────

describe("formatSdkMismatchError()", () => {
  test("includes the plugin name, manifest SDK, and runtime version", () => {
    const out = formatSdkMismatchError("my-plugin", "^2.0.0", "1.9.3");
    expect(out).toContain("my-plugin");
    expect(out).toContain("^2.0.0");
    expect(out).toContain("1.9.3");
  });

  test("uses the ANSI red ✗ marker and reset code", () => {
    const out = formatSdkMismatchError("x", "1.0.0", "1.0.0");
    expect(out).toContain("\x1b[31m✗\x1b[0m");
  });

  test("renders the required maw SDK sentence on the first line", () => {
    const out = formatSdkMismatchError("demo", "^3.0.0", "2.5.1");
    const firstLine = out.split("\n")[0]!;
    expect(firstLine).toContain("plugin 'demo' requires maw SDK ^3.0.0");
  });

  test("shows the 'your maw' line with version printed twice (version == SDK)", () => {
    const out = formatSdkMismatchError("demo", "^3.0.0", "2.5.1");
    expect(out).toContain("your maw: 2.5.1");
    expect(out).toContain("(SDK 2.5.1)");
  });

  test("interpolates the plugin name into the install hint", () => {
    const out = formatSdkMismatchError("cool-plug", "^9.9.9", "1.0.0");
    expect(out).toContain("maw plugin install cool-plug@<old-version>");
  });

  test("contains all three fix suggestions", () => {
    const out = formatSdkMismatchError("p", "1.0.0", "2.0.0");
    expect(out).toContain("maw update");
    expect(out).toContain("maw plugin install p@<old-version>");
    expect(out).toContain('edit plugin.json "sdk"');
  });

  test("output is a 7-line joined string (header + your-maw + blank + fix: + 3 bullets)", () => {
    const out = formatSdkMismatchError("p", "1.0.0", "2.0.0");
    const lines = out.split("\n");
    expect(lines.length).toBe(7);
    expect(lines[2]).toBe(""); // blank separator between header and fix list
    expect(lines[3]).toContain("fix:");
  });

  test("tolerates empty-string plugin name (formatter does not validate)", () => {
    const out = formatSdkMismatchError("", "1.0.0", "1.0.0");
    expect(out).toContain("plugin ''");
    expect(out).toContain("maw plugin install @<old-version>");
  });
});
