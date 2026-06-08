/**
 * Sweeper daemon — periodic auto-cleanup of idle worktrees.
 * Reads autoCleanup config; does nothing if disabled.
 */

import { loadConfig } from "../../config";

let timer: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;

export async function startSweeper() {
  const config = loadConfig();
  if (!config.autoCleanup?.enabled) {
    console.log("  sweeper: disabled (autoCleanup.enabled = false)");
    return;
  }

  const { parseDuration, cmdSweep } = await import("../../commands/plugins/sweeper/impl");
  const intervalMs = parseDuration(config.autoCleanup.sweepInterval);

  console.log(`  sweeper: enabled (idle=${config.autoCleanup.idleTimeout}, maxAge=${config.autoCleanup.maxAge}, interval=${config.autoCleanup.sweepInterval})`);

  // Initial sweep after 2 min delay (let server fully start)
  initialTimer = setTimeout(async () => {
    try {
      const result = await cmdSweep({ dryRun: false });
      if (result.cleanedIdle + result.cleanedMaxAge > 0) {
        console.log(`  sweeper: cleaned ${result.cleanedIdle + result.cleanedMaxAge} worktrees`);
      }
    } catch {}
  }, 2 * 60_000);

  // Periodic sweep
  timer = setInterval(async () => {
    try {
      const { cmdSweep: sweep } = await import("../../commands/plugins/sweeper/impl");
      const result = await sweep({ dryRun: false });
      if (result.cleanedIdle + result.cleanedMaxAge > 0) {
        console.log(`  sweeper: cleaned ${result.cleanedIdle + result.cleanedMaxAge} worktrees`);
      }
    } catch {}
  }, intervalMs);
}

export function stopSweeper() {
  if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
  if (timer) { clearInterval(timer); timer = null; }
}
