/**
 * federation-apply.ts — applySyncDiff pure transform.
 * No I/O — takes a diff and current agents, returns next agents + changelog.
 */

import type { SyncDiff } from "./federation-identity";

/**
 * Apply a diff to an agents map. Pure — no I/O. Returns the new map and a
 * list of human-readable descriptions of what changed.
 *
 * `force` allows overwriting conflicting routes.
 * `prune` allows removing stale entries.
 */
export function applySyncDiff(
  currentAgents: Record<string, string>,
  diff: SyncDiff,
  opts: { force?: boolean; prune?: boolean } = {},
): { agents: Record<string, string>; applied: string[] } {
  const agents = { ...currentAgents };
  const applied: string[] = [];

  for (const a of diff.add) {
    agents[a.oracle] = a.peerNode;
    applied.push(`+ agents['${a.oracle}'] = '${a.peerNode}'  (from peer '${a.fromPeer}')`);
  }

  if (opts.force) {
    for (const c of diff.conflict) {
      agents[c.oracle] = c.proposed;
      applied.push(
        `~ agents['${c.oracle}']: '${c.current}' → '${c.proposed}'  (from peer '${c.fromPeer}', --force)`,
      );
    }
  }

  if (opts.prune) {
    for (const s of diff.stale) {
      delete agents[s.oracle];
      applied.push(`- agents['${s.oracle}']  (was '${s.peerNode}', no longer hosted there)`);
    }
  }

  return { agents, applied };
}
