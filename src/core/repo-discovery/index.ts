/**
 * RepoDiscovery singleton + backward-compat shim.
 *
 * Today: only `GhqDiscovery` is wired (inherits ghq's 9 VCSes — git/svn/hg/
 * darcs/pijul/cvs/fossil/bzr/git-svn). The interface + singleton exist so a
 * second backend (fs-scan, jj, manifest, ...) can drop in WITHOUT touching
 * the 12 call sites — but env-var dispatch is intentionally NOT wired until
 * the second backend lands. Reason: a tautological `kind === "ghq" ? Ghq : Ghq`
 * branch tests only that the hook exists, not that it dispatches — see the
 * critic-agent's alpha.55-58 retro that flagged this as the smoking gun for
 * premature abstraction. We kept the seam, removed the lie.
 *
 * When the second backend ships (same PR), wire `process.env.MAW_REPO_DISCOVERY`
 * here with a real branch.
 *
 * Tests may inject a mock via `setRepos(mock)` and clean up with `resetRepos()`.
 *
 * The `ghqList` / `ghqFind` re-exports preserve the legacy API used at:
 *   - src/commands/plugins/soul-sync/resolve.ts
 *   - src/commands/plugins/oracle/impl-helpers.ts
 *   - src/commands/plugins/workon/impl.ts
 *   - src/commands/plugins/fleet/fleet-init-scan.ts
 * New code should prefer `getRepos().findBySuffix(...)` directly.
 */

import { GhqDiscovery } from "./ghq-discovery";
import type { RepoDiscovery } from "./types";

export type { RepoDiscovery } from "./types";
export { GhqDiscovery } from "./ghq-discovery";

let _instance: RepoDiscovery | null = null;

export function getRepos(): RepoDiscovery {
  if (_instance) return _instance;
  _instance = GhqDiscovery;
  return _instance;
}

/** Inject a mock adapter — for tests only. */
export function setRepos(impl: RepoDiscovery): void {
  _instance = impl;
}

/** Clear the cached adapter — for tests only. */
export function resetRepos(): void {
  _instance = null;
}

// ── Backward-compat re-exports ─────────────────────────────────────────
// Keep `ghqList` / `ghqFind` / sync variants working at existing call sites.
export const ghqList = (): Promise<string[]> => getRepos().list();
export const ghqListSync = (): string[] => getRepos().listSync();
export const ghqFind = (suffix: string): Promise<string | null> =>
  getRepos().findBySuffix(suffix);
export const ghqFindSync = (suffix: string): string | null =>
  getRepos().findBySuffixSync(suffix);
