/**
 * federation-diff.ts — computeSyncDiff pure logic.
 * No I/O, no network — fully unit-testable.
 */

import type { PeerIdentity, SyncDiff } from "./federation-identity";

/**
 * Compute what a sync would do without touching config or network.
 *
 * Rules:
 *  - 'local' routes are sacrosanct (never flag as conflict or stale)
 *  - A route pointing at our own localNode is treated like 'local'
 *  - Unreachable peers are skipped entirely — their routes are left alone
 *    because we can't prove anything about them right now
 *  - A new oracle on a reachable peer → add (unless already routed)
 *  - Existing route X → peer.node X, oracle still hosted → no-op (not in diff)
 *  - Existing route X → peer.node X, oracle no longer hosted → stale
 *  - Existing route X → but peer Y also claims it → conflict (first peer wins)
 */
export function computeSyncDiff(
  localAgents: Record<string, string>,
  peerIdentities: PeerIdentity[],
  localNode: string,
): SyncDiff {
  const diff: SyncDiff = { add: [], stale: [], conflict: [], unreachable: [] };

  const liveByNode = new Map<string, Set<string>>();
  const peerNameByNode = new Map<string, string>();

  for (const p of peerIdentities) {
    if (!p.reachable) {
      diff.unreachable.push({ peerName: p.peerName, url: p.url, error: p.error });
      continue;
    }
    // First peer wins on duplicate node name
    if (!liveByNode.has(p.node)) {
      liveByNode.set(p.node, new Set(p.agents));
      peerNameByNode.set(p.node, p.peerName);
    }
  }

  // ADD / CONFLICT — walk every live oracle.
  // Iterate in peerIdentities input order so "first peer wins" when two
  // different nodes both claim the same oracle.
  const claimedByFirst = new Set<string>();
  for (const p of peerIdentities) {
    if (!p.reachable) continue;
    const peerName = peerNameByNode.get(p.node);
    if (peerName !== p.peerName) continue; // a later duplicate node entry — already processed
    for (const oracle of p.agents) {
      if (claimedByFirst.has(oracle)) continue; // another peer already claimed this oracle
      claimedByFirst.add(oracle);
      if (!(oracle in localAgents)) {
        diff.add.push({ oracle, peerNode: p.node, fromPeer: peerName });
        continue;
      }
      const current = localAgents[oracle];
      if (current === "local" || current === localNode || current === p.node) {
        continue;
      }
      diff.conflict.push({
        oracle,
        current,
        proposed: p.node,
        fromPeer: peerName,
      });
    }
  }

  // STALE — walk every local route that points at a *reachable* peer node
  for (const [oracle, node] of Object.entries(localAgents)) {
    if (node === "local" || node === localNode) continue;
    const live = liveByNode.get(node);
    if (live && !live.has(oracle)) {
      diff.stale.push({ oracle, peerNode: node });
    }
  }

  return diff;
}
