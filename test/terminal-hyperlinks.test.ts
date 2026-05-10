/**
 * OSC-8 hyperlink gate: supportsHyperlinks() must be conservative — unknown
 * terminals get plain text, never raw escape sequences. Regression test for
 * `maw wake` dumping ']8;;https://...' as literal text in non-supporting
 * terminals (see #388 site 4).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { supportsHyperlinks, tlink } from "../src/core/util/terminal";

describe("supportsHyperlinks()", () => {
  // Snapshot + restore env and isTTY around each test — these are process globals.
  const origEnv = { ...process.env };
  const origIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    // Wipe all hyperlink-relevant env vars to a known baseline.
    delete process.env.NO_HYPERLINKS;
    delete process.env.FORCE_HYPERLINKS;
    delete process.env.TMUX;
    delete process.env.TERM_PROGRAM;
    delete process.env.TERM;
    delete process.env.WT_SESSION;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    process.env = { ...origEnv };
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });

  test("returns false when stdout is not a TTY (piped)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.env.TERM_PROGRAM = "iTerm.app"; // would normally be true
    expect(supportsHyperlinks()).toBe(false);
  });

  test("returns false when NO_HYPERLINKS is set", () => {
    process.env.NO_HYPERLINKS = "1";
    process.env.TERM_PROGRAM = "iTerm.app";
    expect(supportsHyperlinks()).toBe(false);
  });

  test("returns true when FORCE_HYPERLINKS is set", () => {
    process.env.FORCE_HYPERLINKS = "1";
    // no other signals — should still be true
    expect(supportsHyperlinks()).toBe(true);
  });

  test("FORCE wins over TMUX", () => {
    process.env.FORCE_HYPERLINKS = "1";
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("FORCE wins over non-TTY (for verification / explicit opt-in)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.env.FORCE_HYPERLINKS = "1";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("returns false inside tmux by default", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
    process.env.TERM_PROGRAM = "iTerm.app";
    expect(supportsHyperlinks()).toBe(false);
  });

  test("returns true for iTerm.app", () => {
    process.env.TERM_PROGRAM = "iTerm.app";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("returns true for WezTerm", () => {
    process.env.TERM_PROGRAM = "WezTerm";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("returns true for vscode integrated terminal", () => {
    process.env.TERM_PROGRAM = "vscode";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("returns true for kitty (via TERM)", () => {
    process.env.TERM = "xterm-kitty";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("returns true for Windows Terminal (via WT_SESSION)", () => {
    process.env.WT_SESSION = "some-uuid";
    expect(supportsHyperlinks()).toBe(true);
  });

  test("conservative default for unknown TTY terminals", () => {
    process.env.TERM = "xterm-256color";
    // no TERM_PROGRAM, no WT_SESSION, no FORCE — unknown ⇒ plain text
    expect(supportsHyperlinks()).toBe(false);
  });
});

describe("tlink()", () => {
  const origEnv = { ...process.env };
  const origIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    delete process.env.NO_HYPERLINKS;
    delete process.env.FORCE_HYPERLINKS;
    delete process.env.TMUX;
    delete process.env.TERM_PROGRAM;
    delete process.env.TERM;
    delete process.env.WT_SESSION;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    process.env = { ...origEnv };
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });

  test("returns plain text when unsupported (the regression)", () => {
    process.env.NO_HYPERLINKS = "1";
    const url = "https://github.com/Soul-Brews-Studio/foo";
    expect(tlink(url)).toBe(url);
    expect(tlink(url, "label")).toBe("label");
    // critical: must NOT contain the OSC-8 escape prefix that showed up raw
    expect(tlink(url)).not.toContain("\x1b]8;;");
    expect(tlink(url)).not.toContain("]8;;");
  });

  test("emits OSC-8 escape when supported", () => {
    process.env.FORCE_HYPERLINKS = "1";
    const url = "https://example.com";
    const out = tlink(url, "click");
    expect(out).toContain(`\x1b]8;;${url}\x07`);
    expect(out).toContain("click");
    expect(out).toContain("\x1b]8;;\x07"); // closing sequence
  });
});
