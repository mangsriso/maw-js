/**
 * Sweeper — Auto-cleanup idle ephemeral workers.
 *
 * Pattern: OpenClaw-style periodic sweep with dual expiration:
 *   1. Idle timeout: no feed activity for N hours → cleanup
 *   2. Max age: worktree exists longer than N hours → cleanup (regardless of activity)
 *
 * Static workers (lifecycle: "static" in fleet config) are never touched.
 */

import { readdirSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { loadConfig, parseDuration, type AutoCleanupConfig } from "./config";
import { scanWorktrees, cleanupWorktree, type WorktreeInfo } from "./worktrees";
import type { FeedTailer } from "./feed-tail";
import { MAW_LOG_PATH } from "./maw-log";

interface SweeperState {
  timer: ReturnType<typeof setInterval> | null;
  lastSweep: number;
  cleanedTotal: number;
}

const state: SweeperState = {
  timer: null,
  lastSweep: 0,
  cleanedTotal: 0,
};

/** Load all static window names from fleet configs */
function loadStaticWindows(): Set<string> {
  const fleetDir = join(import.meta.dir, "../fleet");
  const staticNames = new Set<string>();

  try {
    for (const file of readdirSync(fleetDir).filter(f => f.endsWith(".json") && !f.endsWith(".disabled"))) {
      const config = JSON.parse(readFileSync(join(fleetDir, file), "utf-8"));
      for (const w of config.windows || []) {
        if (w.lifecycle === "static") {
          staticNames.add(w.name);
        }
      }
    }
  } catch { /* fleet dir may not exist */ }

  return staticNames;
}

/** Get last activity timestamp for each oracle from feed */
function getLastActivity(feedTailer: FeedTailer): Map<string, number> {
  const lastSeen = new Map<string, number>();
  // Check wider window (48h) to catch long-idle workers
  const events = feedTailer.getRecent(500);

  for (const e of events) {
    const prev = lastSeen.get(e.oracle) || 0;
    if (e.ts > prev) lastSeen.set(e.oracle, e.ts);
  }

  return lastSeen;
}

/** Check if a worktree window name matches any static name pattern */
function isStaticWorker(wt: WorktreeInfo, staticNames: Set<string>): boolean {
  // Direct match
  if (wt.tmuxWindow && staticNames.has(wt.tmuxWindow)) return true;

  // The main oracle window (e.g., "wednesday-oracle") is always static
  // even if not explicitly marked — it's the base session
  if (wt.tmuxWindow && wt.tmuxWindow.endsWith("-oracle")) return true;

  return false;
}

/** Match worktree to oracle name in feed */
function worktreeToOracle(wt: WorktreeInfo): string | null {
  // tmux window name IS the oracle name in feed.log
  // e.g., "wednesday-1-learn-skillnet" → feed oracle "wednesday-oracle" or "wednesday-1-learn-skillnet"
  return wt.tmuxWindow || null;
}

/** Get worktree creation time from git */
async function getWorktreeAge(wtPath: string): Promise<number> {
  try {
    const { ssh } = await import("./ssh");
    // Use the .git file creation time as proxy for worktree age
    const stat = await ssh(`stat -c '%Y' '${wtPath}/.git' 2>/dev/null`);
    const epoch = parseInt(stat.trim());
    if (!isNaN(epoch)) return epoch * 1000;
  } catch {}
  return Date.now(); // fallback: treat as just created
}

export interface SweepResult {
  scanned: number;
  skippedStatic: number;
  cleanedIdle: number;
  cleanedMaxAge: number;
  errors: string[];
  details: { name: string; reason: string; log: string[] }[];
}

/** Run a single sweep cycle */
export async function sweep(feedTailer: FeedTailer): Promise<SweepResult> {
  const config = loadConfig();
  const cleanup = config.autoCleanup;

  const idleMs = parseDuration(cleanup.idleTimeout);
  const maxAgeMs = parseDuration(cleanup.maxAge);
  const now = Date.now();

  const staticNames = loadStaticWindows();
  const lastActivity = getLastActivity(feedTailer);

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
    // Skip static workers
    if (isStaticWorker(wt, staticNames)) {
      result.skippedStatic++;
      continue;
    }

    // Already stale/orphan → clean unconditionally
    if (wt.status === "stale" || wt.status === "orphan") {
      try {
        const log = await cleanupWorktree(wt.path);
        result.cleanedIdle++;
        result.details.push({ name: wt.name, reason: wt.status, log });
      } catch (e: any) {
        result.errors.push(`cleanup ${wt.name}: ${e.message}`);
      }
      continue;
    }

    // Active worker — check idle timeout and max age
    const oracleName = worktreeToOracle(wt);
    const lastSeen = oracleName ? (lastActivity.get(oracleName) || 0) : 0;
    const idleTime = lastSeen > 0 ? now - lastSeen : Infinity;

    // Check max age
    const createdAt = await getWorktreeAge(wt.path);
    const age = now - createdAt;

    if (age > maxAgeMs) {
      try {
        const log = await cleanupWorktree(wt.path);
        result.cleanedMaxAge++;
        result.details.push({
          name: wt.name,
          reason: `max-age (${Math.round(age / 3_600_000)}h > ${cleanup.maxAge})`,
          log,
        });
      } catch (e: any) {
        result.errors.push(`cleanup ${wt.name}: ${e.message}`);
      }
    } else if (idleTime > idleMs) {
      try {
        const log = await cleanupWorktree(wt.path);
        result.cleanedIdle++;
        result.details.push({
          name: wt.name,
          reason: `idle (${Math.round(idleTime / 3_600_000)}h > ${cleanup.idleTimeout})`,
          log,
        });
      } catch (e: any) {
        result.errors.push(`cleanup ${wt.name}: ${e.message}`);
      }
    }
  }

  state.lastSweep = now;
  state.cleanedTotal += result.cleanedIdle + result.cleanedMaxAge;

  // Log sweep result to maw.log
  if (result.cleanedIdle + result.cleanedMaxAge > 0) {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      from: "sweeper",
      to: "all",
      msg: `swept ${result.scanned} worktrees: ${result.cleanedIdle} idle + ${result.cleanedMaxAge} max-age cleaned, ${result.skippedStatic} static protected`,
      ch: "sweeper",
    }) + "\n";
    try { appendFileSync(MAW_LOG_PATH, entry); } catch {}
  }

  return result;
}

/** Start the periodic sweeper. Returns stop function. */
export function startSweeper(feedTailer: FeedTailer): () => void {
  const config = loadConfig();
  const cleanup = config.autoCleanup;

  if (!cleanup.enabled) {
    console.log("  sweeper: disabled (autoCleanup.enabled = false)");
    return () => {};
  }

  const intervalMs = parseDuration(cleanup.sweepInterval);
  console.log(`  sweeper: enabled (idle=${cleanup.idleTimeout}, maxAge=${cleanup.maxAge}, interval=${cleanup.sweepInterval})`);

  // First sweep after 2 minutes (let server stabilize)
  const initialTimeout = setTimeout(async () => {
    try {
      const result = await sweep(feedTailer);
      if (result.cleanedIdle + result.cleanedMaxAge > 0) {
        console.log(`  sweeper: cleaned ${result.cleanedIdle + result.cleanedMaxAge} worktrees`);
      }
    } catch {}
  }, 2 * 60_000);

  // Then sweep at configured interval
  const interval = setInterval(async () => {
    try {
      const result = await sweep(feedTailer);
      if (result.cleanedIdle + result.cleanedMaxAge > 0) {
        console.log(`  sweeper: cleaned ${result.cleanedIdle + result.cleanedMaxAge} worktrees`);
      }
    } catch {}
  }, intervalMs);

  state.timer = interval;

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(interval);
    state.timer = null;
  };
}

/** Get sweeper stats for API */
export function getSweeperStats() {
  const config = loadConfig();
  return {
    enabled: config.autoCleanup.enabled,
    config: config.autoCleanup,
    lastSweep: state.lastSweep ? new Date(state.lastSweep).toISOString() : null,
    cleanedTotal: state.cleanedTotal,
  };
}
