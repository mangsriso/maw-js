// codex-trust.ts — make maw codex workers launch in the repo path, pre-trusted,
// so interactive codex (0.13x) never hangs at its directory-trust prompt.
//
// Two defects this addresses (see plan): (1) respawn-pane dropped `-c <cwd>` so a
// codex respawn landed in $HOME; (2) maw never wrote codex's `~/.codex/config.toml`
// trust entry, so codex prompted "Do you trust this directory?" and hung the
// non-interactive worker. This module canonicalizes the launch cwd and auto-adds a
// trusted projects entry — gated to codex engines, with an off-switch
// (`codexAutoTrust: false`) and an `--incubate` carve-out wired by the caller.

import {
  realpathSync, existsSync, lstatSync, mkdirSync,
  readFileSync, writeFileSync, renameSync, copyFileSync,
  openSync, closeSync, statSync, unlinkSync,
  chmodSync, fsyncSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { buildCommandFromConfig } from "./command";
import { loadConfig } from "./load";
type ReadonlyAuthority = { target: string; realDir: string };
const readonlyIntegratedAuthorities = new Map<string, ReadonlyAuthority>();
export function createIntegratedReadonlyAuthority(target: string, realDir: string): string {
  const token = randomBytes(16).toString("hex");
  readonlyIntegratedAuthorities.set(token, { target, realDir });
  return token;
}
export function consumeIntegratedReadonly(token: string | undefined, target: string, realDir: string): boolean {
  if (!token) return false;
  const authority = readonlyIntegratedAuthorities.get(token);
  if (!authority || authority.target !== target || authority.realDir !== realDir) return false;
  readonlyIntegratedAuthorities.delete(token);
  return true;
}
export function restoreIntegratedReadonly(token: string, target: string, realDir: string): void {
  if (/^[0-9a-f]{32}$/.test(token)) readonlyIntegratedAuthorities.set(token, { target, realDir });
}
export function revokeIntegratedReadonly(token: string | undefined): void {
  if (token) readonlyIntegratedAuthorities.delete(token);
}
function trustedProjectInToml(content: string, realDir: string): boolean {
  const escaped = realDir.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const header = `[projects."${escaped}"]`;
  let inProject = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inProject = line === header;
      continue;
    }
    if (inProject && /^trust_level\s*=\s*"trusted"\s*(?:#.*)?$/.test(line)) return true;
  }
  return false;
}
export function verifyCodexTrust(realDir: string, codexDir = join(homedir(), ".codex")): boolean {
  try {
    return trustedProjectInToml(readFileSync(join(codexDir, "config.toml"), "utf8"), realDir);
  } catch { return false; }
}

/**
 * True iff the resolved engine command launches the `codex` binary. Robust to
 * `command codex …`, `env FOO=1 codex …`, and absolute paths (`/usr/bin/codex …`)
 * — all legal in `commands` — by stripping wrappers/env-prefixes then comparing
 * the basename of argv[0]. A binary basenamed `codex-foo` is correctly NOT codex.
 */
export function isCodexCommand(cmd: string): boolean {
  const toks = (cmd || "").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  // peel leading wrappers (command/env), their flags (e.g. `env -i`), and
  // VAR=val env assignments, then test the basename of the first real token.
  // (Flag-with-argument wrappers like `nice -n 5 codex` aren't unwound — they
  // fall through to a safe false → codex just prompts once, never crashes.)
  while (i < toks.length) {
    const t = toks[i]!;
    if (t === "command" || t === "env") { i++; continue; }
    if (t.startsWith("-")) { i++; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
    break;
  }
  const argv0 = toks[i] || "";
  return (argv0.split("/").pop() || argv0) === "codex";
}

const STALE_LOCK_MS = 10_000;

/** Acquire an advisory lockfile. Steals it if older than STALE_LOCK_MS (crash
 * recovery). Fail-open: returns false after bounded retry so the caller proceeds
 * best-effort (atomic rename still prevents corruption; a rare lost-update
 * self-heals on the next wake). */
async function acquireLock(lock: string): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    try {
      closeSync(openSync(lock, "wx", 0o600));
      return true;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) {
          try { unlinkSync(lock); } catch { /* someone else stole it */ }
          continue;
        }
      } catch { continue; /* lock vanished — retry immediately */ }
      await new Promise(r => setTimeout(r, 25));
    }
  }
  return false;
}

/** Idempotently add `[projects."<realDir>"] trust_level = "trusted"` to
 * ~/.codex/config.toml. Symlink-safe (operates on the link target so atomic
 * rename doesn't detach a managed config), concurrency-safe, one-time backup. */
export async function ensureCodexTrust(realDir: string, codexDir = join(homedir(), ".codex")): Promise<void> {
  // escaping guard — TOML basic-string key cannot contain " \ or control chars;
  // filesystem paths here won't, but never corrupt the file if they do.
  if (/["\\\x00-\x1f]/.test(realDir)) {
    console.warn(`[maw] codex-trust: skip auto-trust (unsafe chars in path): ${realDir}`);
    return;
  }
  const linkPath = join(codexDir, "config.toml");
  // Resolve a symlinked config.toml to its target so temp+rename replaces the
  // target file in place and leaves the symlink (chezmoi/stow) intact.
  let target = linkPath;
  try {
    if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
      target = realpathSync(linkPath);
    }
  } catch { /* keep linkPath */ }

  const header = `[projects."${realDir}"]`;
  const lock = join(codexDir, ".maw-trust.lock");
  let locked = false;
  try {
    if (!existsSync(codexDir)) mkdirSync(codexDir, { recursive: true, mode: 0o700 });
    chmodSync(codexDir, 0o700);
    locked = await acquireLock(lock);

    let content = "";
    try { content = readFileSync(target, "utf-8"); } catch { content = ""; }
    if (trustedProjectInToml(content, realDir)) return; // already trusted → no-op

    if (content && !existsSync(target + ".maw-bak")) {
      try { copyFileSync(target, target + ".maw-bak"); } catch { /* best-effort */ }
    }

    let next = content;
    if (next.length && !next.endsWith("\n")) next += "\n"; // close last line
    if (next.length) next += "\n";                          // blank separator
    next += `${header}\ntrust_level = "trusted"\n`;

    const tmp = `${target}.maw-tmp.${process.pid}`; // pid-unique: no shared-tmp clobber if two procs fail open the lock
    writeFileSync(tmp, next, { encoding: "utf-8", mode: 0o600 });
    chmodSync(tmp, 0o600);
    const tmpFd = openSync(tmp, "r");
    try { fsyncSync(tmpFd); } finally { closeSync(tmpFd); }
    renameSync(tmp, target); // atomic, same dir → no EXDEV
    chmodSync(target, 0o600);
  } catch (e) {
    console.warn(`[maw] codex-trust: could not trust ${realDir}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (locked) { try { unlinkSync(lock); } catch { /* ignore */ } }
  }
}

/**
 * For a worker about to launch: if its resolved engine command is codex, ensure
 * its launch directory is trusted in ~/.codex/config.toml and return the
 * canonical realpath of `rawCwd`. For non-codex engines, returns `rawCwd`
 * unchanged (claude workers get byte-identical behavior).
 *
 * The LOAD-BEARING part is the trust write — codex hangs at its directory-trust
 * prompt on an untrusted path, so for "any repo" (incl. never-trusted ones) we
 * must pre-trust it. The trust key MUST be the realpath because codex
 * canonicalizes its cwd before checking trust. Returning realpath as the pane
 * cwd is tidy/defensive but not strictly required (codex resolves a symlinked
 * cwd to the same realpath anyway).
 *
 * `agentName` (the window name) is REQUIRED — codex may be selected by the
 * `codex-*` name glob, not just an explicit `--engine`, and the detector resolves
 * the command exactly as the launch will.
 *
 * `allowTrust=false` (cmdWake passes `!opts.incubate`) suppresses the trust write
 * so a freshly-cloned `--incubate` repo is never auto-trusted before review.
 * Non-incubate spawn paths (snapshot restore, fleet wake) pass `true`.
 *
 * Degrades (returns rawCwd, skips trust) if the path can't be resolved — never
 * crashes the wake. Must be called AFTER any worktree is materialized.
 */
export async function prepareCodexLaunch(
  agentName: string,
  rawCwd: string,
  engine?: string,
  allowTrust = true,
): Promise<string> {
  let cmd: string;
  try { cmd = buildCommandFromConfig(loadConfig(), agentName, engine); }
  catch { return rawCwd; }
  if (!isCodexCommand(cmd)) return rawCwd;

  let real: string;
  try { real = realpathSync(rawCwd); }
  catch { return rawCwd; } // path not materialized yet → degrade, skip trust

  // The frozen durable route owns token-free preflight + receipt-bound strict
  // trust at the centralized tmux delivery boundary. Never mutate trust early.
  if (cmd.startsWith("SDA_CODEX_MCP_HOME='")) {
    return real;
  }

  if (allowTrust && loadConfig().codexAutoTrust !== false) {
    await ensureCodexTrust(real);
  }
  return real;
}
