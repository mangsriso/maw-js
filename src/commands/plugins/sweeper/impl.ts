/**
 * Sweeper — Auto-cleanup idle ephemeral workers.
 *
 * Dual expiration:
 *   1. Idle timeout: no feed activity for N hours → cleanup
 *   2. Max age: worktree exists longer than N hours → cleanup
 *
 * Static workers (lifecycle: "static" in fleet config) are never touched.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { loadConfig } from "../../../config";
import { scanWorktrees, type WorktreeInfo } from "../../../core/fleet/worktrees-scan";
import { cleanupWorktree } from "../../../core/fleet/worktrees-cleanup";
import type { FeedEvent } from "../../../lib/feed";
import { FLEET_DIR } from "../../../core/paths";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface SweeperState {
  lastSweep: number;
  cleanedTotal: number;
}

const state: SweeperState = {
  lastSweep: 0,
  cleanedTotal: 0,
};

// ---------------------------------------------------------------------------
// Duration parser
// ---------------------------------------------------------------------------

/** Parse duration string (e.g., "2h", "30m", "1d") to milliseconds */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (!match) return 2 * 60 * 60_000; // default 2h
  const n = parseFloat(match[1]);
  switch (match[2]) {
    case "ms": return n;
    case "s":  return n * 1000;
    case "m":  return n * 60_000;
    case "h":  return n * 3_600_000;
    case "d":  return n * 86_400_000;
    default:   return 2 * 60 * 60_000;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load all static window names from fleet configs */
function loadStaticWindows(): Set<string> {
  const staticNames = new Set<string>();
  try {
    for (const file of readdirSync(FLEET_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".disabled"))) {
      const config = JSON.parse(readFileSync(join(FLEET_DIR, file), "utf-8"));
      for (const w of config.windows || []) {
        if (w.lifecycle === "static") {
          staticNames.add(w.name);
        }
      }
    }
  } catch { /* fleet dir may not exist */ }
  return staticNames;
}

/** Get last activity timestamp for each oracle from feed buffer */
function getLastActivity(feedBuffer: FeedEvent[]): Map<string, number> {
  const lastSeen = new Map<string, number>();
  const events = feedBuffer.slice(-500);
  for (const e of events) {
    const prev = lastSeen.get(e.oracle) || 0;
    if (e.ts > prev) lastSeen.set(e.oracle, e.ts);
  }
  return lastSeen;
}

/** Check if a worktree window name matches any static name pattern */
function isStaticWorker(wt: WorktreeInfo, staticNames: Set<string>): boolean {
  if (wt.tmuxWindow && staticNames.has(wt.tmuxWindow)) return true;
  if (wt.tmuxWindow && wt.tmuxWindow.endsWith("-oracle")) return true;
  return false;
}

/** Match worktree to oracle name in feed */
function worktreeToOracle(wt: WorktreeInfo): string | null {
  return wt.tmuxWindow || null;
}

/** Get worktree creation time using native fs (no SSH) */
function getWorktreeAge(wtPath: string): number {
  try {
    const gitDir = join(wtPath, ".git");
    const stats = statSync(gitDir);
    return stats.mtimeMs;
  } catch {
    return Date.now();
  }
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

export interface SweepResult {
  scanned: number;
  skippedStatic: number;
  cleanedIdle: number;
  cleanedMaxAge: number;
  errors: string[];
  details: { name: string; reason: string; log: string[] }[];
}

/**
 * A real git worktree has a `.git` FILE (gitdir pointer). scanWorktrees can
 * over-match plain directories (e.g. `*​/agents/*` in /learn'd repos) that are
 * NOT worktrees — cleanupWorktree fails on them ("not a working tree") and the
 * failed attempt was being miscounted as a successful clean. Filter them out
 * before any cleanup so the count stays honest and no stray tmux window is
 * fuzzy-killed for a phantom path.
 */
function isRealWorktree(wtPath: string): boolean {
  try {
    const gitPath = join(wtPath, ".git");
    return existsSync(gitPath) && statSync(gitPath).isFile();
  } catch {
    return false;
  }
}

export async function cmdSweep(opts?: { dryRun?: boolean }): Promise<SweepResult> {
  const config = loadConfig();
  const cleanup = config.autoCleanup;

  const idleMs = parseDuration(cleanup?.idleTimeout ?? "2h");
  const maxAgeMs = parseDuration(cleanup?.maxAge ?? "24h");
  const now = Date.now();

  const staticNames = loadStaticWindows();

  // Get feed buffer from api module (lazy import to avoid circular deps)
  let feedBuffer: FeedEvent[] = [];
  try {
    const feed = await import("../../../api/feed");
    feedBuffer = feed.feedBuffer || [];
  } catch { /* feed may not be available in CLI-only mode */ }

  const lastActivity = getLastActivity(feedBuffer);

  const result: SweepResult = {
    scanned: 0,
    skippedStatic: 0,
    cleanedIdle: 0,
    cleanedMaxAge: 0,
    errors: [],
    details: [],
  };

  let worktrees: WorktreeInfo[];
  try {
    worktrees = await scanWorktrees();
  } catch (e: any) {
    result.errors.push(`scan failed: ${e.message}`);
    return result;
  }

  result.scanned = worktrees.length;

  for (const wt of worktrees) {
    if (isStaticWorker(wt, staticNames)) {
      result.skippedStatic++;
      continue;
    }

    // Skip over-matched non-worktree dirs (scanWorktrees catches */agents/* in
    // learned repos) — they fail cleanup and would inflate the cleaned count.
    if (!isRealWorktree(wt.path)) {
      continue;
    }

    if (wt.status === "stale" || wt.status === "orphan") {
      if (!opts?.dryRun) {
        try {
          const log = await cleanupWorktree(wt.path);
          result.cleanedIdle++;
          result.details.push({ name: wt.name, reason: wt.status, log });
        } catch (e: any) {
          result.errors.push(`cleanup ${wt.name}: ${e.message}`);
        }
      } else {
        result.cleanedIdle++;
        result.details.push({ name: wt.name, reason: `${wt.status} (dry-run)`, log: [] });
      }
      continue;
    }

    const oracleName = worktreeToOracle(wt);
    const lastSeen = oracleName ? (lastActivity.get(oracleName) || 0) : 0;
    const idleTime = lastSeen > 0 ? now - lastSeen : Infinity;

    const createdAt = getWorktreeAge(wt.path);
    const age = now - createdAt;

    if (age > maxAgeMs) {
      if (!opts?.dryRun) {
        try {
          const log = await cleanupWorktree(wt.path);
          result.cleanedMaxAge++;
          result.details.push({
            name: wt.name,
            reason: `max-age (${Math.round(age / 3_600_000)}h > ${cleanup?.maxAge ?? "24h"})`,
            log,
          });
        } catch (e: any) {
          result.errors.push(`cleanup ${wt.name}: ${e.message}`);
        }
      } else {
        result.cleanedMaxAge++;
        result.details.push({
          name: wt.name,
          reason: `max-age (${Math.round(age / 3_600_000)}h > ${cleanup?.maxAge ?? "24h"}) (dry-run)`,
          log: [],
        });
      }
    } else if (idleTime > idleMs) {
      if (!opts?.dryRun) {
        try {
          const log = await cleanupWorktree(wt.path);
          result.cleanedIdle++;
          result.details.push({
            name: wt.name,
            reason: `idle (${Math.round(idleTime / 3_600_000)}h > ${cleanup?.idleTimeout ?? "2h"})`,
            log,
          });
        } catch (e: any) {
          result.errors.push(`cleanup ${wt.name}: ${e.message}`);
        }
      } else {
        result.cleanedIdle++;
        result.details.push({
          name: wt.name,
          reason: `idle (${Math.round(idleTime / 3_600_000)}h > ${cleanup?.idleTimeout ?? "2h"}) (dry-run)`,
          log: [],
        });
      }
    }
  }

  state.lastSweep = now;
  state.cleanedTotal += result.cleanedIdle + result.cleanedMaxAge;

  return result;
}

/** Get sweeper stats for API */
export function getSweeperStats() {
  const config = loadConfig();
  return {
    enabled: config.autoCleanup?.enabled ?? false,
    config: config.autoCleanup ?? { enabled: false, idleTimeout: "2h", maxAge: "24h", sweepInterval: "5m", notify: false },
    lastSweep: state.lastSweep ? new Date(state.lastSweep).toISOString() : null,
    cleanedTotal: state.cleanedTotal,
  };
}
